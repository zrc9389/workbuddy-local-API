package upstream

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

func TestEgressGuardSameAccountConcurrentMaxInFlight(t *testing.T) {
	g := NewEgressGuard(EgressGuardOptions{
		AcquireTimeout: 2 * time.Second,
		MinSwitchGap:   80 * time.Millisecond,
	})
	const key = "ip:203.0.113.1"

	releases := make([]func(), 3)
	for i := 0; i < 3; i++ {
		rel, err := g.Acquire(context.Background(), key, "acct-A")
		if err != nil {
			t.Fatalf("same-account acquire #%d failed: %v", i+1, err)
		}
		releases[i] = rel
	}

	// 同账号 3 个在途请求同时持有；幂等重复释放不能破坏引用计数。
	releases[0]()
	releases[0]() // idempotent second call

	// 此时 acct-A 仍有 2 个在途请求，acct-B 必须被阻塞（超时 fail-closed）。
	shortCtx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if _, err := g.Acquire(shortCtx, key, "acct-B"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded while acct-A still holds 2 slots, got %v", err)
	}

	releases[1]()
	releases[2]()
	releases[2]() // idempotent
}

func TestEgressGuardCrossAccountSerialAndSwitchGap(t *testing.T) {
	const gap = 80 * time.Millisecond
	g := NewEgressGuard(EgressGuardOptions{
		AcquireTimeout: 2 * time.Second,
		MinSwitchGap:   gap,
	})
	const key = "ip:198.51.100.7"

	// 账号 A 同时持有 2 个在途请求
	relA1, err := g.Acquire(context.Background(), key, "acct-A")
	if err != nil {
		t.Fatal(err)
	}
	relA2, err := g.Acquire(context.Background(), key, "acct-A")
	if err != nil {
		t.Fatal(err)
	}

	var bAcquiredAt time.Time
	bDone := make(chan error, 1)
	go func() {
		relB, err := g.Acquire(context.Background(), key, "acct-B")
		if err != nil {
			bDone <- err
			return
		}
		bAcquiredAt = time.Now()
		relB()
		bDone <- nil
	}()

	// 先释放第 1 个，A 仍持有第 2 个，B 不得进入
	time.Sleep(25 * time.Millisecond)
	relA1()
	select {
	case err := <-bDone:
		t.Fatalf("acct-B entered before acct-A fully released: err=%v", err)
	case <-time.After(30 * time.Millisecond):
	}

	// 释放最后一个后，B 必须等到至少 gap 后才进入
	aAllReleasedAt := time.Now()
	relA2()

	select {
	case err := <-bDone:
		if err != nil {
			t.Fatalf("acct-B acquire failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("acct-B did not acquire after acct-A released")
	}

	waited := bAcquiredAt.Sub(aAllReleasedAt)
	if waited < gap-5*time.Millisecond {
		t.Fatalf("cross-account switch gap violated: waited=%v want>=%v", waited, gap)
	}
}

func TestEgressGuardFailClosedOnTimeoutAndCancel(t *testing.T) {
	t.Run("acquire timeout fail-closed", func(t *testing.T) {
		g := NewEgressGuard(EgressGuardOptions{
			AcquireTimeout: 60 * time.Millisecond,
			MinSwitchGap:   20 * time.Millisecond,
		})
		relA, err := g.Acquire(context.Background(), "ip:1.2.3.4", "acct-A")
		if err != nil {
			t.Fatal(err)
		}
		defer relA()

		start := time.Now()
		_, err = g.Acquire(context.Background(), "ip:1.2.3.4", "acct-B")
		if !errors.Is(err, ErrEgressGuardTimeout) {
			t.Fatalf("expected ErrEgressGuardTimeout, got %v", err)
		}
		if elapsed := time.Since(start); elapsed < 45*time.Millisecond {
			t.Fatalf("returned too early: %v", elapsed)
		}
	})

	t.Run("ctx cancel during wait wakes next FIFO waiter", func(t *testing.T) {
		g := NewEgressGuard(EgressGuardOptions{
			AcquireTimeout: 2 * time.Second,
			MinSwitchGap:   60 * time.Millisecond,
		})
		const key = "ip:1.2.3.5"
		relA, err := g.Acquire(context.Background(), key, "acct-A")
		if err != nil {
			t.Fatal(err)
		}

		ctxB, cancelB := context.WithCancel(context.Background())
		errB := make(chan error, 1)
		go func() {
			_, err := g.Acquire(ctxB, key, "acct-B")
			errB <- err
		}()

		time.Sleep(15 * time.Millisecond)
		errC := make(chan error, 1)
		go func() {
			relC, err := g.Acquire(context.Background(), key, "acct-C")
			if err == nil {
				relC()
			}
			errC <- err
		}()

		// 释放 A，B 处于 MinSwitchGap 等待阶段时取消 B，C 应顺位拿到
		time.Sleep(15 * time.Millisecond)
		relA()
		time.Sleep(15 * time.Millisecond)
		cancelB()

		if err := <-errB; !errors.Is(err, context.Canceled) {
			t.Fatalf("expected acct-B context.Canceled, got %v", err)
		}
		select {
		case err := <-errC:
			if err != nil {
				t.Fatalf("expected acct-C to succeed after acct-B canceled, got %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("acct-C stalled after acct-B canceled")
		}
	})

	t.Run("pre-canceled ctx fails immediately", func(t *testing.T) {
		g := NewEgressGuard(DefaultEgressGuardOptions())
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := g.Acquire(ctx, "ip:1.2.3.6", "acct-A"); !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled, got %v", err)
		}
	})
}

func TestEgressGuardDifferentKeysRunConcurrently(t *testing.T) {
	g := NewEgressGuard(EgressGuardOptions{
		AcquireTimeout: 2 * time.Second,
		MinSwitchGap:   500 * time.Millisecond,
	})

	relA, err := g.Acquire(context.Background(), "ip:10.0.0.1", "acct-A")
	if err != nil {
		t.Fatal(err)
	}
	defer relA()

	start := time.Now()
	relB, err := g.Acquire(context.Background(), "ip:10.0.0.2", "acct-B")
	if err != nil {
		t.Fatalf("different key should not block: %v", err)
	}
	defer relB()

	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("different keys interfered: elapsed=%v", elapsed)
	}
}

func TestEgressKeyNormalizationAndPriority(t *testing.T) {
	c := New()
	a1 := &auth.Auth{UID: "u1", ProxyURL: "HTTP://userA:secretA@proxy.example.com/"}
	a2 := &auth.Auth{UID: "u2", ProxyURL: "http://userB:secretB@PROXY.EXAMPLE.COM:80"}

	k1 := c.egressKeyFor(a1)
	k2 := c.egressKeyFor(a2)
	if k1 != "proxy:http://proxy.example.com:80" || k1 != k2 {
		t.Fatalf("normalized proxy keys mismatch: k1=%q k2=%q", k1, k2)
	}
	if strings.Contains(k1, "secretA") || strings.Contains(k2, "secretB") {
		t.Fatalf("proxy key leaked credentials: %q / %q", k1, k2)
	}

	// 无代理且无 ExitIPResolver 时返回空键（不阻塞单测直连）
	if empty := c.egressKeyFor(&auth.Auth{UID: "direct"}); empty != "" {
		t.Fatalf("expected empty key for direct account, got %q", empty)
	}

	// ExitIPResolver 优先级高于 ProxyURL：不同代理 URL 落到同一 exit_ip 时命中同一键
	c.ExitIPResolver = func(a *auth.Auth) string {
		if a == nil {
			return ""
		}
		return "203.0.113.99"
	}
	b1 := &auth.Auth{UID: "u1", ProxyURL: "http://proxy-1.test:8080"}
	b2 := &auth.Auth{UID: "u2", ProxyURL: "socks5://proxy-2.test:1080"}
	if got1, got2 := c.egressKeyFor(b1), c.egressKeyFor(b2); got1 != "ip:203.0.113.99" || got1 != got2 {
		t.Fatalf("ExitIPResolver must take priority over ProxyURL: got1=%q got2=%q", got1, got2)
	}
}

func TestEgressGuardEndToEndDifferentProxiesSameExitIP(t *testing.T) {
	const gap = 70 * time.Millisecond
	var inFlight atomic.Int32
	var maxConcurrent atomic.Int32
	var mu sync.Mutex
	var aLeftAt, bEnteredAt time.Time
	aEntered := make(chan struct{})
	releaseAUpstream := make(chan struct{})

	makeProxy := func(tag string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cur := inFlight.Add(1)
			for {
				prev := maxConcurrent.Load()
				if cur <= prev || maxConcurrent.CompareAndSwap(prev, cur) {
					break
				}
			}
			defer inFlight.Add(-1)

			if tag == "A" {
				close(aEntered)
				<-releaseAUpstream
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("resp-A"))
				return
			}
			mu.Lock()
			bEnteredAt = time.Now()
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("resp-B"))
		}))
	}

	proxyA := makeProxy("A")
	defer proxyA.Close()
	proxyB := makeProxy("B")
	defer proxyB.Close()

	c := New()
	c.EgressGuard = NewEgressGuard(EgressGuardOptions{
		AcquireTimeout: 2 * time.Second,
		MinSwitchGap:   gap,
	})
	// 两个账号配了不同的代理地址，但 ExitIPResolver 告知它们落到同一个出口 IP
	c.ExitIPResolver = func(a *auth.Auth) string { return "198.51.100.42" }

	acctA := &auth.Auth{UID: "acct-A", ProxyURL: proxyA.URL}
	acctB := &auth.Auth{UID: "acct-B", ProxyURL: proxyB.URL}

	reqA, _ := http.NewRequest(http.MethodGet, "http://upstream.test/v1", nil)
	respACh := make(chan *http.Response, 1)
	errACh := make(chan error, 1)
	go func() {
		resp, err := c.DoAccount(reqA, acctA)
		if err != nil {
			errACh <- err
			return
		}
		respACh <- resp
	}()

	<-aEntered

	// 账号 B 在账号 A 仍在途时发起请求：必须被门禁串行阻塞
	reqB, _ := http.NewRequest(http.MethodGet, "http://upstream.test/v1", nil)
	errBCh := make(chan error, 1)
	go func() {
		resp, err := c.DoAccount(reqB, acctB)
		if err != nil {
			errBCh <- err
			return
		}
		_, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		errBCh <- nil
	}()

	// 放行上游响应，但暂不关闭 respA.Body：流式场景下门禁必须继续持有到 Body.Close()
	close(releaseAUpstream)
	var respA *http.Response
	select {
	case err := <-errACh:
		t.Fatalf("acct-A request failed: %v", err)
	case respA = <-respACh:
	case <-time.After(2 * time.Second):
		t.Fatal("acct-A response timeout")
	}

	// 读取完前尚未 Close：确认 B 仍未完成
	select {
	case err := <-errBCh:
		t.Fatalf("acct-B should remain blocked until acct-A Body.Close(), err=%v", err)
	case <-time.After(40 * time.Millisecond):
	}

	_, _ = io.ReadAll(respA.Body)
	mu.Lock()
	aLeftAt = time.Now()
	mu.Unlock()
	_ = respA.Body.Close()

	select {
	case err := <-errBCh:
		if err != nil {
			t.Fatalf("acct-B request failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("acct-B did not complete after acct-A closed body")
	}

	if maxConcurrent.Load() != 1 {
		t.Fatalf("expected strictly serial execution across accounts sharing exit IP, maxConcurrent=%d", maxConcurrent.Load())
	}
	mu.Lock()
	waited := bEnteredAt.Sub(aLeftAt)
	mu.Unlock()
	if waited < gap-5*time.Millisecond {
		t.Fatalf("expected >=%v switch gap after Body.Close(), got %v", gap, waited)
	}
}

func TestEgressGuardTransportReleaseOnErrorAndReverseOrder(t *testing.T) {
	t.Run("releases guard and lease on roundtrip error", func(t *testing.T) {
		var leaseActive atomic.Int32
		c := New()
		c.EgressGuard = NewEgressGuard(EgressGuardOptions{
			AcquireTimeout: time.Second,
			MinSwitchGap:   -1, // disable gap for fast check
		})
		c.AccountLease = func(context.Context, *auth.Auth) (func(), error) {
			leaseActive.Add(1)
			return func() { leaseActive.Add(-1) }, nil
		}
		c.ExitIPResolver = func(*auth.Auth) string { return "198.51.100.88" }
		c.HTTP.Transport = leaseRoundTrip(func(r *http.Request) (*http.Response, error) {
			return nil, errors.New("boom")
		})

		req, _ := http.NewRequest(http.MethodGet, "http://fixture.invalid/err", nil)
		if _, err := c.DoAccount(req, &auth.Auth{UID: "acct-A"}); err == nil {
			t.Fatal("expected transport error")
		}
		if leaseActive.Load() != 0 {
			t.Fatalf("account lease leaked on error: active=%d", leaseActive.Load())
		}
		// 另一账号应立即拿到同一出口，证明 EgressGuard 已释放
		rel, err := c.EgressGuard.Acquire(context.Background(), "ip:198.51.100.88", "acct-B")
		if err != nil {
			t.Fatalf("egress guard leaked on error: %v", err)
		}
		rel()
	})

	t.Run("releases account lease if egress guard fails closed", func(t *testing.T) {
		var leaseActive atomic.Int32
		var rtCalled atomic.Int32
		c := New()
		c.EgressGuard = NewEgressGuard(EgressGuardOptions{
			AcquireTimeout: 40 * time.Millisecond,
			MinSwitchGap:   10 * time.Millisecond,
		})
		c.AccountLease = func(context.Context, *auth.Auth) (func(), error) {
			leaseActive.Add(1)
			return func() { leaseActive.Add(-1) }, nil
		}
		c.ExitIPResolver = func(*auth.Auth) string { return "198.51.100.89" }
		c.HTTP.Transport = leaseRoundTrip(func(r *http.Request) (*http.Response, error) {
			rtCalled.Add(1)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("ok")), Header: make(http.Header)}, nil
		})

		// 先由 acct-A 占住出口
		relA, err := c.EgressGuard.Acquire(context.Background(), "ip:198.51.100.89", "acct-A")
		if err != nil {
			t.Fatal(err)
		}
		defer relA()

		req, _ := http.NewRequest(http.MethodGet, "http://fixture.invalid/blocked", nil)
		_, err = c.DoAccount(req, &auth.Auth{UID: "acct-B"})
		if !errors.Is(err, ErrEgressGuardTimeout) {
			t.Fatalf("expected ErrEgressGuardTimeout, got %v", err)
		}
		if rtCalled.Load() != 0 {
			t.Fatalf("underlying transport must not be called when guard fails closed")
		}
		if leaseActive.Load() != 0 {
			t.Fatalf("account lease must be released when guard fails closed: active=%d", leaseActive.Load())
		}
	})

	t.Run("releases egress guard before account lease on body close", func(t *testing.T) {
		c := New()
		c.EgressGuard = NewEgressGuard(EgressGuardOptions{
			AcquireTimeout: time.Second,
			MinSwitchGap:   -1,
		})
		c.ExitIPResolver = func(*auth.Auth) string { return "198.51.100.90" }
		var guardWasFreeOnLeaseRelease bool
		c.AccountLease = func(context.Context, *auth.Auth) (func(), error) {
			return func() {
				// 此时 EgressGuard 应已先于 AccountLease 释放，acct-B 可以立即非阻塞获取。
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
				defer cancel()
				if rel, err := c.EgressGuard.Acquire(ctx, "ip:198.51.100.90", "acct-B"); err == nil {
					guardWasFreeOnLeaseRelease = true
					rel()
				}
			}, nil
		}
		c.HTTP.Transport = leaseRoundTrip(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("ok")), Header: make(http.Header)}, nil
		})

		req, _ := http.NewRequest(http.MethodGet, "http://fixture.invalid/order", nil)
		resp, err := c.DoAccount(req, &auth.Auth{UID: "acct-A"})
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if !guardWasFreeOnLeaseRelease {
			t.Fatal("expected EgressGuard to be released before AccountLease")
		}
	})
}

