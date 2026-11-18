package tasks

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestTasksScanAndQueueSkipBlockedAccounts(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"tasks":[]}}`))
	}))
	defer srv.Close()

	p := pool.New("")
	p.Add(&auth.Auth{UID: "u-blocked-task", AccessToken: "tok-b1"})
	p.Disable("u-blocked-task", "invalid token")
	st, ok := p.Status("u-blocked-task")
	if !ok || !st.Blocked {
		t.Fatalf("expected u-blocked-task to be marked Blocked, got %+v", st)
	}
	up := &upstream.Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, BillingBaseCN: srv.URL}

	svc := New(Config{Pool: p, Upstream: up})
	if _, err := svc.Scan(context.Background()); err != nil {
		t.Fatalf("Scan failed: %v", err)
	}
	svc.RunGrowthQueueOnce()
	time.Sleep(30 * time.Millisecond)

	if got := hits.Load(); got != 0 {
		t.Fatalf("expected blocked account to be skipped in Scan and StartQueue (0 upstream hits), got %d", got)
	}
}
