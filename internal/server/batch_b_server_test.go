package server

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

type batchBRoundTripFunc func(*http.Request) (*http.Response, error)

func (f batchBRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestBatchBAllTransportFailurePreventsCascadeDegrade(t *testing.T) {
	// 所有账号均传输失败且 0 成功 → 视为网络/出口侧抖动，不得触发全池连坐 NoteFailures 降权。
	up := &upstream.Client{
		HTTP: &http.Client{Transport: batchBRoundTripFunc(func(r *http.Request) (*http.Response, error) {
			return nil, errors.New("connection reset by peer")
		})},
		ChatHTTP: &http.Client{Transport: batchBRoundTripFunc(func(r *http.Request) (*http.Response, error) {
			return nil, errors.New("connection reset by peer")
		})},
		ChatBaseCN: "http://127.0.0.1:1",
	}
	pl := pool.New("")
	pl.SetDegrade(1, time.Minute, time.Minute)
	for _, uid := range []string{"u-net-1", "u-net-2", "u-net-3"} {
		pl.Add(&auth.Auth{UID: uid, AccessToken: "tok", ExpiresAt: time.Now().Add(time.Hour).Unix()})
	}
	h := NewHandler(Config{Pool: pl, Upstream: up, MaxRotate: 3})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503", w.Code)
	}
	for _, uid := range []string{"u-net-1", "u-net-2", "u-net-3"} {
		st, _ := pl.Status(uid)
		if st.ConsecutiveFails != 0 || !st.DegradeUntil.IsZero() {
			t.Fatalf("systemic transport outage should not cascade-degrade %s: %+v", uid, st)
		}
	}
}

func TestBatchBPartialTransportFailurePenalizesOnlyFailedAccountWhenAnotherSucceeds(t *testing.T) {
	var calls atomic.Int32
	up := &upstream.Client{
		ChatHTTP: &http.Client{Transport: batchBRoundTripFunc(func(r *http.Request) (*http.Response, error) {
			if calls.Add(1) == 1 {
				return nil, errors.New("proxy dial failed")
			}
			body := "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"
			return &http.Response{
				StatusCode: 200,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		})},
		ChatBaseCN: "http://127.0.0.1:1",
	}
	pl := pool.New("")
	pl.SetDegrade(2, time.Minute, time.Minute)
	pl.Add(&auth.Auth{UID: "u-part-1", AccessToken: "tok1", ExpiresAt: time.Now().Add(time.Hour).Unix()})
	pl.Add(&auth.Auth{UID: "u-part-2", AccessToken: "tok2", ExpiresAt: time.Now().Add(time.Hour).Unix()})
	h := NewHandler(Config{Pool: pl, Upstream: up, MaxRotate: 3})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", w.Code, w.Body.String())
	}
	failCount := 0
	for _, uid := range []string{"u-part-1", "u-part-2"} {
		st, _ := pl.Status(uid)
		failCount += st.ConsecutiveFails
	}
	if failCount != 1 {
		t.Fatalf("expected exactly 1 NoteFailures on the failed account when sibling succeeded, got total=%d", failCount)
	}
}

func TestBatchBSSEFirstBytePingEndToEnd(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		w.WriteHeader(http.StatusOK)
		if fl != nil {
			fl.Flush()
		}
		time.Sleep(90 * time.Millisecond)
		_, _ = io.WriteString(w, "data: {\"id\":\"c-slow\",\"choices\":[{\"delta\":{\"content\":\"thinking done\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		if fl != nil {
			fl.Flush()
		}
	}))
	defer ts.Close()

	up := upstream.New()
	up.ChatBaseCN = ts.URL
	pl := pool.New("")
	pl.Add(&auth.Auth{UID: "u-slow-sse", AccessToken: "tok", ExpiresAt: time.Now().Add(time.Hour).Unix()})

	h := NewHandler(Config{
		Pool:             pl,
		Upstream:         up,
		MaxRotate:        1,
		SSEFirstBytePing: 35 * time.Millisecond,
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", w.Code, w.Body.String())
	}
	out := w.Body.String()
	pingIdx := strings.Index(out, ": ping\n\n")
	dataIdx := strings.Index(out, "thinking done")
	if pingIdx < 0 || dataIdx < 0 || pingIdx > dataIdx {
		t.Fatalf("expected ': ping\\n\\n' before slow first SSE token, got:\n%s", out)
	}
}
