package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// TestConversationIsolationOnCrossAccountRetry 验证：
// 1. 同会话绑定时，归属账号合法携带 ConversationID；
// 2. 跨账号重试时，严格隔离，绝不将原账号的 ConversationID 透传给新账号（Header 和 Body 均剥除）。
func TestConversationIsolationOnCrossAccountRetry(t *testing.T) {
	type requestRecord struct {
		account      string
		convIDHeader string
		bodyConvID   string
		bodyRaw      string
	}

	var mu sync.Mutex
	var records []requestRecord

	fakeClient := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				mu.Lock()
				defer mu.Unlock()

				authz := r.Header.Get("Authorization")
				convHeader := r.Header.Get("X-Conversation-ID")
				bodyBytes, _ := io.ReadAll(r.Body)

				var bodyObj map[string]any
				_ = json.Unmarshal(bodyBytes, &bodyObj)
				convBody, _ := bodyObj["conversation_id"].(string)

				records = append(records, requestRecord{
					account:      authz,
					convIDHeader: convHeader,
					bodyConvID:   convBody,
					bodyRaw:      string(bodyBytes),
				})

				// 账号 A (Bearer at-a) 第一次尝试模拟服务端崩溃 500
				if authz == "Bearer at-a" {
					return &http.Response{
						StatusCode: http.StatusInternalServerError,
						Header:     http.Header{"Content-Type": []string{"application/json"}},
						Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"server error"}}`)),
					}, nil
				}

				// 账号 B (Bearer at-b) 重试成功 200
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n")),
				}, nil
			}),
		},
		ChatBaseCN:    "https://fake.example",
		BillingBaseCN: "https://fake.example",
	}

	p := pool.New("")
	p.Add(&auth.Auth{UID: "acct-a", AccessToken: "at-a", ExpiresAt: 9999999999})
	p.Add(&auth.Auth{UID: "acct-b", AccessToken: "at-b", ExpiresAt: 9999999999})

	sessRouter := session.New(session.Config{
		Available: p.AvailableUIDs,
	})
	// 显式将会话绑定到 acct-a
	sessRouter.Bind("session-user-123", "acct-a")

	h := NewHandler(Config{
		Pool:      p,
		Upstream:  fakeClient,
		Session:   sessRouter,
		MaxRotate: 3,
	})

	reqBody := `{"model":"glm-5.2","conversation_id":"orig-conv-account-a","stream":true,"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("X-Conversation-ID", "clean-large-sess")
	req.Header.Set("X-Conversation-ID", "session-user-123")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 after retry, got %d: %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()

	if len(records) != 2 {
		t.Fatalf("expected exactly 2 upstream requests (acct-a then acct-b), got %d", len(records))
	}

	// 验证第 1 次尝试 (acct-a)：属于绑定的原账号，应携带会话 ID
	if records[0].account != "Bearer at-a" {
		t.Errorf("1st attempt should be acct-a, got %s", records[0].account)
	}
	if records[0].convIDHeader != "session-user-123" && records[0].convIDHeader != "orig-conv-account-a" {
		t.Errorf("1st attempt should keep original conversation ID, got %q", records[0].convIDHeader)
	}

	// 验证第 2 次尝试 (acct-b)：跨账号重试，绝不能复用属于 acct-a 的会话 ID！
	if records[1].account != "Bearer at-b" {
		t.Errorf("2nd attempt should be acct-b, got %s", records[1].account)
	}
	if records[1].convIDHeader != "" {
		t.Errorf("2nd attempt (cross-account retry) MUST NOT reuse acct-a conversation ID header, got %q", records[1].convIDHeader)
	}
	if records[1].bodyConvID != "" {
		t.Errorf("2nd attempt body MUST strip conversation_id, got %q", records[1].bodyConvID)
	}
}

// TestStreamRetryBeforeFirstByte 验证流式首字节前空流时，能安全在客户端收到响应头前触发有限重试
func TestStreamRetryBeforeFirstByte(t *testing.T) {
	attempts := 0
	fakeClient := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				attempts++
				authz := r.Header.Get("Authorization")
				if authz == "Bearer at-empty" {
					// 账号 1 返回 200，但首字节前直接为空流（EOF）
					return &http.Response{
						StatusCode: http.StatusOK,
						Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
						Body:       io.NopCloser(strings.NewReader(": ping only\n\n")),
					}, nil
				}
				// 账号 2 正常返回有效 SSE 帧
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"retry success\"}}]}\n\ndata: [DONE]\n\n")),
				}, nil
			}),
		},
		ChatBaseCN:    "https://fake.example",
		BillingBaseCN: "https://fake.example",
	}

	p := pool.New("")
	p.Add(&auth.Auth{UID: "acct-empty", AccessToken: "at-empty", ExpiresAt: 9999999999})
	p.Add(&auth.Auth{UID: "acct-good", AccessToken: "at-good", ExpiresAt: 9999999999})

	sessRouter := session.New(session.Config{Available: p.AvailableUIDs})
	sessRouter.Bind("test-sess", "acct-empty")

	h := NewHandler(Config{
		Pool:      p,
		Upstream:  fakeClient,
		Session:   sessRouter,
		MaxRotate: 3,
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		bytes.NewReader([]byte(`{"model":"glm-5.2","stream":true,"messages":[{"role":"user","content":"test"}]}`)))
	req.Header.Set("X-Conversation-ID", "test-sess")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "retry success") {
		t.Fatalf("expected retried stream content, got: %s", rec.Body.String())
	}
	if attempts < 2 {
		t.Fatalf("expected at least 2 attempts (empty stream retry), got %d", attempts)
	}
}

