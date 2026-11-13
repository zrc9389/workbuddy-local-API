package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// makeExactJSONPayloadWithMarker 构造指定字节数的合法单行 JSON，尾部带确定性 Marker 检验完整性
func makeExactJSONPayloadWithMarker(targetBytes int, model string, marker string) []byte {
	prefix := fmt.Sprintf(`{"model":%q,"stream":true,"messages":[{"role":"user","content":"`, model)
	suffix := marker + `"}]}`
	overhead := len(prefix) + len(suffix)
	if targetBytes < overhead {
		panic("targetBytes too small")
	}
	paddingLen := targetBytes - overhead
	padding := strings.Repeat("A", paddingLen)
	body := prefix + padding + suffix
	if len(body) != targetBytes {
		panic(fmt.Sprintf("length mismatch: got %d, want %d", len(body), targetBytes))
	}
	return []byte(body)
}

func TestChatCompletions_PayloadBoundaries(t *testing.T) {
	sizes := []struct {
		name string
		size int
	}{
		{"64KiB_exact", 65536},
		{"64KiB_plus_1", 65537},
		{"100KiB_memory", 100000},
		{"256KiB_memory_limit", 256000},
		{"300KiB_spool", 300000},
	}

	const testSSEChunk = "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1753600000,\"model\":\"deepseek-v4.1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hello\"}}]}\n\n" +
		"data: [DONE]\n\n"

	for _, tc := range sizes {
		t.Run(tc.name, func(t *testing.T) {
			marker := fmt.Sprintf("_TAIL_MARKER_%d_", tc.size)
			rawBody := makeExactJSONPayloadWithMarker(tc.size, "deepseek-v4.1", marker)
			expectedHash := sha256.Sum256(rawBody)

			var receivedBytes atomic.Int64
			var receivedHash atomic.Value
			var receivedBody atomic.Value

			mockUpstream := &upstream.Client{
				HTTP: &http.Client{
					Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
						bodyBytes, err := io.ReadAll(r.Body)
						if err != nil {
							return nil, err
						}
						receivedBytes.Store(int64(len(bodyBytes)))
						receivedBody.Store(bodyBytes)
						h := sha256.Sum256(bodyBytes)
						receivedHash.Store(hex.EncodeToString(h[:]))

						return &http.Response{
							StatusCode: 200,
							Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
							Body:       io.NopCloser(strings.NewReader(testSSEChunk)),
						}, nil
					}),
				},
				ChatBaseCN:     "https://fixture.example",
				ChatBaseGlobal: "https://fixture.example",
				BillingBaseCN:  "https://fixture.example",
			}

			p := testPoolWith(&auth.Auth{UID: "u_boundary_test", AccessToken: "tok", ExpiresAt: 9999999999})
			h := NewHandler(Config{
				Pool:          p,
				Upstream:      mockUpstream,
				MaxBodyBytes:  16 << 20,
				MaxConcurrent: 4,
				StrictContext: true,
			})

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(rawBody))
			w := httptest.NewRecorder()

			h.ServeHTTP(w, req)

			// 1. 验证不论是 64KiB 边界还是 64KiB+1，都不被误判为 400 invalid JSON，正常进入上游
			if w.Code != 200 {
				t.Fatalf("size=%d status=%d body=%s; want 200", tc.size, w.Code, w.Body.String())
			}

			// 2. 验证内容无截断：上游接收的正文中包含完整的最末尾 Marker
			upstreamData := receivedBody.Load().([]byte)
			if !bytes.Contains(upstreamData, []byte(marker)) {
				t.Fatalf("size=%d: upstream body truncated, missing marker %q", tc.size, marker)
			}

			// 3. 对于 > 256KiB 的落盘请求，确认控制字段合规改写且正文 content 哈希 100% 无损保留
			if tc.size > 256*1024 {
				var inObj, outObj map[string]any
				if err := json.Unmarshal(rawBody, &inObj); err != nil {
					t.Fatalf("unmarshal rawBody: %v", err)
				}
				if err := json.Unmarshal(upstreamData, &outObj); err != nil {
					t.Fatalf("unmarshal upstreamData: %v", err)
				}
				if outObj["model"] != "deepseek-v4.1" {
					t.Fatalf("unexpected model=%v", outObj["model"])
				}
				if outObj["stream"] != true {
					t.Fatalf("expected stream=true, got %v", outObj["stream"])
				}
				inContent, _ := inObj["messages"].([]any)[0].(map[string]any)["content"].(string)
				outContent, _ := outObj["messages"].([]any)[0].(map[string]any)["content"].(string)
				inSum := sha256.Sum256([]byte(inContent))
				outSum := sha256.Sum256([]byte(outContent))
				if inSum != outSum {
					t.Fatalf("spool user content hash mismatch: got %x, want %x", outSum, inSum)
				}
				_ = expectedHash
				_ = receivedBytes.Load()
				_ = receivedHash
			}
		})
	}

	// 4. 防御验证：畸变残缺 JSON 必须依然被精准判定为 400 invalid JSON，杜绝无脑放行
	t.Run("malformed_json_rejected", func(t *testing.T) {
		malformedBodies := []string{
			`{"model":"deepseek-v4.1", "messages":`,
			`{"model":`,
			`not a json at all`,
			`{"stream":true}`, // 缺失 model 字段
		}
		for _, mb := range malformedBodies {
			mockUpstream := &upstream.Client{
				ChatBaseCN: "https://fixture.example",
			}
			p := testPoolWith(&auth.Auth{UID: "u_malformed", AccessToken: "tok", ExpiresAt: 9999999999})
			h := NewHandler(Config{Pool: p, Upstream: mockUpstream})

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(mb))
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)

			if w.Code != 400 {
				t.Fatalf("malformed body %q expected 400, got %d", mb, w.Code)
			}
		}
	})
}
