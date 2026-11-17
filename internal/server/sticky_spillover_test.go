package server

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// TestStickyBusySpilloverAndLongSession 验证：
// 1. 同一 12h 显式会话并发时，第 2 个并发请求检测到原粘性号正处于忙态（inFlight > minPoolInFlight），
//    自动溢出分发给另一空闲高余额账号，且不解绑原粘性记录，成功时不重写绑定；
// 2. 并发结束释放后，后续单线请求自动稳回原粘性号继续享受 12h 缓存命中；
// 3. 连续 15 轮单线请求稳定由原粘性号服务，不触发硬轮数踢号限制。
func TestStickyBusySpilloverAndLongSession(t *testing.T) {
	var mu sync.Mutex
	var callLog []string

	req1Started := make(chan struct{})
	req1Proceed := make(chan struct{})

	fakeClient := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				authz := r.Header.Get("Authorization")
				mu.Lock()
				callLog = append(callLog, authz)
				isReq1 := (len(callLog) == 1)
				mu.Unlock()

				if isReq1 {
					close(req1Started)
					<-req1Proceed // 挂起请求 1，模拟正在处理流
				}

				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")),
				}, nil
			}),
		},
		ChatBaseCN:    "https://fake.example",
		BillingBaseCN: "https://fake.example",
	}

	p := pool.New("")
	p.SetMaxInFlight(3)
	p.Add(&auth.Auth{UID: "acct-a", AccessToken: "at-a", ExpiresAt: 9999999999})
	p.Add(&auth.Auth{UID: "acct-b", AccessToken: "at-b", ExpiresAt: 9999999999})
	p.SetCredits("acct-a", 2500, 2500)
	p.SetCredits("acct-b", 2500, 2500)

	sessRouter := session.New(session.Config{
		TTL:             12 * time.Hour,
		MaxTurns:        0, // 不限轮
		Available:       p.AvailableUIDs,
		HealthyForModel: p.HealthyForModel,
	})
	// 显式将会话 session-1 绑定到 acct-a
	sessRouter.Bind("session-1", "acct-a")

	h := NewHandler(Config{
		Pool:      p,
		Upstream:  fakeClient,
		Session:   sessRouter,
		MaxRotate: 3,
	})

	// ── 步骤 1：发起请求 1，占用 acct-a 在途并发 ──────────────────
	req1Done := make(chan struct{})
	go func() {
		defer close(req1Done)
		reqBody := `{"model":"glm-5.2","stream":true,"messages":[{"role":"user","content":"turn 1"}]}`
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(reqBody)))
		req.Header.Set("X-Conversation-ID", "session-1")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("req1 failed: %d", rec.Code)
		}
	}()

	// 等待请求 1 到达上游并持锁在途
	select {
	case <-req1Started:
	case <-time.After(3 * time.Second):
		t.Fatalf("timeout waiting for req1 to start")
	}

	// 确认 acct-a 当前 inFlight 为 1
	infA, _ := p.InFlightOf("acct-a")
	infB, _ := p.InFlightOf("acct-b")
	if infA != 1 || infB != 0 {
		t.Fatalf("expected acct-a inFlight=1, acct-b inFlight=0, got a=%d, b=%d", infA, infB)
	}

	// ── 步骤 2：并发发起同一会话请求 2，验证 Sticky Busy Spillover ────
	req2Body := `{"model":"glm-5.2","stream":true,"messages":[{"role":"user","content":"turn 2 concurrent"}]}`
	req2 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(req2Body)))
	req2.Header.Set("X-Conversation-ID", "session-1")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected req2 status 200, got %d", rec2.Code)
	}

	mu.Lock()
	if len(callLog) < 2 {
		t.Fatalf("expected at least 2 calls, got %d", len(callLog))
	}
	req2Account := callLog[1]
	mu.Unlock()

	// 验证请求 2 旁路分发给了空闲的 acct-b
	if req2Account != "Bearer at-b" {
		t.Fatalf("expected req2 to spillover to acct-b, got %s", req2Account)
	}

	// 验证会话路由表的粘性绑定未被篡改，依然稳定指向 acct-a！
	boundUID, ok := sessRouter.Resolve("session-1")
	if !ok || boundUID != "acct-a" {
		t.Fatalf("expected session-1 still bound to acct-a after spillover, got %s (ok=%v)", boundUID, ok)
	}

	// ── 步骤 3：结束请求 1，单线发起请求 3，验证自动稳回原粘性号 ────────
	close(req1Proceed)
	<-req1Done

	// 此时全池均无在途并发
	infA, _ = p.InFlightOf("acct-a")
	infB, _ = p.InFlightOf("acct-b")
	if infA != 0 || infB != 0 {
		t.Fatalf("expected 0 inFlight after req1 done, got a=%d, b=%d", infA, infB)
	}

	req3Body := `{"model":"glm-5.2","stream":true,"messages":[{"role":"user","content":"turn 3 seq"}]}`
	req3 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(req3Body)))
	req3.Header.Set("X-Conversation-ID", "session-1")
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)

	if rec3.Code != http.StatusOK {
		t.Fatalf("expected req3 status 200, got %d", rec3.Code)
	}

	mu.Lock()
	req3Account := callLog[2]
	mu.Unlock()

	if req3Account != "Bearer at-a" {
		t.Fatalf("expected req3 to return to sticky acct-a, got %s", req3Account)
	}

	// ── 步骤 4：连续 15 轮单线请求，验证不触发轮数上限踢号 ───────────
	for round := 4; round <= 18; round++ {
		rBody := `{"model":"glm-5.2","stream":true,"messages":[{"role":"user","content":"seq"}]}`
		rReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(rBody)))
		rReq.Header.Set("X-Conversation-ID", "session-1")
		rRec := httptest.NewRecorder()
		h.ServeHTTP(rRec, rReq)
		if rRec.Code != http.StatusOK {
			t.Fatalf("round %d failed: %d", round, rRec.Code)
		}
		mu.Lock()
		curAccount := callLog[len(callLog)-1]
		mu.Unlock()
		if curAccount != "Bearer at-a" {
			t.Fatalf("round %d was kicked off acct-a to %s", round, curAccount)
		}
	}
}
