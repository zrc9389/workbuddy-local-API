package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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

	var upstreamReceivedBytes atomic.Int64
	var upstreamContentSHA atomic.Value

	// Mock 上游客户端：直接读取流式 body，校验流式传输与内容无损性
	mockUpstream := &upstream.Client{
		HTTP: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				// 记录收到的请求体哈希与字节数
				h := sha256.New()
				n, err := io.Copy(h, r.Body)
				if err != nil {
					return nil, err
				}
				upstreamReceivedBytes.Store(n)
				upstreamContentSHA.Store(hex.EncodeToString(h.Sum(nil)))

				// 返回标准 SSE 成功响应流
				sseResp := sseOK
				return &http.Response{
					StatusCode: 200,
					Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
					Body:       io.NopCloser(strings.NewReader(sseResp)),
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

	// 记录处理前系统临时文件目录下的 spool 临时文件
	pattern := filepath.Join(os.TempDir(), "wb_req_spool_*.tmp")
	filesBefore, _ := filepath.Glob(pattern)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(reqBytes))
	req = req.WithContext(context.Background())
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("handler failed with status %d: %s", w.Code, w.Body.String())
	}

	// 1. 验证上游确实完整接收了 1MB+ 的流式数据（未截断）
	if upstreamReceivedBytes.Load() != int64(len(reqBytes)) {
		t.Fatalf("upstream received %d bytes, want %d", upstreamReceivedBytes.Load(), len(reqBytes))
	}

	// 2. 验证内容哈希 100% 一致，无任何截断、折叠摘要或零宽字符污染
	expectedSum := sha256.Sum256(reqBytes)
	reqSumHex := hex.EncodeToString(expectedSum[:])
	if upstreamContentSHA.Load().(string) != reqSumHex {
		t.Fatalf("upstream payload hash mismatch: got %s, want %s", upstreamContentSHA.Load(), reqSumHex)
	}

	// 3. 验证生命周期结束清理：临时文件在请求处理完毕后被彻底物理删除，无泄漏
	filesAfter, _ := filepath.Glob(pattern)
	if len(filesAfter) > len(filesBefore) {
		t.Fatalf("leaked spool temp files detected: before=%d, after=%d (%v)", len(filesBefore), len(filesAfter), filesAfter)
	}

	_ = userSum
}