func TestEgressGuardConcurrentStressNoCrossAccountOverlap(t *testing.T) {
	const gap = 15 * time.Millisecond
	g := NewEgressGuard(EgressGuardOptions{
		AcquireTimeout: 5 * time.Second,
		MinSwitchGap:   gap,
	})
	const key = "ip:203.0.113.200"

	var mu sync.Mutex
	curOwner := ""
	curActive := 0
	lastOwner := ""
	lastReleased := time.Time{}

	accounts := []string{"acct-1", "acct-2", "acct-3", "acct-4"}
	var wg sync.WaitGroup
	errCh := make(chan error, len(accounts)*3)

	for _, uid := range accounts {
		for j := 0; j < 3; j++ {
			wg.Add(1)
			go func(uid string) {
				defer wg.Done()
				rel, err := g.Acquire(context.Background(), key, uid)
				if err != nil {
					errCh <- err
					return
				}
				now := time.Now()
				mu.Lock()
				if curActive > 0 && curOwner != uid {
					mu.Unlock()
					rel()
					errCh <- errors.New("cross-account overlap detected: owner=" + curOwner + " entered=" + uid)
					return
				}
				if curActive == 0 && lastOwner != "" && lastOwner != uid {
					if waited := now.Sub(lastReleased); waited < gap-3*time.Millisecond {
						mu.Unlock()
						rel()
						errCh <- errors.New("cross-account switch gap violated under stress")
						return
					}
				}
				curOwner = uid
				curActive++
				mu.Unlock()

				time.Sleep(8 * time.Millisecond)

				mu.Lock()
				curActive--
				if curActive == 0 {
					lastOwner = curOwner
					curOwner = ""
					lastReleased = time.Now()
				}
				mu.Unlock()
				rel()
			}(uid)
		}
	}

	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}
}
