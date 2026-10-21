// Package tasks owns growth-task algorithms, account execution locks and queues.
// It is independently usable by schedulers; optional HTTP adapters do not depend on panel.
package tasks

import (
	"context"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"sync"
	"time"
)

// Config dependencies are shared with the caller. New never starts background work.
type Config struct {
	Pool              *pool.Pool
	Upstream          *upstream.Client
	ScanConcurrency   int // default 4; hard maximum 8, shared by scans and queue preparation
	MaxActiveAccounts int // default 4; hard maximum 8 across manual and queued execution
}
type Service struct {
	cfg            Config
	scanSlots      chan struct{}
	taskMu         sync.Mutex
	activeAccounts map[string]struct{}
	queueOnce      sync.Once
	q              *queueState
}

func New(cfg Config) *Service {
	if cfg.ScanConcurrency < 1 {
		cfg.ScanConcurrency = 4
	}
	if cfg.ScanConcurrency > 8 {
		cfg.ScanConcurrency = 8
	}
	if cfg.MaxActiveAccounts < 1 {
		cfg.MaxActiveAccounts = 4
	}
	if cfg.MaxActiveAccounts > 8 {
		cfg.MaxActiveAccounts = 8
	}
	return &Service{cfg: cfg, scanSlots: make(chan struct{}, cfg.ScanConcurrency), activeAccounts: make(map[string]struct{})}
}
func (p *Service) ready() error {
	if p == nil || p.cfg.Pool == nil || p.cfg.Upstream == nil {
		return errors.New("task service unavailable")
	}
	return nil
}
func (p *Service) acquireScan(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case p.scanSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (p *Service) releaseScan() { <-p.scanSlots }

// TryLockAccount bounds active execution and prevents concurrent work on one account.
// Entries exist only while held, so importing/deleting accounts cannot leak lock entries.
func (p *Service) TryLockAccount(uid string) bool {
	p.taskMu.Lock()
	defer p.taskMu.Unlock()
	if _, ok := p.activeAccounts[uid]; ok || len(p.activeAccounts) >= p.cfg.MaxActiveAccounts {
		return false
	}
	p.activeAccounts[uid] = struct{}{}
	return true
}
func (p *Service) UnlockAccount(uid string) {
	p.taskMu.Lock()
	delete(p.activeAccounts, uid)
	p.taskMu.Unlock()
}

type ScanResult struct {
	OK           bool              `json:"ok"`
	Accounts     []ScanAccountItem `json:"accounts"`
	PendingCount int               `json:"pending_count"`
}
type QueueSnapshot struct {
	Running     bool        `json:"running"`
	Total       int         `json:"total"`
	Concurrency int         `json:"conc"`
	Started     bool        `json:"started"`
	StartedAt   time.Time   `json:"started_at"`
	Seq         int         `json:"seq"`
	Items       []QueueItem `json:"items"`
}

func (p *Service) QueueStatus() QueueSnapshot {
	q := p.queue()
	q.mu.Lock()
	defer q.mu.Unlock()
	items := make([]QueueItem, len(q.items))
	copy(items, q.items)
	return QueueSnapshot{Running: q.running, Total: len(items), Concurrency: q.conc, Started: !q.startedAt.IsZero(), StartedAt: q.startedAt, Seq: q.seq, Items: items}
}

// RunAutoAll executes the preserved algorithm without HTTP or Panel. Cancellation is
// checked at admission; once admitted the original multi-step workflow keeps its lock
// until it finishes (the HTTP adapter retains the same timeout/background behavior).
func (p *Service) RunAutoAll(ctx context.Context, uid string) ([]map[string]any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := p.ready(); err != nil {
		return nil, err
	}
	a := p.cfg.Pool.AuthByUID(uid)
	if a == nil {
		return nil, errors.New("account not found")
	}
	if !p.TryLockAccount(uid) {
		return nil, errors.New("account busy or task capacity reached")
	}
	defer p.UnlockAccount(uid)
	return p.runAutoAll(a), nil
}
