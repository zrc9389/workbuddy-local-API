package scheduler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func jitterTestEnv(t *testing.T, uids ...string) (*pool.Pool, *upstream.Client, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v2/billing/meter/daily-checkin":
			_, _ = w.Write([]byte(`{"code":0,"data":{}}`))
		case r.URL.Path == "/v2/billing/meter/get-user-resource":
			_, _ = w.Write([]byte(`{"code":0,"data":{"packageList":[]}}`))
		case r.URL.Path == "/v2/report":
			_, _ = w.Write([]byte(`{"code":0}`))
		case r.URL.Path == "/activity/growth/buddy/info":
			_, _ = w.Write([]byte(`{"code":0,"data":{"buddy":{"id":1}}}`))
		case r.URL.Path == "/activity/growth/buddy/travel/status":
			_, _ = w.Write([]byte(`{"code":0,"data":{"state":"traveling","record_id":9}}`))
		case r.URL.Path == "/v2/activity/growth/tasks":
			_, _ = w.Write([]byte(`{"code":0,"data":{"tasks":[]}}`))
		case r.URL.Path == "/activity/growth/streak" || r.URL.Path == "/v2/activity/growth/streak":
			_, _ = w.Write([]byte(`{"code":0,"data":{"days":3,"redemptionStatus":{"tiers":[]},"makeupCards":{"balance":0}}}`))
		case r.URL.Path == "/activity/growth/lottery/summary" || r.URL.Path == "/v2/activity/growth/lottery/summary":
			_, _ = w.Write([]byte(`{"code":0,"data":{"chances":0}}`))
		case r.URL.Path == "/activity/growth/heatmap" || r.URL.Path == "/v2/activity/growth/heatmap":
			_, _ = w.Write([]byte(`{"code":0,"data":{"days":[]}}`))
		case r.URL.Path == "/v2/token/refresh" || r.URL.Path == "/token/refresh":
			_, _ = w.Write([]byte(`{"code":0,"data":{"accessToken":"new-at","refreshToken":"new-rt","expiresIn":7200}}`))
		default:
			_, _ = w.Write([]byte(`{"code":0,"data":{}}`))
		}
	}))
	t.Cleanup(srv.Close)

	p := pool.New("")
	for _, uid := range uids {
		p.Add(&auth.Auth{
			UID:          uid,
			AccessToken:  "at-" + uid,
			RefreshToken: "rt-" + uid,
			ExpiresAt:    9999999999,
		})
	}
	up := &upstream.Client{
		HTTP:          srv.Client(),
		ChatBaseCN:    srv.URL,
		BillingBaseCN: srv.URL,
		WebBaseCN:     srv.URL,
	}
	return p, up, &hits
}

