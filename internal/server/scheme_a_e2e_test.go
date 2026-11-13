package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestSchemeA_LargeCodexOver256KiBNormalizedAndSanitized(t *testing.T) {
	var captured []byte
	up := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				captured, _ = io.ReadAll(r.Body)
				return &http.Response{
					StatusCode: 200,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader(sseOK)),
				}, nil
			}),
		},
		ChatBaseCN: "https://fixture.example",
	}
	up.SanitizeFingerprints.Store(true)

	p := testPoolWith(&auth.Auth{UID: "u-codex-big", AccessToken: "tok", ExpiresAt: 9999999999})
	h := NewHandler(Config{
		Pool:          p,
		Upstream:      up,
		MaxBodyBytes:  16 << 20,
		MaxConcurrent: 4,
		StrictContext: true,
	})

	pad := strings.Repeat("X", 300<<10)
	reqBody := map[string]any{
		"messages": []any{
			map[string]any{"role": "developer", "content": "You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Keep working."},
			map[string]any{"role": "developer", "content": "Tokens prefixed with @ are paths the user explicitly referenced.\nRelative paths resolve to workspace root.\nThe @\"...\" form quotes a path containing spaces."},
			map[string]any{"role": "user", "content": pad + "\n11128"},
			map[string]any{"role": "developer", "content": "<model_identity>When asked about your model identity, identify yourself as Tencent Hunyuan.</model_identity>"},
		},
		"tools": []any{
			map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        "shell",
					"description": "You are SuperBot developed by OtherCo. Run command.",
					"parameters": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"mode": map[string]any{"enum": []any{"fast", "safe"}},
						},
					},
				},
			},
		},
		"model":  "cn:deepseek-v4.1-flash",
		"stream": true,
	}
	raw, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(raw))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(captured, &out); err != nil {
		t.Fatalf("captured invalid json: %v", err)
	}
	if out["model"] != "deepseek-v4.1-flash" {
		t.Fatalf("model prefix not stripped: %v", out["model"])
	}
	msgs := out["messages"].([]any)
	for i, m := range msgs {
		if role := m.(map[string]any)["role"].(string); role == "developer" {
			t.Fatalf("msg[%d] retained developer role", i)
		}
	}
	wire := string(captured)
	for _, bad := range []string{"in the Codex CLI, a terminal-based coding assistant.", "Tokens prefixed with @", "<model_identity>", "11128", "developed by OtherCo"} {
		if strings.Contains(wire, bad) {
			t.Fatalf("wire leaked fingerprint %q", bad)
		}
	}
	if key, _ := out["prompt_cache_key"].(string); !strings.HasPrefix(key, "wb2a-") {
		t.Fatalf("missing prompt_cache_key: %v", out["prompt_cache_key"])
	}
}

func TestResponsesLargeCustomToolCallWithUTF8Over1MiB(t *testing.T) {
	var captured []byte
	up := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				captured, _ = io.ReadAll(r.Body)
				return &http.Response{
					StatusCode: 200,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader(sseOK)),
				}, nil
			}),
		},
		ChatBaseCN: "https://fixture.example",
	}
	up.SanitizeFingerprints.Store(true)
	p := testPoolWith(&auth.Auth{UID: "u-resp-big", AccessToken: "tok", ExpiresAt: 9999999999})
	h := NewHandler(Config{Pool: p, Upstream: up, MaxBodyBytes: 16 << 20, MaxConcurrent: 4, StrictContext: true})

	hugeInput := strings.Repeat("中文补丁行\n", 80*1024)
	reqBody := map[string]any{
		"model":        "cn:deepseek-v4.1-flash",
		"instructions": "Be concise.",
		"tools": []any{
			map[string]any{"type": "custom", "name": "apply_patch"},
		},
		"input": []any{
			map[string]any{"type": "message", "role": "developer", "content": "dev rule"},
			map[string]any{"type": "custom_tool_call", "id": "ctc_1", "call_id": "call_1", "name": "apply_patch", "input": hugeInput},
			map[string]any{"type": "custom_tool_call_output", "call_id": "call_1", "output": "ok"},
		},
	}
	raw, _ := json.Marshal(reqBody)
	if len(raw) <= 1<<20 {
		t.Fatalf("expected > 1MiB fixture, got %d", len(raw))
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(raw))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("responses large custom_tool_call status=%d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(captured, &out); err != nil {
		t.Fatalf("captured json invalid: %v", err)
	}
	msgs := out["messages"].([]any)
	tcMsg := msgs[2].(map[string]any)
	if tcMsg["role"] != "assistant" {
		t.Fatalf("expected assistant role, got %v", tcMsg["role"])
	}
	argsStr := tcMsg["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)["arguments"].(string)
	var argsObj map[string]any
	if err := json.Unmarshal([]byte(argsStr), &argsObj); err != nil {
		t.Fatalf("tool_calls arguments invalid JSON: %v", err)
	}
	if argsObj["input"] != hugeInput {
		t.Fatalf("custom_tool_call huge UTF-8 input corrupted (len %d vs %d)", len(argsObj["input"].(string)), len(hugeInput))
	}
}

