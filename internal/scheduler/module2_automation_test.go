package scheduler

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

func TestStartBalanceRefreshColdStartHotActivate(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"total":1000,"used":100,"remain":900,"packages":[]}}`))
	}))
	defer srv.Close()

	p := pool.New("")
	p.Add(&auth.Auth{UID: "u-cold-1", AccessToken: "tok-1"})
	up := &upstream.Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, BillingBaseCN: srv.URL}

	s := New(Config{
		Pool:              p,
		Upstream:          up,
		AutoJitterMax:     -1,
		AccountStaggerMin: -1,
		AccountStaggerMax: -1,
	})
	if len(s.cfg.GrowthHours) != 1 || s.cfg.GrowthHours[0] != 1 {
		t.Fatalf("expected GrowthHours default [1], got %v", s.cfg.GrowthHours)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Cold start with interval=0 (disabled at boot), then hot-enable via SetBalanceInterval.
	s.StartBalanceRefresh(ctx, 0)
	time.Sleep(30 * time.Millisecond)
	if hits.Load() != 0 {
		t.Fatalf("expected 0 hits while interval=0, got %d", hits.Load())
	}
	s.SetBalanceInterval(20 * time.Millisecond)

	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if hits.Load() > 0 {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatal("expected hot-activated balance refresh to fire after cold start with interval=0")
}

func TestScheduledTasksSkipBlockedAccounts(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{}}`))
	}))
	defer srv.Close()

	p := pool.New("")
	p.Add(&auth.Auth{UID: "u-blocked-1", AccessToken: "tok-b1"})
	p.Disable("u-blocked-1", "invalid token")
	st, ok := p.Status("u-blocked-1")
	if !ok || !st.Blocked {
		t.Fatalf("expected u-blocked-1 to be marked Blocked, got %+v", st)
	}
	up := &upstream.Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, BillingBaseCN: srv.URL}

	origNow := nowForNightWindow
	nowForNightWindow = func() time.Time {
		return time.Date(2026, 11, 18, 23, 30, 0, 0, beijingLocation)
	}
	defer func() { nowForNightWindow = origNow }()

	s := New(Config{
		Pool:              p,
		Upstream:          up,
		AutoJitterMax:     -1,
		AccountStaggerMin: -1,
		AccountStaggerMax: -1,
	})

	s.RunCheckinNow()
	s.RunActivityNow()
	s.RunTravelNow()
	s.RunBlackcatNow()
	s.RunStreakBonusNow()

	if got := hits.Load(); got != 0 {
		t.Fatalf("expected blocked account to trigger 0 upstream calls across checkin/activity/travel/blackcat/streak, got %d", got)
	}
}