// TestRunBatchAppliesWakeupJitterAndAccountStagger 验证后台自动排程触发时：
//   - 每类任务均施加非零唤醒随机抖动（落在默认 (0, 3m] 内）；
//   - 遍历多账号时账号间均施加随机错峰间隔（落在默认 [2s, 8s] 内）；
//   - 借助注入钩子毫秒级跑完，零 flaky。
func TestRunBatchAppliesWakeupJitterAndAccountStagger(t *testing.T) {
	restoreClock := nowForNightWindow
	nowForNightWindow = func() time.Time { return time.Date(2026, 10, 7, 23, 30, 0, 0, time.Local) }
	t.Cleanup(func() { nowForNightWindow = restoreClock })

	p, up, hits := jitterTestEnv(t, "u1", "u2", "u3")
	var growthCalled atomic.Int32
	s := New(Config{
		Pool:       p,
		Upstream:   up,
		GrowthHook: func() { growthCalled.Add(1) },
	})

	var mu sync.Mutex
	var sleeps []time.Duration
	s.sleepFn = func(ctx context.Context, d time.Duration) bool {
		mu.Lock()
		sleeps = append(sleeps, d)
		mu.Unlock()
		return ctx.Err() == nil
	}
	s.randInt63n = func(n int64) int64 {
		return n / 2 // 稳定落在区间中段，非零且不靠边界
	}

	start := time.Now()
	s.runBatch(context.Background(), []taskKind{
		taskCheckin,
		taskTravel,
		taskActivity,
		taskKeepalive,
		taskBlackcat,
		taskGrowth,
	})
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("injected sleepFn should keep test fast, took %v", elapsed)
	}
	if growthCalled.Load() != 1 {
		t.Fatalf("expected GrowthHook called once, got %d", growthCalled.Load())
	}
	if hits.Load() == 0 {
		t.Fatal("expected upstream calls from scheduled batch")
	}

	mu.Lock()
	defer mu.Unlock()

	var wakeupCount, staggerCount int
	for _, d := range sleeps {
		if d <= 0 {
			t.Fatalf("recorded non-positive jitter sleep: %v", d)
		}
		if d >= defaultAccountStaggerMin && d <= defaultAccountStaggerMax {
			staggerCount++
		} else if d > defaultAccountStaggerMax && d <= defaultAutoJitterMax {
			wakeupCount++
		} else {
			t.Fatalf("unexpected sleep duration %v (not in wakeup or stagger band)", d)
		}
	}
	// 6 类任务每类 1 次唤醒抖动
	if wakeupCount != 6 {
		t.Fatalf("expected 6 wakeup jitter sleeps (one per task kind), got %d (all sleeps=%v)", wakeupCount, sleeps)
	}
	// 3 个账号 -> 每轮多账号任务有 2 次账号间错峰；
	// 覆盖 checkin(2) + streak(2) + travel(2) + balanceRefresh(2) + activity(2) + keepalive(2) + blackcat(2) = 14 次
	if staggerCount != 14 {
		t.Fatalf("expected 14 per-account stagger sleeps across 7 account loops, got %d (all sleeps=%v)", staggerCount, sleeps)
	}
}

// TestAutoJitterRespectsContextCancel 验证唤醒抖动与账号间错峰均可被 ctx.Done() 立即取消。
func TestAutoJitterRespectsContextCancel(t *testing.T) {
	t.Run("cancel during wakeup jitter aborts before upstream calls", func(t *testing.T) {
		p, up, hits := jitterTestEnv(t, "u1", "u2")
		s := New(Config{
			Pool:          p,
			Upstream:      up,
			AutoJitterMax: 5 * time.Minute,
		})
		// 走真实 sleepCtx，不注入 sleepFn，验证真实 timer 可被 ctx 瞬间打断。
		s.randInt63n = func(n int64) int64 { return n - 1 } // 强制选到满额 5m

		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			s.runBatch(ctx, []taskKind{taskKeepalive})
			close(done)
		}()

		time.Sleep(25 * time.Millisecond)
		cancel()

		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("runBatch did not abort promptly on ctx cancel during wakeup jitter")
		}
		if hits.Load() != 0 {
			t.Fatalf("expected 0 upstream calls after wakeup cancel, got %d", hits.Load())
		}
	})

	t.Run("cancel during per-account stagger stops remaining accounts", func(t *testing.T) {
		p, up, hits := jitterTestEnv(t, "u1", "u2", "u3")
		s := New(Config{
			Pool:              p,
			Upstream:          up,
			AutoJitterMax:     -1, // 关闭唤醒抖动，直接测试账号间错峰取消
			AccountStaggerMin: 5 * time.Minute,
			AccountStaggerMax: 5 * time.Minute,
		})

		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			s.runBatch(ctx, []taskKind{taskKeepalive})
			close(done)
		}()

		// 等第 1 个账号完成并进入账号间 5m 错峰后取消
		deadline := time.Now().Add(time.Second)
		for hits.Load() < 1 && time.Now().Before(deadline) {
			time.Sleep(5 * time.Millisecond)
		}
		cancel()

		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("runBatch did not abort promptly on ctx cancel during account stagger")
		}
		if got := hits.Load(); got != 1 {
			t.Fatalf("expected only 1st account to run before stagger cancel, got %d upstream hits", got)
		}
	})
}

