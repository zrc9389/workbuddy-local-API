package metacore

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNativeControllerAuthenticationAndSanitizedFailure(t *testing.T) {
	seen := false
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-secret" {
			t.Error("missing controller bearer")
		}
		seen = true
		if r.URL.Path == "/failure" {
			w.WriteHeader(400)
			io.WriteString(w, "password=do-not-leak")
			return
		}
		io.WriteString(w, `{"version":"fixture"}`)
	}))
	defer s.Close()
	n := newNative(Options{Dir: t.TempDir()}, strings.TrimPrefix(s.URL, "http://"), "fixture-secret")
	var v struct {
		Version string `json:"version"`
	}
	if err := n.Request(context.Background(), "GET", "/version", nil, &v); err != nil || v.Version != "fixture" || !seen {
		t.Fatal(v, err)
	}
	if err := n.Request(context.Background(), "GET", "/failure", nil, nil); err == nil || strings.Contains(err.Error(), "password") {
		t.Fatal("raw controller error leaked")
	}
}
func TestDNSPrivateResolutionRejectedBeforeDial(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, err := publicDial(ctx, "tcp", net.JoinHostPort("127.0.0.1", "443"))
	if c != nil {
		c.Close()
		t.Fatal("private address dialed")
	}
	if err == nil || errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("did not reject before dial", err)
	}
}
