package upstream

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCloseIdlerContract 验证 safeProxyTransport 与 accountLeaseTransport 均满足 closeIdler 接口
func TestCloseIdlerContract(t *testing.T) {
	tr := newTransport()
	s := safeProxyTransport{tr: tr}
	if _, ok := any(s).(closeIdler); !ok {
		t.Fatal("safeProxyTransport must implement closeIdler interface")
	}
	// roundTripCloseIdle 调用应当平稳执行
	roundTripCloseIdle(s)

	lease := accountLeaseTransport{
		next: s,
		c:    New(),
		a:    nil,
	}
	if _, ok := any(lease).(closeIdler); !ok {
		t.Fatal("accountLeaseTransport must implement closeIdler interface")
	}
	roundTripCloseIdle(lease)
}

// TestNilAuthSafety 验证 ChatHeaders 与 ChatStreamContext 在 a == nil 时的防御性安全
func TestNilAuthSafety(t *testing.T) {
	c := New()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v2/chat/completions", nil)

	// ChatHeaders 对 a == nil 不 panic，且写入默认 X-No-User-Id 头
	c.ChatHeaders(req, nil, "127.0.0.1", ChatMeta{})
	if req.Header.Get("X-No-User-Id") != "1" {
		t.Errorf("expected X-No-User-Id: 1, got %s", req.Header.Get("X-No-User-Id"))
	}

	// ChatStreamContext 在 a == nil 时安全处理 body 并发起请求（不发生 nil pointer panic）
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 立刻取消以避免真实网络请求
	_, _, _, err := c.ChatStreamContext(ctx, nil, []byte(`{"model":"test","messages":[]}`), "127.0.0.1", ChatMeta{})
	if err == nil {
		t.Fatal("expected cancellation error, got nil")
	}

	// ForgetTransport 与 transportFor 的空客户端/空账号防御
	c.ForgetTransport("")
	var nilClient *Client
	nilClient.ForgetTransport("uid")
	if tr := nilClient.transportFor(nil); tr == nil {
		t.Fatal("expected fallback proxyFailure, got nil")
	}
}