// TestManualRunNowDoesNotBlockOnAutoJitter 验证面板手动立即执行入口（Run*Now）
// 绝不会阻塞在后台唤醒抖动或账号间自动错峰上。
func TestManualRunNowDoesNotBlockOnAutoJitter(t *testing.T) {
	restoreClock := nowForNightWindow
	nowForNightWindow = func() time.Time { return time.Date(2026, 10, 7, 23, 30, 0, 0, time.Local) }
	t.Cleanup(func() { nowForNightWindow = restoreClock })

	oldAct := activityAccountDelay
	oldTrv := travelAccountDelay
	oldAdopt := adoptReportGap
	activityAccountDelay = 0
	travelAccountDelay = 0
	adoptReportGap = 0
	t.Cleanup(func() {
		activityAccountDelay = oldAct
		travelAccountDelay = oldTrv
		adoptReportGap = oldAdopt
	})

	p, up, hits := jitterTestEnv(t, "u1", "u2", "u3")
	s := New(Config{
		Pool:              p,
		Upstream:          up,
		AutoJitterMax:     10 * time.Minute,
		AccountStaggerMin: 30 * time.Second,
		AccountStaggerMax: 60 * time.Second,
	})
	s.sleepFn = func(ctx context.Context, d time.Duration) bool {
		if d > 0 {
			t.Errorf("manual Run*Now unexpectedly slept for %v", d)
		}
		return true
	}

	start := time.Now()
	s.RunCheckinNow()
	s.RunStreakBonusNow()
	s.RunTravelNow()
	s.RunActivityNow()
	s.RunKeepaliveNow()
	s.RunBlackcatNow()
	s.RunBalanceRefreshNow()

	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("manual Run*Now blocked too long: %v", elapsed)
	}
	if hits.Load() == 0 {
		t.Fatal("expected manual Run*Now calls to hit upstream")
	}
}

// TestStartBalanceRefreshAppliesCappedWakeupAndStagger 验证后台周期余额刷新同样施加
// 封顶唤醒抖动（<= interval/4）与账号间随机错峰。
func TestStartBalanceRefreshAppliesCappedWakeupAndStagger(t *testing.T) {
	p, up, hits := jitterTestEnv(t, "u1", "u2")
	s := New(Config{
		Pool:     p,
		Upstream: up,
	})

	var mu sync.Mutex
	var sleeps []time.Duration
	fired := make(chan struct{}, 1)
	s.sleepFn = func(ctx context.Context, d time.Duration) bool {
		mu.Lock()
		sleeps = append(sleeps, d)
		if len(sleeps) >= 2 {
			select {
			case fired <- struct{}{}:
			default:
			}
		}
		mu.Unlock()
		return ctx.Err() == nil
	}
	s.randInt63n = func(n int64) int64 { return n / 2 }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.StartBalanceRefresh(ctx, 40*time.Millisecond)

	select {
	case <-fired:
	case <-time.After(time.Second):
		t.Fatal("StartBalanceRefresh did not trigger within 1s")
	}
	cancel()

	// 等一下本轮余额刷新 goroutine 写完 hits
	deadline := time.Now().Add(500 * time.Millisecond)
	for hits.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(sleeps) < 2 {
		t.Fatalf("expected wakeup + stagger sleeps, got %v", sleeps)
	}
	if sleeps[0] <= 0 || sleeps[0] > 10*time.Millisecond {
		t.Fatalf("expected balance wakeup jitter in (0, 10ms], got %v", sleeps[0])
	}
	if sleeps[1] < defaultAccountStaggerMin || sleeps[1] > defaultAccountStaggerMax {
		t.Fatalf("expected balance per-account stagger in [%v, %v], got %v",
			defaultAccountStaggerMin, defaultAccountStaggerMax, sleeps[1])
	}
}