// TestConversationIsolation_LargeRequestCrossAccountBlocked 验证：
// 当超大请求（落盘至私有临时文件）包含 conversation_id 时，
// 首次打挂原账号后跨账号重试，因无法安全流式改写剥离 conversation_id，
// 必须明确停止重放（返回 502 conversation_replay_blocked），绝不整包读回全量内存，绝不将旧会话串号发送给新账号，且临时文件完全销毁。
func TestConversationIsolation_LargeRequestCrossAccountBlocked(t *testing.T) {
	var attempts int
	var mu sync.Mutex
	var targetedAccounts []string

	fakeClient := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				mu.Lock()
				defer mu.Unlock()
				attempts++
				authz := r.Header.Get("Authorization")
				targetedAccounts = append(targetedAccounts, authz)

				// 消费并关闭请求体，释放底层句柄
				if r.Body != nil {
					_, _ = io.Copy(io.Discard, r.Body)
					_ = r.Body.Close()
				}
				// 账号 A 第一次尝试模拟服务端崩溃 500
				return &http.Response{
					StatusCode: http.StatusInternalServerError,
					Header:     http.Header{"Content-Type": []string{"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"server error"}}`)),
				}, nil
			}),
		},
		ChatBaseCN: "https://fake.example",
	}

	p := pool.New("")
	p.Add(&auth.Auth{UID: "acct-spool-a", AccessToken: "at-spool-a", ExpiresAt: 9999999999})
	p.Add(&auth.Auth{UID: "acct-spool-b", AccessToken: "at-spool-b", ExpiresAt: 9999999999})

	sessRouter := session.New(session.Config{Available: p.AvailableUIDs})
	sessRouter.Bind("user-bound-spool-sess", "acct-spool-a")

	h := NewHandler(Config{
		Pool:         p,
		Upstream:     fakeClient,
		Session:      sessRouter,
		MaxRotate:    3,
		MaxBodyBytes: 16 << 20,
	})

	// 构造 512KB 大请求，包含 conversation_id
	padding := strings.Repeat("M", 400*1024)
	reqBody := `{"model":"glm-5.2","stream":true,"stream_options":{"include_usage":true},"conversation_id":"orig-conv-account-a","messages":[{"role":"user","content":"` + padding + `"}]}`

	pattern := filepath.Join(os.TempDir(), "wb_req_spool_*.tmp")
	filesBefore, _ := filepath.Glob(pattern)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(reqBody)))
	req.Header.Set("X-Conversation-ID", "user-bound-spool-sess")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	// 必须明确停止重放并返回 502 Bad Gateway
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502 conversation_replay_blocked, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "conversation_replay_blocked") {
		t.Fatalf("expected error code conversation_replay_blocked, got: %s", rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	// 上游只能收到 1 次请求（发送给原账号 acct-spool-a），绝不向 acct-spool-b 重放
	if attempts != 1 {
		t.Fatalf("expected exactly 1 attempt before stopping replay, got %d", attempts)
	}
	if len(targetedAccounts) != 1 || targetedAccounts[0] != "Bearer at-spool-a" {
		t.Fatalf("upstream should only have been targeted with acct-spool-a, got: %v", targetedAccounts)
	}

	// 临时文件必须在请求结束后彻底清理，零泄露（微等待防御并发测试干扰）
	var filesAfter []string
	for w := 0; w < 10; w++ {
		filesAfter, _ = filepath.Glob(pattern)
		if len(filesAfter) <= len(filesBefore) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(filesAfter) > len(filesBefore) {
		t.Fatalf("leaked spool temp files detected: before=%d, after=%d", len(filesBefore), len(filesAfter))
	}
}

// TestConversationIsolation_LargeRequestWithoutConvIDCanRetry 验证：
// 当超大请求（落盘至私有临时文件）不含任何 conversation_id 时，
// 首次打挂后跨账号重试是安全的，通过 io.Seeker 重置流偏移成功重放到新账号，且临时文件安全清理。
func TestConversationIsolation_LargeRequestWithoutConvIDCanRetry(t *testing.T) {
	var attempts int
	var mu sync.Mutex
	var targetedAccounts []string

	fakeClient := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				mu.Lock()
				defer mu.Unlock()
				attempts++
				authz := r.Header.Get("Authorization")
				targetedAccounts = append(targetedAccounts, authz)

				// 第一次尝试失败，第二次尝试成功。账号池选号顺序是加权的，
				// 测试只验证“可安全跨账号重放”，不应依赖某个账号先被选中。
				if attempts == 1 {
					return &http.Response{
						StatusCode: http.StatusInternalServerError,
						Header:     http.Header{"Content-Type": []string{"application/json"}},
						Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"server error"}}`)),
					}, nil
				}

				// 账号 2 重试成功 200
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"large retry ok\"}}]}" + "\n\ndata: [DONE]\n\n")),
				}, nil
			}),
		},
		ChatBaseCN: "https://fake.example",
	}

	p := pool.New("")
	p.SetRandomSource(func(n int64) int64 { return 0 })
	p.Add(&auth.Auth{UID: "acct-clean-a", AccessToken: "at-clean-a", ExpiresAt: 9999999999})
	p.Add(&auth.Auth{UID: "acct-clean-b", AccessToken: "at-clean-b", ExpiresAt: 9999999999})

	h := NewHandler(Config{
		Pool:         p,
		Upstream:     fakeClient,
		MaxRotate:    3,
		MaxBodyBytes: 16 << 20,
	})

	// 构造 512KB 大请求，完全不含 conversation_id
	padding := strings.Repeat("K", 400*1024)
	reqBody := `{"model":"glm-5.2","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"` + padding + `"}]}`

	pattern := filepath.Join(os.TempDir(), "wb_req_spool_*.tmp")
	filesBefore, _ := filepath.Glob(pattern)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(reqBody)))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 after retry, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "large retry ok") {
		t.Fatalf("expected response content from second account, got: %s", rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if attempts != 2 {
		t.Fatalf("expected 2 attempts for clean large request retry, got %d (code=%d body=%s)", attempts, rec.Code, rec.Body.String())
	}
	if targetedAccounts[0] == targetedAccounts[1] {
		t.Fatalf("expected retry to use a different account, got: %v", targetedAccounts)
	}

	filesAfter, _ := filepath.Glob(pattern)
	if len(filesAfter) > len(filesBefore) {
		t.Fatalf("leaked spool temp files detected: before=%d, after=%d", len(filesBefore), len(filesAfter))
	}
}