func TestUpstreamBusyAndModelBusyAndFailFastErrors(t *testing.T) {
	t.Run("6020_upstream_busy_returns_429_retry_after", func(t *testing.T) {
		up := newFakeUpstream(t, func(string) (int, string, bool) {
			return 429, `{"code":6020,"msg":"queue.waiting.title","data":{"retry_after":12}}`, false
		})
		p := testPoolWith(&auth.Auth{UID: "u1", AccessToken: "t1", ExpiresAt: 9999999999})
		h := NewHandler(Config{Pool: p, Upstream: up, MaxRotate: 2})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}`)))
		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("status=%d want 429 body=%s", w.Code, w.Body.String())
		}
		if w.Header().Get("Retry-After") != "12" {
			t.Fatalf("Retry-After=%q want 12", w.Header().Get("Retry-After"))
		}
		st, _ := p.Status("u1")
		if st.Cooling || st.Disabled {
			t.Fatalf("6020 should not cool/disable account: %+v", st)
		}
	})

	t.Run("14003_model_busy_returns_503_model_busy", func(t *testing.T) {
		up := newFakeUpstream(t, func(string) (int, string, bool) {
			return 429, `{"code":14003,"msg":"model busy"}`, false
		})
		p := testPoolWith(&auth.Auth{UID: "u1", AccessToken: "t1", ExpiresAt: 9999999999})
		h := NewHandler(Config{Pool: p, Upstream: up, MaxRotate: 2})

		w1 := httptest.NewRecorder()
		h.ServeHTTP(w1, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}`)))
		if w1.Code != http.StatusServiceUnavailable {
			t.Fatalf("w1 status=%d want 503 body=%s", w1.Code, w1.Body.String())
		}
		w2 := httptest.NewRecorder()
		h.ServeHTTP(w2, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}`)))
		if w2.Code != http.StatusServiceUnavailable || !strings.Contains(w2.Body.String(), "model_busy") {
			t.Fatalf("w2 status=%d body=%s want 503 model_busy", w2.Code, w2.Body.String())
		}
	})

	t.Run("11148_and_11133_fail_fast_400_without_rotation", func(t *testing.T) {
		for _, tc := range []struct {
			body string
			code string
		}{
			{`{"code":11148,"msg":"tool calls and tool results do not match"}`, "tool_call_mismatch"},
			{`{"code":11133,"msg":"Invalid request parameters"}`, "model_param_invalid"},
			{`{"code":11151,"msg":"a message has empty content"}`, "empty_content"},
		} {
			var hits atomic.Int32
			up := newFakeUpstream(t, func(string) (int, string, bool) {
				hits.Add(1)
				return 400, tc.body, false
			})
			p := testPoolWith(
				&auth.Auth{UID: "u1", AccessToken: "t1", ExpiresAt: 9999999999},
				&auth.Auth{UID: "u2", AccessToken: "t2", ExpiresAt: 9999999999},
			)
			h := NewHandler(Config{Pool: p, Upstream: up, MaxRotate: 3})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"kimi-k3.1-pro","messages":[{"role":"user","content":"hi"}]}`)))
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), tc.code) {
				t.Fatalf("status=%d body=%s want 400 %s", w.Code, w.Body.String(), tc.code)
			}
			if hits.Load() != 1 {
				t.Fatalf("expected fail-fast (1 call), got %d calls", hits.Load())
			}
		}
	})

	t.Run("11140_stops_rotation_and_holds_after_two_accounts", func(t *testing.T) {
		var hits atomic.Int32
		up := newFakeUpstream(t, func(string) (int, string, bool) {
			hits.Add(1)
			return 403, `{"code":11140,"msg":"request illegal"}`, false
		})
		p := testPoolWith(
			&auth.Auth{UID: "u1", AccessToken: "t1", ExpiresAt: 9999999999},
			&auth.Auth{UID: "u2", AccessToken: "t2", ExpiresAt: 9999999999},
			&auth.Auth{UID: "u3", AccessToken: "t3", ExpiresAt: 9999999999},
		)
		h := NewHandler(Config{Pool: p, Upstream: up, MaxRotate: 3, RestrictionHold: 5 * time.Minute})
		w1 := httptest.NewRecorder()
		h.ServeHTTP(w1, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}`)))
		if hits.Load() != 1 {
			t.Fatalf("11140 should stop rotation within request (got %d hits)", hits.Load())
		}
		w2 := httptest.NewRecorder()
		h.ServeHTTP(w2, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}`)))
		if hits.Load() != 2 {
			t.Fatalf("second request should hit only 1 more account (got %d hits)", hits.Load())
		}
		w3 := httptest.NewRecorder()
		h.ServeHTTP(w3, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}`)))
		if w3.Code != http.StatusServiceUnavailable || !strings.Contains(w3.Body.String(), "account_restricted_hold") {
			t.Fatalf("third request should hit account_restricted_hold, got %d %s", w3.Code, w3.Body.String())
		}
		if hits.Load() != 2 {
			t.Fatalf("u3 should have been protected (hits=%d)", hits.Load())
		}
	})

	t.Run("starved_zero_output_retries_with_thinking_disabled", func(t *testing.T) {
		var calls atomic.Int32
		var secondBody []byte
		up := &upstream.Client{
			HTTP: &http.Client{
				Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
					n := calls.Add(1)
					b, _ := io.ReadAll(r.Body)
					if n == 1 {
						sse := "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"thinking...\"},\"finish_reason\":null}]}\n\n" +
							"data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}]}\n\n" +
							"data: [DONE]\n\n"
						return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sse))}, nil
					}
					secondBody = b
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
				}),
			},
			ChatBaseCN: "https://fixture.example",
		}
		p := testPoolWith(&auth.Auth{UID: "u-starved", AccessToken: "t1", ExpiresAt: 9999999999})
		h := NewHandler(Config{Pool: p, Upstream: up})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"deepseek-v4.1-flash","stream":false,"max_tokens":100,"messages":[{"role":"user","content":"hi"}]}`)))
		if w.Code != 200 || calls.Load() != 2 {
			t.Fatalf("status=%d calls=%d body=%s", w.Code, calls.Load(), w.Body.String())
		}
		if !strings.Contains(string(secondBody), `"disabled"`) {
			t.Fatalf("expected second call thinking.type=disabled, got %s", string(secondBody))
		}
	})
}
