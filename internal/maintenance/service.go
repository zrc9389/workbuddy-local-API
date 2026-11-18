// Package maintenance owns the one-click four-step run; no timers or UI dependency.
package maintenance

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"log"
	"strings"
	"sync"
	"time"
)

type Action func(context.Context, string, string) (string, error)
type AccountResult struct {
	UID     string `json:"uid"`
	State   string `json:"state"`
	Message string `json:"message"`
}
type Step struct {
	Name       string          `json:"name"`
	State      string          `json:"state"`
	StartedAt  time.Time       `json:"started_at,omitempty"`
	FinishedAt time.Time       `json:"finished_at,omitempty"`
	Completed  int             `json:"completed"`
	Failed     int             `json:"failed"`
	Total      int             `json:"total"`
	Accounts   []AccountResult `json:"accounts"`
}
type Status struct {
	RunID          string `json:"run_id"`
	Running        bool   `json:"running"`
	Paused         bool   `json:"paused"`
	LastRunAt      string `json:"last_run_at"`
	LastFinishedAt string `json:"last_finished_at"`
	LastResult     string `json:"last_result"`
	LastFailed     int    `json:"last_failed"`
	Steps          []Step `json:"steps"`
}
type Service struct {
	mu          sync.Mutex
	p           *pool.Pool
	action      Action
	state       Status
	ctx         context.Context
	cancel      context.CancelFunc
	done        chan struct{}
	resume      chan struct{}
	storagePath string
	deleted     map[string]bool
	staggerMin  time.Duration
	staggerMax  time.Duration
}

// SetAccountStagger 配置维护流水线中账号间的随机错峰间隔（0=关闭，供单测快速执行）。
func (s *Service) SetAccountStagger(min, max time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if min < 0 {
		min = 0
	}
	if max < min {
		max = min
	}
	s.staggerMin = min
	s.staggerMax = max
}

func (s *Service) waitAccountStagger() bool {
	s.mu.Lock()
	minD, maxD := s.staggerMin, s.staggerMax
	s.mu.Unlock()
	if minD <= 0 && maxD <= 0 {
		return s.ctx.Err() == nil
	}
	d := minD
	if span := maxD - minD; span > 0 {
		var b [8]byte
		if _, err := rand.Read(b[:]); err == nil {
			d += time.Duration(binary.LittleEndian.Uint64(b[:]) % uint64(span+1))
		}
	}
	if d <= 0 {
		return s.ctx.Err() == nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-s.ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func isTokenAuthFailure(step string, err error) bool {
	if err == nil {
		return false
	}
	if step == "token" {
		return true
	}
	var ue *upstream.Error
	if errors.As(err, &ue) && (ue.Status == 401 || ue.Kind == upstream.ErrSessionDead) {
		return true
	}
	low := strings.ToLower(err.Error())
	return strings.Contains(low, "401") || strings.Contains(low, "unauthorized") || strings.Contains(low, "12153") || strings.Contains(low, "invalid token")
}

func New(p *pool.Pool, fn Action) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	steps := make([]Step, 0, 4)
	for _, name := range []string{"token", "checkin", "activity", "travel"} {
		steps = append(steps, Step{Name: name, State: "pending", Accounts: []AccountResult{}})
	}
	return &Service{p: p, action: fn, ctx: ctx, cancel: cancel, state: Status{Steps: steps}}
}
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.state.Running && s.state.LastFinishedAt != "" {
		if t, err := time.Parse(time.RFC3339, s.state.LastFinishedAt); err == nil {
			if time.Since(t) > 24*time.Hour {
				s.state.LastResult = ""
				s.state.LastFailed = 0
				s.state.Steps = []Step{}
			}
		}
	}
	out := s.state
	out.Steps = append([]Step{}, s.state.Steps...)
	for i := range out.Steps {
		out.Steps[i].Accounts = append([]AccountResult{}, out.Steps[i].Accounts...)
	}
	return out
}
func (s *Service) Start() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Running || s.ctx.Err() != nil {
		return false
	}
	s.state = Status{
		RunID:          fmt.Sprintf("maintenance-%d", time.Now().UnixNano()),
		Running:        true,
		LastRunAt:      time.Now().Format(time.RFC3339),
		LastFinishedAt: s.state.LastFinishedAt,
		LastResult:     s.state.LastResult,
		LastFailed:     s.state.LastFailed,
	}
	s.deleted = make(map[string]bool)
	for _, n := range []string{"token", "checkin", "activity", "travel"} {
		s.state.Steps = append(s.state.Steps, Step{Name: n, State: "pending", Accounts: []AccountResult{}})
	}
	s.done = make(chan struct{})
	go s.run(s.done)
	return true
}

