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
	Name      string          `json:"name"`
	State     string          `json:"state"`
	Completed int             `json:"completed"`
	Failed    int             `json:"failed"`
	Accounts  []AccountResult `json:"accounts"`
}
type Status struct {
	RunID   string `json:"run_id"`
	Running bool   `json:"running"`
	Steps   []Step `json:"steps"`
}
type Service struct {
	mu     sync.Mutex
	p      *pool.Pool
	action Action
	state  Status
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
}

func New(p *pool.Pool, fn Action) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{p: p, action: fn, ctx: ctx, cancel: cancel, state: Status{Steps: []Step{}}}
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
	s.state = Status{RunID: fmt.Sprintf("maintenance-%d", time.Now().UnixNano()), Running: true}
	for _, n := range []string{"token", "checkin", "activity", "travel"} {
		s.state.Steps = append(s.state.Steps, Step{Name: n, State: "pending", Accounts: []AccountResult{}})
	}
	s.done = make(chan struct{})
	go s.run(s.done)
	return true
}
func (s *Service) run(done chan struct{}) {
	defer close(done)
	defer func() { s.mu.Lock(); s.state.Running = false; s.mu.Unlock() }()
	accts := s.p.List()
	for i, name := range []string{"token", "checkin", "activity", "travel"} {
		s.mu.Lock()
		s.state.Steps[i].State = "running"
		s.mu.Unlock()
		for _, a := range accts {
			if s.ctx.Err() != nil {
				break
			}
			res := AccountResult{UID: a.UID, State: "done"}
			if a.ManualDisabled {
				res.State = "skipped"
				res.Message = "用户手动禁用"
			} else {
				msg, err := s.action(s.ctx, name, a.UID)
				res.Message = msg
				if err != nil {
					res.State = "failed"
					res.Message = err.Error()
				}
			}
			s.mu.Lock()
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
