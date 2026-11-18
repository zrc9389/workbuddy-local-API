package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestEgressGuardTimeoutDoesNotPenalizeAndReturnsEgressBusy(t *testing.T) {
	// 构造共享出口已被其他账号占满的场景，使 EgressGuard 快速超时返回 ErrEgressGuardTimeout。
	guard := upstream.NewEgressGuard(upstream.EgressGuardOptions{
		AcquireTimeout: 25 * time.Millisecond,
		MinSwitchGap:   -1,
	})
	up := upstream.New()
	up.EgressGuard = guard
	up.ChatBaseCN = "http://127.0.0.1:1" // 绝不会发到上游，在 EgressGuard 即超时

	a1 := &auth.Auth{UID: "u-shared-1", AccessToken: "tok1", ExpiresAt: time.Now().Add(time.Hour).Unix(), ProxyURL: "http://127.0.0.1:18080"}
	a2 := &auth.Auth{UID: "u-shared-2", AccessToken: "tok2", ExpiresAt: time.Now().Add(time.Hour).Unix(), ProxyURL: "http://127.0.0.1:18080"}

	// 预先由另一个账号占用同一个出口键
	ek := up.EgressKey(a1)
	if ek == "" {
		t.Fatal("expected non-empty egress key")
	}
	releaseOther, err := guard.Acquire(context.Background(), ek, "other-holder")
	if err != nil {
		t.Fatalf("pre-acquire failed: %v", err)
	}
	defer releaseOther()

	pl := pool.New("")
	pl.SetDegrade(1, time.Minute, time.Minute) // 只要调用 1 次 NoteFailures 就会触发降权
	pl.Add(a1)
	pl.Add(a2)

	h := NewHandler(Config{
		Pool:      pl,
		Upstream:  up,
		MaxRotate: 4,
	})

	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503 body=%s", w.Code, w.Body.String())
	}
	var errResp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("decode error json: %v body=%s", err, w.Body.String())
	}
	errObj, _ := errResp["error"].(map[string]any)
	if gotCode, _ := errObj["code"].(string); gotCode != "egress_busy" {
		t.Fatalf("error.code=%q want egress_busy body=%s", gotCode, w.Body.String())
	}

	// 验证两个健康账号均未被 NoteFailures 累加或降权
	for _, uid := range []string{"u-shared-1", "u-shared-2"} {
		st, ok := pl.Status(uid)
		if !ok {
			t.Fatalf("missing status for %s", uid)
		}
		if st.ConsecutiveFails != 0 {
			t.Fatalf("account %s ConsecutiveFails=%d want 0", uid, st.ConsecutiveFails)
		}
		if !st.DegradeUntil.IsZero() {
			t.Fatalf("account %s unexpectedly degraded: %+v", uid, st)
		}
	}
}

func TestEgressGuardTimeoutSkipsSameEgressAndRotatesToUnblockedEgress(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer ts.Close()

	guard := upstream.NewEgressGuard(upstream.EgressGuardOptions{
		AcquireTimeout: 25 * time.Millisecond,
		MinSwitchGap:   -1,
	})
	up := upstream.New()
	up.EgressGuard = guard
	up.ChatBaseCN = ts.URL
	up.ExitIPResolver = func(a *auth.Auth) string {
		if a != nil && strings.HasPrefix(a.UID, "u-blocked") {
			return "203.0.113.10"
		}
		return "203.0.113.20"
	}

	// 两个共享阻塞出口的账号 + 一个独立可用出口账号（无代理仅在 loopback 测试直连）
	a1 := &auth.Auth{UID: "u-blocked-1", AccessToken: "tok1", ExpiresAt: time.Now().Add(time.Hour).Unix()}
	a2 := &auth.Auth{UID: "u-blocked-2", AccessToken: "tok2", ExpiresAt: time.Now().Add(time.Hour).Unix()}
	a3 := &auth.Auth{UID: "u-free-3", AccessToken: "tok3", ExpiresAt: time.Now().Add(time.Hour).Unix()}

	releaseOther, err := guard.Acquire(context.Background(), up.EgressKey(a1), "other-holder")
	if err != nil {
		t.Fatalf("pre-acquire failed: %v", err)
	}
	defer releaseOther()

	pl := pool.New("")
	pl.SetDegrade(1, time.Minute, time.Minute)
	pl.Add(a1)
	pl.Add(a2)
	pl.Add(a3)

	// MaxRotate=2：如果没跳过同阻塞 egressKey 的 u-blocked-2，2 次轮转将全浪费在阻塞出口上导致失败！
	// 跳过同阻塞 egressKey 后，第 2 跳直接命中 u-free-3 并 200 成功。
	h := NewHandler(Config{
		Pool:      pl,
		Upstream:  up,
		MaxRotate: 2,
	})

	reqBody := bytes.NewBufferString(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", reqBody)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 (expected skip blocked egress and hit u-free-3) body=%s", w.Code, w.Body.String())
	}
	for _, uid := range []string{"u-blocked-1", "u-blocked-2"} {
		st, _ := pl.Status(uid)
		if st.ConsecutiveFails != 0 || !st.DegradeUntil.IsZero() {
			t.Fatalf("blocked-egress account %s should not be penalized: %+v", uid, st)
		}
	}
}
