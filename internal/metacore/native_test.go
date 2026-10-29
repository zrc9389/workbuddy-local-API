package metacore

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestRealCoreIsolationAndNativeProviders(t *testing.T) {
	if os.Getenv("META_REAL_TEST") != "1" {
		t.Skip("explicit opt-in isolated loopback real-core smoke")
	}
	relative, ok := KernelPath(runtime.GOOS, runtime.GOARCH)
	if !ok {
		t.Fatal("META_REAL_TEST requested on unsupported kernel platform")
	}
	binary, err := filepath.Abs(filepath.Join("..", "..", relative))
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(Options{Dir: t.TempDir(), Binary: binary})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { m.CancelTests(); m.cancel(); _ = m.core.Stop(); m.wg.Wait() }()
	streamRelease := make(chan struct{})
	fixture := func(marker string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "CONNECT" {
				c, rw, e := w.(http.Hijacker).Hijack()
				if e != nil {
					return
				}
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(5 * time.Second))
				fmt.Fprint(rw, "HTTP/1.1 200 Connection Established\r\n\r\n")
				rw.Flush()
				req, e := http.ReadRequest(bufio.NewReader(c))
				if e != nil {
					return
				}
				req.Body.Close()
				if req.URL.Path == "/health" {
					time.Sleep(10 * time.Millisecond)
					fmt.Fprint(c, "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
					return
				}
				if req.URL.Path == "/stream" {
					fmt.Fprintf(c, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s1", 2*(len(marker)+1), marker)
					select {
					case <-streamRelease:
					case <-time.After(8 * time.Second):
					}
					fmt.Fprintf(c, "%s2", marker)
					return
				}
				fmt.Fprintf(c, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(marker), marker)
				return
			}
			w.Header().Set("Connection", "close")
			fmt.Fprint(w, marker)
		}))
	}
	a := fixture("fixture-A")
	defer a.Close()
	b := fixture("fixture-B")
	defer b.Close()
	au, _ := url.Parse(a.URL)
	bu, _ := url.Parse(b.URL)
	payload := fmt.Sprintf("proxies:\n  - name: one\n    type: http\n    server: 127.0.0.1\n    port: %s\n  - name: two\n    type: http\n    server: 127.0.0.1\n    port: %s\n", au.Port(), bu.Port())
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if _, err = m.importBytes(ctx, "fixture", []byte(payload)); err != nil {
		t.Fatal("native YAML provider", err)
	}
	if got := m.Status().Version; got != KernelVersion {
		t.Fatalf("running kernel version = %q, want %q", got, KernelVersion)
	}
	pin, _ := pinnedPlatform(runtime.GOOS, runtime.GOARCH)
	t.Logf("real kernel: %s/%s %s sha256=%s path=%s", runtime.GOOS, runtime.GOARCH, KernelVersion, pin.sha256, binary)
	ns := m.Nodes().Nodes
	var one, two string
	for _, n := range ns {
		if n.Name == "fixture/one" {
			one = n.ID
		}
		if n.Name == "fixture/two" {
			two = n.ID
		}
	}
	if one == "" || two == "" {
		t.Fatal("missing native parsed nodes", ns)
	}
	var proxyA, proxyB string
	ba, err := m.Bind(ctx, "account-a", one, func(p string) error { proxyA = p; return nil })
	if err != nil {
		t.Fatal("bind A", err)
	}
	bb, err := m.Bind(ctx, "account-b", two, func(p string) error { proxyB = p; return nil })
	if err != nil {
		t.Fatal("bind B", err)
	}
	unauthProxy, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", ba.Port))
	unauthTransport := &http.Transport{Proxy: http.ProxyURL(unauthProxy), DisableKeepAlives: true}
	unauthClient := &http.Client{Transport: unauthTransport, Timeout: 3 * time.Second}
	unauthResp, e := unauthClient.Get("http://192.0.2.1/auth-check")
	if e != nil {
		t.Fatal(e)
	}
	unauthResp.Body.Close()
	unauthTransport.CloseIdleConnections()
	if unauthResp.StatusCode != 407 {
		t.Fatal("listener missing auth", unauthResp.StatusCode)
	}
	if ba.Port == bb.Port || ba.RouteID == bb.RouteID {
		t.Fatal("shared route")
	}
	if err := m.RemoveSubscription(ctx, "fixture"); err != ErrSubscriptionInUse {
		t.Fatalf("delete bound provider: %v", err)
	}
	// The loopback proxies intentionally do not implement TLS. A health check
	// must fail through them, without contacting the real target directly.
	waitJob := func(job TestJob) TestJob {
		t.Helper()
		for m.Tests().Running && ctx.Err() == nil {
			time.Sleep(20 * time.Millisecond)
		}
		result := m.Tests()
		if result.ID != job.ID || result.Running || result.Cancelled {
			t.Fatalf("unexpected test job: %+v", result)
		}
		return result
	}
	job, err := m.StartNodeTest(ctx, one)
	if err != nil {
		t.Fatal("single node test", err)
	}
	if result := waitJob(job); result.Total != 1 || result.Completed != 1 || result.Failed != 1 {
		t.Fatalf("single node result: %+v", result)
	}
	job, err = m.StartTests(ctx)
	if err != nil {
		t.Fatal("batch node test", err)
	}
	if result := waitJob(job); result.Total != 2 || result.Completed != 2 || result.Failed != 2 {
		t.Fatalf("batch result: %+v", result)
	}
	for _, n := range m.Nodes().Nodes {
		if n.Status != "error" && n.Status != "timeout" {
			t.Fatalf("unexpected node health: %+v", n)
		}
	}
	// Use a local HTTP target to verify the real controller's success response.
	for _, n := range m.Nodes().Nodes {
		var delay map[string]int
		path := "/providers/proxies/" + url.PathEscape(n.Provider) + "/" + url.PathEscape(n.Name) + "/healthcheck?url=" + url.QueryEscape("http://192.0.2.1/health") + "&timeout=5000"
		if err := m.core.Request(ctx, "GET", path, nil, &delay); err != nil || delay["delay"] <= 0 {
			t.Fatalf("real healthcheck %s: delay=%v error=%v", n.ID, delay, err)
		}
	}
	accountA := &auth.Auth{UID: "account-a", AccessToken: "fixture-token-a", ProxyURL: proxyA}
	accountB := &auth.Auth{UID: "account-b", AccessToken: "fixture-token-b", ProxyURL: proxyB}
	client := upstream.New()
	client.AccountLease = func(ctx context.Context, account *auth.Auth) (func(), error) {
		return m.AcquireAccount(ctx, account.UID)
	}
	accountFetch := func(account *auth.Auth, target string) (string, error) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return "", err
		}
		response, err := client.DoAccount(request, account)
		if err != nil {
			return "", err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		return string(body), err
	}
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "direct:", r.URL.Path) }))
	defer direct.Close()
	if got, err := accountFetch(&auth.Auth{UID: "direct"}, direct.URL+"/direct-check"); err != nil || got != "direct:/direct-check" {
		t.Fatalf("direct route: %q %v", got, err)
	}
	var parallel sync.WaitGroup
	failures := make(chan string, 40)
	for index := 0; index < 20; index++ {
		for _, item := range []struct {
			account *auth.Auth
			want    string
		}{{accountA, "fixture-A"}, {accountB, "fixture-B"}} {
			parallel.Add(1)
			go func(account *auth.Auth, want string) {
				defer parallel.Done()
				got, err := accountFetch(account, "http://192.0.2.1/concurrent")
				if err != nil || got != want {
					failures <- fmt.Sprintf("%s: %q %v", account.UID, got, err)
				}
			}(item.account, item.want)
		}
	}
	parallel.Wait()
	close(failures)
	for failure := range failures {
		t.Error(failure)
	}
	fetch := func(proxy string) string {
		t.Helper()
		u, _ := url.Parse(proxy)
		tr := &http.Transport{Proxy: http.ProxyURL(u), DisableKeepAlives: true}
		defer tr.CloseIdleConnections()
		client := &http.Client{Transport: tr, Timeout: 5 * time.Second}
		resp, e := client.Get("http://192.0.2.1/loopback-proxy-fixture")
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		v, _ := io.ReadAll(resp.Body)
		return string(v)
	}
	if got := fetch(proxyA); got != "fixture-A" {
		t.Fatal("A", got)
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("B", got)
	}
	streamProxy, _ := url.Parse(proxyA)
	streamTransport := &http.Transport{Proxy: http.ProxyURL(streamProxy), DisableKeepAlives: true}
	defer streamTransport.CloseIdleConnections()
	streamClient := &http.Client{Transport: streamTransport, Timeout: 8 * time.Second}
	streamResp, e := streamClient.Get("http://192.0.2.1/stream")
	if e != nil {
		t.Fatal(e)
	}
	defer streamResp.Body.Close()
	firstChunk := make([]byte, len("fixture-A1"))
	if _, e = io.ReadFull(streamResp.Body, firstChunk); e != nil || string(firstChunk) != "fixture-A1" {
		t.Fatal("stream first", e, string(firstChunk))
	}
	if err = m.core.Request(ctx, "PATCH", "/configs", map[string]string{"mode": "global"}, nil); err != nil {
		t.Fatal(err)
	}
	if err = m.core.Request(ctx, "PUT", "/proxies/GLOBAL", map[string]string{"name": "REJECT"}, nil); err != nil {
		t.Fatal(err)
	}
	if got := fetch(proxyA); got != "fixture-A" {
		t.Fatal("GLOBAL changed A", got)
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("GLOBAL changed B", got)
	}
	if _, err = m.Bind(ctx, "account-a", two, func(p string) error {
		if p != proxyA {
			t.Fatal("changed endpoint")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if got := fetch(proxyA); got != "fixture-B" {
		t.Fatal("A not switched", got)
	}
	if got, err := accountFetch(accountA, "http://192.0.2.1/after-switch"); err != nil || got != "fixture-B" {
		t.Fatalf("account client retained old route: %q %v", got, err)
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("A changed B", got)
	}
	close(streamRelease)
	lastChunk, e := io.ReadAll(streamResp.Body)
	if e != nil || string(lastChunk) != "fixture-A2" {
		t.Fatal("active stream interrupted by selector/config update", e, string(lastChunk))
	}
	// Native URI and Base64 formats: fake SSRF-free loopback proxy, no dial made.
	uri := "http://127.0.0.1:" + au.Port() + "#uri-node"
	for id, content := range map[string]string{"uri": uri, "base64": base64.StdEncoding.EncodeToString([]byte(uri))} {
		if _, err = m.importBytes(ctx, id, []byte(content)); err != nil {
			t.Fatal("native "+id+" provider", err)
		}
	}
	if err = m.RemoveSubscription(ctx, "uri"); err != nil {
		t.Fatal("delete unbound provider", err)
	}
	for _, n := range m.Nodes().Nodes {
		if n.Provider == "uri" {
			t.Fatal("deleted provider node remains")
		}
	}
	// A remote configuration's extra keys cannot replace app controller/listeners.
	takeover := payload + "external-controller: 0.0.0.0:9090\nsecret: attacker\nlisteners: []\n"
	if _, err = m.importBytes(ctx, "extra", []byte(takeover)); err != nil {
		t.Fatal("extra top-level keys provider", err)
	}
	var cfg map[string]any
	if err = m.core.Request(ctx, "GET", "/configs", nil, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["allow-lan"] != false {
		t.Fatal("remote config takeover")
	}
	// Invalid native provider must not replace live bindings.
	if _, err = m.importBytes(ctx, "fixture", []byte("not a provider: [")); err == nil {
		t.Fatal("invalid native provider accepted")
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("invalid update affected B", got)
	}
	public, _ := json.Marshal(m.Nodes())
	if strings.Contains(string(public), m.secret) || strings.Contains(string(public), "password") {
		t.Fatal("secret in frontend payload")
	}
	// Controller is protected even from loopback callers without secret.
	resp, err := http.Get("http://" + m.controller + "/version")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatal("controller not authenticated", resp.StatusCode)
	} // Persisted bindings recover before the next leased account request.
	if err = m.core.Stop(); err != nil {
		t.Fatal(err)
	}
	m2, err := New(Options{Dir: m.opts.Dir, Binary: binary})
	if err != nil {
		t.Fatal("reload manager", err)
	}
	defer func() { m2.cancel(); _ = m2.core.Stop(); m2.wg.Wait() }()
	release, err := m2.AcquireAccount(ctx, "account-b")
	if err != nil {
		t.Fatal("restart lease", err)
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("persisted route not restored", got)
	}
	release() // Real idle stop under the lease contract, then demand-start same stable route.
	m2.mu.Lock()
	m2.lastUse = time.Now().Add(-time.Hour)
	m2.mu.Unlock()
	idleDeadline := time.Now().Add(3 * time.Second)
	for m2.core.Alive() && time.Now().Before(idleDeadline) {
		m2.maybeIdle(connectionsSnapshot{})
		if m2.core.Alive() {
			time.Sleep(30 * time.Millisecond)
		}
	}
	if m2.core.Alive() {
		t.Fatal("real core failed idle shutdown")
	}
	release, err = m2.AcquireAccount(ctx, "account-b")
	if err != nil {
		t.Fatal("idle wake lease", err)
	}
	if err = m2.Close(ctx); err != ErrBusy {
		t.Fatal("real leased core shutdown not refused", err)
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("idle wake route", got)
	}
	release()
	if err = m2.DeleteAccountBinding(ctx, "account-a"); err != nil {
		t.Fatal("delete account route", err)
	}
	if m2.IsBound("account-a") || !m2.IsBound("account-b") {
		t.Fatal("account deletion changed wrong binding")
	}
	if got := fetch(proxyB); got != "fixture-B" {
		t.Fatal("account deletion affected B", got)
	}
	deletedProxy, _ := url.Parse(proxyA)
	deletedTransport := &http.Transport{Proxy: http.ProxyURL(deletedProxy), DisableKeepAlives: true}
	defer deletedTransport.CloseIdleConnections()
	deletedClient := &http.Client{Transport: deletedTransport, Timeout: 3 * time.Second}
	deletedResponse, deletedErr := deletedClient.Get(direct.URL + "/deleted")
	if deletedErr == nil {
		deletedResponse.Body.Close()
		if deletedResponse.StatusCode < 400 {
			t.Fatal("deleted listener still forwards requests", deletedResponse.StatusCode)
		}
	}
	b.Close()
	unavailableProxy, _ := url.Parse(proxyB)
	unavailableTransport := &http.Transport{Proxy: http.ProxyURL(unavailableProxy), DisableKeepAlives: true}
	defer unavailableTransport.CloseIdleConnections()
	unavailableClient := &http.Client{Transport: unavailableTransport, Timeout: 3 * time.Second}
	unavailableResponse, unavailableErr := unavailableClient.Get(direct.URL + "/unavailable")
	if unavailableErr == nil {
		unavailableResponse.Body.Close()
		if unavailableResponse.StatusCode < 400 {
			t.Fatal("unavailable proxy silently fell back", unavailableResponse.StatusCode)
		}
	}
}
