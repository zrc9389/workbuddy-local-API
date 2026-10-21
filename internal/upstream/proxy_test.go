package upstream

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAccountProxyRoutesAndFailsClosed(t *testing.T) {
	var hits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); w.Write([]byte("direct")) }))
	defer target.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("proxy")) }))
	defer proxy.Close()
	c := New()
	a := &auth.Auth{UID: "proxy-user", ProxyURL: proxy.URL}
	req, _ := http.NewRequest("GET", target.URL, nil)
	resp, err := c.DoAccount(req, a)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "proxy" || hits.Load() != 0 {
		t.Fatal("not proxied")
	}
	for _, p := range []string{"invalid://user:supersecret@host", "http://127.0.0.1:1"} {
		a.ProxyURL = p
		req, _ = http.NewRequest("GET", target.URL, nil)
		_, err = c.DoAccount(req, a)
		if err == nil || strings.Contains(err.Error(), "supersecret") {
			t.Fatal("must fail safely", err)
		}
	}
	if hits.Load() != 0 {
		t.Fatal("fell back direct")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req, _ = http.NewRequestWithContext(ctx, "GET", target.URL, nil)
	a.ProxyURL = proxy.URL
	if _, err = c.DoAccount(req, a); err == nil {
		t.Fatal("ignored cancellation")
	}
}
func TestProxyCacheBoundedAndInvalidated(t *testing.T) {
	c := New()
	a := &auth.Auth{UID: "u", ProxyURL: "http://localhost:8080"}
	first := c.transportFor(a)
	if first != c.transportFor(a) {
		t.Fatal("not cached")
	}
	a.ProxyURL = "http://localhost:8081"
	if first == c.transportFor(a) {
		t.Fatal("stale cache")
	}
	c.ForgetTransport("u")
	for i := 0; i < proxyCacheLimit+10; i++ {
		a := &auth.Auth{UID: strings.Repeat("u", i+1), ProxyURL: "http://localhost:8080"}
		c.transportFor(a)
	}
	proxyTransports.Lock()
	n := len(proxyTransports.entries)
	proxyTransports.Unlock()
	if n > proxyCacheLimit {
		t.Fatal("unbounded cache", n)
	}
}
