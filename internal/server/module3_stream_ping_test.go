package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

type threadSafeRecorder struct {
	mu          sync.Mutex
	code        int
	header      http.Header
	body        strings.Builder
	flushes     int
	firstPingAt time.Time
	firstDataAt time.Time
}

func newThreadSafeRecorder() *threadSafeRecorder {
	return &threadSafeRecorder{code: http.StatusOK, header: make(http.Header)}
}

func (r *threadSafeRecorder) Header() http.Header { return r.header }
func (r *threadSafeRecorder) WriteHeader(code int) {
	r.mu.Lock()
	r.code = code
	r.mu.Unlock()
}
func (r *threadSafeRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := string(p)
	if r.firstPingAt.IsZero() && strings.Contains(s, ": ping") {
		r.firstPingAt = time.Now()
	}
	if r.firstDataAt.IsZero() && (strings.Contains(s, "message_start") || strings.Contains(s, "response.created")) {
		r.firstDataAt = time.Now()
	}
	r.body.Write(p)
	return len(p), nil
}
func (r *threadSafeRecorder) Flush() {
	r.mu.Lock()
	r.flushes++
	r.mu.Unlock()
}

func TestMessagesAndResponsesFirstBytePingBeforeSlowDelta(t *testing.T) {
	upSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush()
		}
		// Delay longer than SSEFirstBytePing (40ms) before emitting first token.
		time.Sleep(110 * time.Millisecond)
		chunk, _ := json.Marshal(map[string]any{
			"id":      "chatcmpl-slow-1",
			"object":  "chat.completion.chunk",
			"created": time.Now().Unix(),
			"model":   "deepseek-v4-flash",
			"choices": []map[string]any{{
				"index": 0,
				"delta": map[string]any{"role": "assistant", "content": "hello"},
			}},
		})
		_, _ = w.Write([]byte("data: " + string(chunk) + "\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush()
		}
	}))
	defer upSrv.Close()

	p := pool.New("")
	p.Add(&auth.Auth{UID: "u-ping-1", AccessToken: "tok-ping-1", ExpiresAt: time.Now().Add(time.Hour).Unix()})
	up := &upstream.Client{
		HTTP:          upSrv.Client(),
		ChatHTTP:      upSrv.Client(),
		ChatBaseCN:    upSrv.URL,
		BillingBaseCN: upSrv.URL,
	}
	h := NewHandler(Config{
		Pool:             p,
		Upstream:         up,
		MaxRotate:        1,
		SSEFirstBytePing: 40 * time.Millisecond,
	})

	// 1. /v1/messages streaming: must forward ": ping\n\n" before message_start
	t.Run("messages_stream_first_byte_ping", func(t *testing.T) {
		rec := newThreadSafeRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"deepseek-v4-flash","stream":true,"max_tokens":32,"messages":[{"role":"user","content":"hi"}]}`))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)

		rec.mu.Lock()
		body := rec.body.String()
		code := rec.code
		pingAt := rec.firstPingAt
		dataAt := rec.firstDataAt
		rec.mu.Unlock()

		if code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", code, body)
		}
		if pingAt.IsZero() {
			t.Fatalf("expected : ping before first message_start, got body:\n%s", body)
		}
		if dataAt.IsZero() || !pingAt.Before(dataAt) {
			t.Fatalf("expected : ping (%v) strictly before message_start (%v), body:\n%s", pingAt, dataAt, body)
		}
		if !strings.Contains(body, "event: message_start") || !strings.Contains(body, "hello") || !strings.Contains(body, "event: message_stop") {
			t.Fatalf("incomplete Anthropic SSE stream after ping:\n%s", body)
		}
	})

	// 2. /v1/responses streaming: must emit ": ping\n\n" before response.created
	t.Run("responses_stream_first_byte_ping", func(t *testing.T) {
		rec := newThreadSafeRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"deepseek-v4-flash","stream":true,"input":"hi"}`))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)

		rec.mu.Lock()
		body := rec.body.String()
		code := rec.code
		pingAt := rec.firstPingAt
		dataAt := rec.firstDataAt
		rec.mu.Unlock()

		if code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", code, body)
		}
		if pingAt.IsZero() {
			t.Fatalf("expected : ping before first response.created, got body:\n%s", body)
		}
		if dataAt.IsZero() || !pingAt.Before(dataAt) {
			t.Fatalf("expected : ping (%v) strictly before response.created (%v), body:\n%s", pingAt, dataAt, body)
		}
		if !strings.Contains(body, "event: response.created") || !strings.Contains(body, "hello") || !strings.Contains(body, "event: response.completed") {
			t.Fatalf("incomplete Responses SSE stream after ping:\n%s", body)
		}
	})
}
