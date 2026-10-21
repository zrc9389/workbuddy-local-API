package metacore

import (
	"context"
	"errors"
	"net/url"
	"sync"
	"time"
)

const delayTestURL = "https://www.gstatic.com/generate_204"

type TestJob struct {
	Demo      bool   `json:"demo"`
	ID        string `json:"id"`
	Running   bool   `json:"running"`
	Total     int    `json:"total"`
	Completed int    `json:"completed"`
	Failed    int    `json:"failed"`
	Cancelled bool   `json:"cancelled"`
}

func (m *Manager) Tests() TestJob { m.mu.Lock(); defer m.mu.Unlock(); return m.job }
func (m *Manager) CancelTests() TestJob {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.testCancel != nil && m.job.Running {
		m.job.Cancelled = true
		m.testCancel()
	}
	return m.job
}
func (m *Manager) StartTests(ctx context.Context) (TestJob, error) {
	if err := m.lock(); err != nil {
		return TestJob{}, err
	}
	defer m.unlock()
	m.mu.Lock()
	busy := m.job.Running
	m.mu.Unlock()
	if busy {
		return TestJob{}, ErrBusy
	}
	if err := m.ensure(ctx); err != nil {
		return TestJob{}, err
	}
	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		return TestJob{}, ErrInvalid
	}
	id, err := randomToken()
	if err != nil {
		return TestJob{}, err
	}
	jobCtx, cancel := context.WithTimeout(m.ctx, 30*time.Minute)
	j := TestJob{Demo: m.opts.Demo, ID: id, Running: true, Total: len(nodes)}
	m.mu.Lock()
	m.job = j
	m.testCancel = cancel
	m.lastUse = time.Now()
	m.mu.Unlock()
	m.wg.Add(1)
	go m.runTests(jobCtx, cancel, nodes)
	return j, nil
}
func (m *Manager) runTests(ctx context.Context, cancel context.CancelFunc, nodes []Node) {
	defer m.wg.Done()
	defer cancel()
	queue := make(chan Node)
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for n := range queue {
				if ctx.Err() != nil {
					return
				}
				m.testNode(ctx, n)
			}
		}()
	}
send:
	for _, n := range nodes {
		select {
		case <-ctx.Done():
			break send
		case queue <- n:
		}
	}
	close(queue)
	workers.Wait()
	m.mu.Lock()
	m.job.Running = false
	if ctx.Err() != nil {
		m.job.Cancelled = true
	}
	m.testCancel = nil
	m.mu.Unlock()
}
func (m *Manager) testNode(ctx context.Context, n Node) {
	m.mu.Lock()
	current := m.nodes[n.ID]
	current.Status = "testing"
	m.nodes[n.ID] = current
	m.mu.Unlock()
	one, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	var result struct {
		Delay int `json:"delay"`
	}
	path := "/providers/proxies/" + url.PathEscape(n.Provider) + "/" + url.PathEscape(n.Name) + "/healthcheck?url=" + url.QueryEscape(delayTestURL) + "&timeout=5000"
	err := m.core.Request(one, "GET", path, nil, &result)
	now := time.Now().UTC()
	m.mu.Lock()
	defer m.mu.Unlock()
	current = m.nodes[n.ID]
	current.TestedAt = &now
	current.DelayMS = nil
	current.Status = "ok"
	if err != nil || result.Delay <= 0 {
		current.Status = "error"
		result.Delay = 0
		if one.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
			current.Status = "timeout"
		}
		m.job.Failed++
	} else {
		delay := result.Delay
		current.DelayMS = &delay
	}
	current.History = append(current.History, History{Delay: result.Delay, Time: now})
	if len(current.History) > 10 {
		current.History = append([]History{}, current.History[len(current.History)-10:]...)
	}
	m.nodes[n.ID] = current
	m.job.Completed++
}
