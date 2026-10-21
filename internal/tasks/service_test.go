package tasks

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type mockTransport func(*http.Request) (*http.Response, error)

func (f mockTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func serviceFixture(t *testing.T, n int, fn mockTransport) *Service {
	t.Helper()
	p := pool.New("")
	for i := 0; i < n; i++ {
		p.Add(&auth.Auth{UID: strings.Repeat("u", i+1), AccessToken: "fake"})
	}
	c := upstream.New()
	c.HTTP.Transport = fn
	return New(Config{Pool: p, Upstream: c, ScanConcurrency: 2})
}
func taskResponse(body string) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func TestScanWithoutPanelBoundedAndMerged(t *testing.T) {
	var active, peak atomic.Int32
	s := serviceFixture(t, 12, func(r *http.Request) (*http.Response, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(time.Millisecond)
		return taskResponse(`{"code":0,"data":{"tasks":[{"task_code":"chat_5","target":5,"current":1},{"task_code":"unknown","target":1}]}}`), nil
	})
	result, err := s.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Accounts) != 12 || result.PendingCount != 12 {
		t.Fatalf("bad merged scan: %+v", result)
	}
	if peak.Load() > 2 {
		t.Fatal("scan concurrency exceeded", peak.Load())
	}
}
func TestGrowthHookDuplicateStartAndNoPending(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var first atomic.Bool
	s := serviceFixture(t, 1, func(r *http.Request) (*http.Response, error) {
		if first.CompareAndSwap(false, true) {
			close(started)
			<-release
		}
		return taskResponse(`{"code":0,"data":{"tasks":[]}}`), nil
	})
	done := make(chan struct{})
	go func() { defer close(done); s.RunGrowthQueueOnce() }()
	<-started
	ok, _, seq, _ := s.StartGrowthQueue(99, true)
	if ok || seq != -1 {
		t.Fatal("duplicate queue was not rejected")
	}
	close(release)
	<-done
	if s.QueueStatus().Running {
		t.Fatal("empty queue remained running")
	}
	s.RunGrowthQueueOnce()
}
func TestTaskLocksBoundedAndReleased(t *testing.T) {
	s := New(Config{MaxActiveAccounts: 2})
	if !s.TryLockAccount("a") || s.TryLockAccount("a") || !s.TryLockAccount("b") || s.TryLockAccount("c") {
		t.Fatal("lock bounds/exclusivity")
	}
	s.UnlockAccount("a")
	if !s.TryLockAccount("c") {
		t.Fatal("slot not returned")
	}
	s.UnlockAccount("b")
	s.UnlockAccount("c")
	if len(s.activeAccounts) != 0 {
		t.Fatal("lock map leaked")
	}
}
func TestScanCancellationAndEligibility(t *testing.T) {
	var calls atomic.Int32
	s := serviceFixture(t, 0, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return taskResponse(`{"code":0,"data":{"tasks":[]}}`), nil
	})
	s.cfg.Pool.Add(&auth.Auth{UID: "global", AccessToken: "fake", Domain: "workbuddy.ai"})
	s.cfg.Pool.Add(&auth.Auth{UID: "enterprise", AccessToken: "fake", EnterpriseID: "ent"})
	s.cfg.Pool.Add(&auth.Auth{UID: "disabled", AccessToken: "fake"})
	s.cfg.Pool.Disable("disabled", "test")
	if _, err := s.Scan(context.Background()); err != nil || calls.Load() != 0 {
		t.Fatal("ineligible account contacted upstream", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Scan(ctx); err != context.Canceled {
		t.Fatal("cancellation not honored", err)
	}
}

func TestQueueExecutesWithoutPanelAndClampsConcurrency(t *testing.T) {
	oldActions, oldGap, oldPoll := autoActions, reportGap, claimPollGap
	defer func() { autoActions = oldActions; reportGap = oldGap; claimPollGap = oldPoll }()
	reportGap = 0
	claimPollGap = 0
	var runs, active, peak atomic.Int32
	autoActions = []autoAction{{TaskCode: "test-task", run: func(s *Service, a *auth.Auth) (string, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(time.Millisecond)
		runs.Add(1)
		return "executed", nil
	}}}
	s := serviceFixture(t, 10, func(r *http.Request) (*http.Response, error) {
		return taskResponse(`{"code":0,"data":{"tasks":[{"task_code":"test-task","target":2,"current":0,"accept_status":"accepted"}]}}`), nil
	})
	started, total, seq, msg := s.StartGrowthQueue(99, true)
	if !started || total != 10 || seq != 1 {
		t.Fatal(started, total, seq, msg)
	}
	deadline := time.Now().Add(3 * time.Second)
	for s.QueueStatus().Running && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	snap := s.QueueStatus()
	if snap.Running || snap.Concurrency != 4 || runs.Load() != 10 || peak.Load() > 4 {
		t.Fatalf("unexpected queue: %+v runs=%d peak=%d", snap, runs.Load(), peak.Load())
	}
	for _, item := range snap.Items {
		if item.Status != "done" {
			t.Fatal("item lost", item)
		}
	}
	snap.Items[0].Status = "mutated"
	if s.QueueStatus().Items[0].Status == "mutated" {
		t.Fatal("snapshot aliases live state")
	}
	s.taskMu.Lock()
	remaining := len(s.activeAccounts)
	s.taskMu.Unlock()
	if remaining != 0 {
		t.Fatal("execution lock leaked")
	}
}
func TestRunAutoAllWithoutHTTP(t *testing.T) {
	s := serviceFixture(t, 1, func(r *http.Request) (*http.Response, error) {
		return taskResponse(`{"code":0,"data":{"tasks":[]}}`), nil
	})
	result, err := s.RunAutoAll(context.Background(), "u")
	if err != nil || len(result) != len(autoActions) {
		t.Fatal("standalone algorithm unavailable", len(result), err)
	}
	for _, item := range result {
		if item["status"] != "skipped" {
			t.Fatal(item)
		}
	}
}
