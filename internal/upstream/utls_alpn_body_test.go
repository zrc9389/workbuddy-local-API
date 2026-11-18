package upstream

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

// strictStreamingBody 模拟无 GetBody 的流式请求体（例如 *os.File / pipe）：
// 一旦被提前 Close()，后续 Read() 会立即返回错误，用于钉死 ALPN 切换期间不得提前关闭 req.Body。
type strictStreamingBody struct {
	mu     sync.Mutex
	r      *bytes.Reader
	closed bool
}

func (b *strictStreamingBody) Read(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return 0, errors.New("streaming body read after premature close")
	}
	return b.r.Read(p)
}

func (b *strictStreamingBody) Close() error {
	b.mu.Lock()
	b.closed = true
	b.mu.Unlock()
	return nil
}

func (b *strictStreamingBody) IsClosed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.closed
}

func TestUTLSALPNSwitchH1ToH2PreservesStreamingBodyWithoutGetBody(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "alpn-upgrade.test")
	var gotBody string
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		gotBody = string(raw)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "echo:"+gotBody)
	}))
	proxy := startHTTPConnectProxy(t, ts, "alpn-upgrade.test:443", "", "", nil)

	c := newTestClientWithRoots(roots)
	acct := &auth.Auth{UID: "acct-alpn-upgrade", ProxyURL: "http://" + proxy.addr}
	defer c.ForgetTransport(acct.UID)

	tr, ok := c.transportFor(acct).(safeProxyTransport)
	if !ok {
		t.Fatalf("expected safeProxyTransport, got %T", c.transportFor(acct))
	}
	ut, ok := tr.rt.(*utlsProxyTransport)
	if !ok {
		t.Fatalf("expected *utlsProxyTransport, got %T", tr.rt)
	}
	// 预先将权威协议缓存置为 http/1.1，迫使首次 RoundTrip 走 h1TLSTr → dialH1TLSContext
	// 探测到服务端实际支持 h2 → 返回 alpnSwitchError{proto:"h2"} → 切 roundTripH2 重试。
	ut.setProto("alpn-upgrade.test:443", "http/1.1")

	payload := `{"model":"gpt-4o","messages":[{"role":"user","content":"streaming-body-survives-alpn-upgrade"}]}`
	streamBody := &strictStreamingBody{r: bytes.NewReader([]byte(payload))}
	req, err := http.NewRequest(http.MethodPost, "https://alpn-upgrade.test/v2/chat", nil)
	if err != nil {
		t.Fatal(err)
	}
	// 显式注入无 GetBody 的流式 io.ReadCloser
	req.Body = streamBody
	req.GetBody = nil
	req.ContentLength = int64(len(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.DoAccount(req, acct)
	if err != nil {
		t.Fatalf("POST across http/1.1->h2 ALPN switch failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d want 200", resp.StatusCode)
	}
	if resp.Proto != "HTTP/2.0" {
		t.Fatalf("proto=%q want HTTP/2.0 after ALPN upgrade", resp.Proto)
	}
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if string(respBytes) != "echo:"+payload {
		t.Fatalf("server echoed %q, want %q", string(respBytes), "echo:"+payload)
	}
	if !streamBody.IsClosed() {
		t.Fatal("expected streaming request body to be closed after RoundTrip completed")
	}
}