func (s *Service) SetPaused(paused bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.state.Running || s.ctx.Err() != nil {
		return false
	}
	if paused == s.state.Paused {
		return true
	}
	s.state.Paused = paused
	if paused {
		s.resume = make(chan struct{})
	} else {
		close(s.resume)
		s.resume = nil
	}
	return true
}

func (s *Service) waitUntilResumed() bool {
	for {
		s.mu.Lock()
		resume := s.resume
		s.mu.Unlock()
		if resume == nil {
			return s.ctx.Err() == nil
		}
		select {
		case <-resume:
		case <-s.ctx.Done():
			return false
		}
	}
}
func (s *Service) run(done chan struct{}) {
	defer close(done)
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.state.Running = false
		s.state.Paused = false
		s.resume = nil
		s.state.LastFinishedAt = time.Now().Format(time.RFC3339)
		s.state.LastFailed = 0
		completed := 0
		cancelled := false
		for _, st := range s.state.Steps {
			s.state.LastFailed += st.Failed
			completed += st.Completed
			if st.State == "cancelled" {
				cancelled = true
			}
		}
		switch {
		case s.state.LastFailed == 0 && !cancelled:
			s.state.LastResult = "ok"
		case completed > 0:
			s.state.LastResult = "partial"
		default:
			s.state.LastResult = "failed"
		}
		if err := s.saveLocked(); err != nil {
			log.Printf("maintenance: save failed: %v", err)
		}
	}()
	accts := s.p.List()
	skipAccount := make(map[string]bool)
	for i, name := range []string{"token", "checkin", "activity", "travel"} {
		s.mu.Lock()
		s.state.Steps[i].State = "running"
		s.state.Steps[i].StartedAt = time.Now()
		s.state.Steps[i].Total = len(accts)
		s.mu.Unlock()
		for idx, a := range accts {
			if !s.waitUntilResumed() {
				break
			}
			res := AccountResult{UID: a.UID, State: "done"}
			if skipAccount[a.UID] {
				res.State = "skipped"
				res.Message = "Token 刷新失败或 401，本轮跳过后续任务"
			} else {
				if idx > 0 {
					if !s.waitAccountStagger() {
						break
					}
				}
				_, exists := s.p.Status(a.UID)
				if !exists {
					res.State = "failed"
					res.Message = "账号不存在"
				} else {
					msg, err := s.action(s.ctx, name, a.UID)
					res.Message = msg
					if err != nil {
						res.State = "failed"
						res.Message = err.Error()
						if isTokenAuthFailure(name, err) {
							skipAccount[a.UID] = true
						} else if st, ok := s.p.Status(a.UID); ok && st.Blocked {
							skipAccount[a.UID] = true
						}
					}
				}
			}
			s.mu.Lock()
			if s.deleted[a.UID] {
				if s.state.Steps[i].Total > 0 {
					s.state.Steps[i].Total--
				}
				s.mu.Unlock()
				continue
			}
			st := &s.state.Steps[i]
			st.Accounts = append(st.Accounts, res)
			if res.State == "done" {
				st.Completed++
			}
			if res.State == "failed" {
				st.Failed++
			}
			s.mu.Unlock()
			log.Printf("[maintenance] step=%s account=%s state=%s", name, a.UID, res.State)
		}
		s.mu.Lock()
		st := &s.state.Steps[i]
		st.State = "done"
		st.FinishedAt = time.Now()
		if st.Failed > 0 {
			st.State = "failed"
		}
		if s.ctx.Err() != nil {
			st.State = "cancelled"
		}
		s.mu.Unlock()
	}
}
func (s *Service) Close() {
	s.cancel()
	s.mu.Lock()
	done := s.done
	s.mu.Unlock()
	if done != nil {
		select {
		case <-done:
		case <-time.After(30 * time.Second):
		}
	}
}
