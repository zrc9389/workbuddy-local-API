package metacore

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/server"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestRealCoreSubscriptionHandlerEgress(t *testing.T) {
	if os.Getenv("META_REAL_TEST") != "1" {
		t.Skip("requires pinned real kernel")
	}
	relative, ok := KernelPath(runtime.GOOS, runtime.GOARCH)
	if !ok {
		t.Skip("unsupported kernel platform")
	}
	binary, err := filepath.Abs(filepath.Join("..", "..", relative))
	if err != nil {
		t.Fatal(err)
	}
	manager, err := New(Options{Dir: t.TempDir(), Binary: binary})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { manager.cancel(); _ = manager.core.Stop(); manager.wg.Wait() }()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	observed := make(chan string, 20)
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		observed <- r.URL.Path + "|" + r.Header.Get("Authorization") + "|" + string(body)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"id\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer upstreamServer.Close()
	target, _ := url.Parse(upstreamServer.URL)
	var hitsA, hitsB atomic.Int32
	proxy := func(hits *atomic.Int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodConnect || r.Header.Get("Proxy-Authorization") != "Basic dXNlcjpwcm94eS1zZWNyZXQ=" {
				http.Error(w, "proxy auth", 407)
				return
			}
			connection, err := net.DialTimeout("tcp", target.Host, time.Second)
			if err != nil {
				http.Error(w, "upstream unavailable", 502)
				return
			}
			client, buffer, err := w.(http.Hijacker).Hijack()
			if err != nil {
				connection.Close()
				return
			}
			hits.Add(1)
			fmt.Fprint(buffer, "HTTP/1.1 200 Connection Established\r\n\r\n")
			buffer.Flush()
			go func() { _, _ = io.Copy(connection, buffer); connection.Close() }()
			_, _ = io.Copy(client, connection)
			client.Close()
		}))
	}
	proxyA, proxyB := proxy(&hitsA), proxy(&hitsB)
	defer proxyA.Close()
	defer proxyB.Close()
	addressA, _ := url.Parse(proxyA.URL)
	addressB, _ := url.Parse(proxyB.URL)
	var current atomic.Value
	makeProvider := func(port string) string {
		return fmt.Sprintf("proxies:\n  - name: stable\n    type: http\n    server: 127.0.0.1\n    port: %s\n    username: user\n    password: proxy-secret\n  - name: backup\n    type: http\n    server: 127.0.0.1\n    port: %s\n    username: user\n    password: proxy-secret\n", port, addressA.Port())
	}
	current.Store(makeProvider(addressA.Port()))
	subscription := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, current.Load().(string)) }))
	defer subscription.Close()
	manager.setFetcher(func(ctx context.Context, raw string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, subscription.URL, nil)
		if err != nil {
			return nil, err
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		return io.ReadAll(response.Body)
	})
	result, err := manager.AddSubscription(ctx, "https://example.com/private-token?secret=subscription-secret")
	if err != nil {
		t.Fatal(err)
	}
	if result.Nodes != 2 {
		t.Fatalf("nodes: %+v", result)
	}
	var node, backup Node
	for _, candidate := range manager.Nodes().Nodes {
		if strings.HasSuffix(candidate.Name, "/stable") {
			node = candidate
		}
		if strings.HasSuffix(candidate.Name, "/backup") {
			backup = candidate
		}
	}
	if node.ID == "" || backup.ID == "" {
		t.Fatal("missing fixture nodes")
	}
	account := &auth.Auth{UID: "account-a", AccessToken: "account-token", ExpiresAt: 9999999999}
	_, err = manager.Bind(ctx, account.UID, node.ID, func(proxy string) error { account.ProxyURL = proxy; return nil })
	if err != nil {
		t.Fatal(err)
	}
	client := upstream.New()
	client.ChatBaseCN = "http://192.0.2.1"
	client.AccountLease = func(ctx context.Context, account *auth.Auth) (func(), error) {
		return manager.AcquireAccount(ctx, account.UID)
	}
	accounts := pool.New("")
	accounts.Add(account)
	accounts.SetCredits(account.UID, 1000, 0)
	handler := server.NewHandler(server.Config{Pool: accounts, Upstream: client})
	send := func() {
		t.Helper()
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"glm-5.2","messages":[{"role":"user","content":"fixture-body"}]}`)))
		if recorder.Code != 200 {
			t.Fatalf("handler: %d %s", recorder.Code, recorder.Body.String())
		}
		select {
		case request := <-observed:
			if !strings.HasPrefix(request, "/v2/chat/completions|Bearer account-token|") || !strings.Contains(request, "fixture-body") {
				t.Fatalf("upstream request: %s", request)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	send()
	send()
	t.Logf("A sequential tunnel connections: %d", hitsA.Load())
	if hitsA.Load() < 1 || hitsB.Load() != 0 {
		t.Fatalf("initial exits: %d %d", hitsA.Load(), hitsB.Load())
	}
	current.Store(makeProvider(addressB.Port()))
	if _, err = manager.RefreshSubscription(ctx, result.Provider); err != nil {
		t.Fatal("refresh", err)
	}
	send()
	if hitsB.Load() < 1 {
		t.Fatalf("updated exit not used: %d %d", hitsA.Load(), hitsB.Load())
	}
	proxyB.Close()
	manager.testNode(ctx, node)
	var failed Node
	for _, candidate := range manager.Nodes().Nodes {
		if candidate.ID == node.ID {
			failed = candidate
		}
	}
	if failed.Status != "error" && failed.Status != "timeout" {
		t.Fatalf("health status: %s", failed.Status)
	}
	if manager.snapshot().Bindings[0].Node != node.ID {
		t.Fatal("health check unexpectedly switched binding")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"glm-5.2","messages":[{"role":"user","content":"failure"}]}`)))
	if recorder.Code < 400 {
		t.Fatalf("unavailable proxy unexpectedly succeeded: %d", recorder.Code)
	}
	if _, err = manager.Bind(ctx, account.UID, backup.ID, func(proxy string) error { return nil }); err != nil {
		t.Fatal("manual switch", err)
	}
	send()
	public, _ := json.Marshal(manager.Subscriptions())
	if strings.Contains(string(public), "subscription-secret") || strings.Contains(string(public), "proxy-secret") {
		t.Fatal("subscription secrets exposed", string(public))
	}
}
