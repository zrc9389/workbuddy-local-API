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
	cfg              Config
	scanSlots        chan struct{}
	taskMu           sync.Mutex
	activeAccounts   map[string]struct{}
	deletingAccounts map[string]struct{}
	activeScans      map[string]int
	generation       map[string]uint64
	queueOnce        sync.Once
	q                *queueState
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
	return &Service{cfg: cfg, scanSlots: make(chan struct{}, cfg.ScanConcurrency), activeAccounts: make(map[string]struct{}), deletingAccounts: make(map[string]struct{}), activeScans: make(map[string]int), generation: make(map[string]uint64)}
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
	if _, deleting := p.deletingAccounts[uid]; deleting {
		return false
	}
	p.activeAccounts[uid] = struct{}{}
	return true
}

// BeginAccountDeletion atomically blocks future task admission and confirms no
// task currently owns this account. The block remains until process restart or
// final account cleanup, preventing new task work while the journal is pending.
func (p *Service) BeginAccountDeletion(uid string) error {
	if p == nil || uid == "" {
		return nil
	}
	p.taskMu.Lock()
	if _, exists := p.deletingAccounts[uid]; !exists {
		p.deletingAccounts[uid] = struct{}{}
		p.generation[uid]++
	}
	q := p.queue()
	q.mu.Lock()
	for i := range q.items {
		if q.items[i].UID == uid && q.items[i].Status == "pending" {
			q.items[i].Status, q.items[i].Message = "cancelled", "account deletion"
		}
	}
	q.mu.Unlock()
	p.taskMu.Unlock()
	return nil
}

func (p *Service) beginScan(uid string) (uint64, bool) {
	p.taskMu.Lock()
	defer p.taskMu.Unlock()
	if _, deleting := p.deletingAccounts[uid]; deleting {
		return 0, false
	}
	p.activeScans[uid]++
	return p.generation[uid], true
}

func (p *Service) endScan(uid string) {
	p.taskMu.Lock()
	p.activeScans[uid]--
	if p.activeScans[uid] == 0 {
		delete(p.activeScans, uid)
	}
	p.taskMu.Unlock()
}

func (p *Service) scanValid(uid string, generation uint64) bool {
	p.taskMu.Lock()
	defer p.taskMu.Unlock()
	_, deleting := p.deletingAccounts[uid]
	return !deleting && p.generation[uid] == generation
}

// AccountDeletionStarted reports whether the UID is fenced against new task admission.
func (p *Service) AccountDeletionStarted(uid string) bool {
	if p == nil || uid == "" {
		return false
	}
	p.taskMu.Lock()
	_, deleting := p.deletingAccounts[uid]
	p.taskMu.Unlock()
	return deleting
}

// WaitAccountIdle waits for an already admitted task to finish after admission
// has been fenced. It never cancels an action already sent upstream.
func (p *Service) WaitAccountIdle(ctx context.Context, uid string) error {
	if p == nil || uid == "" {
		return nil
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		p.taskMu.Lock()
		_, active := p.activeAccounts[uid]
		active = active || p.activeScans[uid] > 0
		p.taskMu.Unlock()
		if !active {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
func (p *Service) UnlockAccount(uid string) {
	p.taskMu.Lock()
	delete(p.activeAccounts, uid)
	p.taskMu.Unlock()
}

// EndAccountDeletion releases the admission fence after deletion completed or
// was explicitly abandoned. It does not affect any active task lock.
func (p *Service) EndAccountDeletion(uid string) {
	if p == nil || uid == "" {
		return
	}
	p.taskMu.Lock()
	delete(p.deletingAccounts, uid)
	p.taskMu.Unlock()
}

// DeleteAccount clears retained queue state after confirming no queue or task
// action still owns this account. Queue snapshots are process-local only.
func (p *Service) DeleteAccount(uid string) error {
	if p == nil || uid == "" {
		return nil
	}
	if err := p.BeginAccountDeletion(uid); err != nil {
		return err
	}
	// Keep indices stable for workers serving other accounts.
	q := p.queue()
	q.mu.Lock()
	for i := range q.items {
		if q.items[i].UID == uid {
			q.items[i] = QueueItem{}
		}
	}
	q.mu.Unlock()
	return nil
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
