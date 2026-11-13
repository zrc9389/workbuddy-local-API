package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// TestChatCompletions_LargeRequestStreamForwardAndCleaned 验证大请求真正使用临时文件流式转发且请求结束后临时文件完全销毁
func TestChatCompletions_LargeRequestStreamForwardAndCleaned(t *testing.T) {
	// 构造 1MB 的超长大请求，包含完整上下文与 tail 标志
	bigPadding := strings.Repeat("X", 1024*1024)
	userText := bigPadding + "_TAIL_VERIFIED"
	userSum := sha256.Sum256([]byte(userText))

	reqBody := fmt.Sprintf(`{"model":"deepseek-v4.1","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"%s"}]}`, userText)
	reqBytes := []byte(reqBody)

	var upstreamBodyBytes atomic.Value

	// Mock 上游客户端：校验流式传输、用户正文内容无损性与出站规范字段
	mockUpstream := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				b, err := io.ReadAll(r.Body)
				if err != nil {
					return nil, err
				}
				upstreamBodyBytes.Store(b)
				return &http.Response{
					StatusCode: 200,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader(sseOK)),
				}, nil
			}),
		},
		ChatBaseCN: "https://fixture.example",
	}

	p := testPoolWith(&auth.Auth{UID: "u_spool_stream", AccessToken: "tok", ExpiresAt: 9999999999})
	h := NewHandler(Config{
		Pool:          p,
		Upstream:      mockUpstream,
		MaxBodyBytes:  16 << 20,
		MaxConcurrent: 4,
	})

	reqPattern := filepath.Join(os.TempDir(), "wb_req_spool_*.tmp")
	prepPattern := filepath.Join(os.TempDir(), "wb_spool_prep_*.tmp")
	reqBefore, _ := filepath.Glob(reqPattern)
	prepBefore, _ := filepath.Glob(prepPattern)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(reqBytes))
	req = req.WithContext(context.Background())
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("handler failed with status %d: %s", w.Code, w.Body.String())
	}

	rawOut := upstreamBodyBytes.Load().([]byte)
	var parsed map[string]any
	if err := json.Unmarshal(rawOut, &parsed); err != nil {
		t.Fatalf("upstream body invalid JSON: %v", err)
	}
	if parsed["model"] != "deepseek-v4.1" || parsed["stream"] != true {
		t.Fatalf("unexpected model/stream: %v %v", parsed["model"], parsed["stream"])
	}
	if key, _ := parsed["prompt_cache_key"].(string); !strings.HasPrefix(key, "wb2a-u_spool_") {
		t.Fatalf("expected prompt_cache_key injected, got %q", key)
	}
	msgs := parsed["messages"].([]any)
	gotUser, _ := msgs[1].(map[string]any)["content"].(string)
	gotUserSum := sha256.Sum256([]byte(gotUser))
	if gotUserSum != userSum {
		t.Fatalf("user content sha256 mismatch: got %s, want %s", hex.EncodeToString(gotUserSum[:]), hex.EncodeToString(userSum[:]))
	}

	reqAfter, _ := filepath.Glob(reqPattern)
	prepAfter, _ := filepath.Glob(prepPattern)
	if len(reqAfter) > len(reqBefore) || len(prepAfter) > len(prepBefore) {
		t.Fatalf("leaked spool temp files detected: req=%d->%d prep=%d->%d", len(reqBefore), len(reqAfter), len(prepBefore), len(prepAfter))
	}
}
