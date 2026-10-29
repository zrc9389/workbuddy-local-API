// Package maintenance owns the one-click four-step run; no timers or UI dependency.
package maintenance

import (
	"context"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"log"
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
	for i, name := range []string{"token", "checkin", "activity", "travel"} {
		s.mu.Lock()
		s.state.Steps[i].State = "running"
		s.state.Steps[i].StartedAt = time.Now()
		s.state.Steps[i].Total = len(accts)
		s.mu.Unlock()
		for _, a := range accts {
			if !s.waitUntilResumed() {
				break
			}
			res := AccountResult{UID: a.UID, State: "done"}
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
