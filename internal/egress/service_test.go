package egress

import (
	"context"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type doerFunc func(*http.Request, *auth.Auth) (*http.Response, error)

func (f doerFunc) DoAccount(r *http.Request, a *auth.Auth) (*http.Response, error) { return f(r, a) }
func TestProbeAndMatrixAreBoundedAndSecretFree(t *testing.T) {
	s := New(Options{Timeout: time.Second, MaxCached: 2})
	a := &auth.Auth{UID: "a", ProxyURL: "http://user:secret@localhost:8080"}
	b := &auth.Auth{UID: "b"}
	var calls atomic.Int32
	do := doerFunc(func(r *http.Request, a *auth.Auth) (*http.Response, error) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "" {
			t.Fatal("credentials sent to public probe")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ip":"203.0.113.7"}`))}, nil
	})
	for _, acct := range []*auth.Auth{a, b} {
		result, err := s.Probe(context.Background(), do, acct)
		if err != nil || result.IP != "203.0.113.7" {
			t.Fatal(result, err)
		}
		if strings.Contains(result.Proxy, "secret") || strings.Contains(result.Proxy, "user") {
			t.Fatal("userinfo exposed")
		}
	}
	matrix := s.Matrix([]*auth.Auth{a, b})
	if len(matrix.Groups) != 1 || matrix.Groups[0].Count != 2 {
		t.Fatalf("not grouped by observed IP: %+v", matrix)
	}
	if calls.Load() != 2 {
		t.Fatal("matrix must not probe")
	}
	a.ProxyURL = "http://other:8080"
	matrix = s.Matrix([]*auth.Auth{a})
	if matrix.Accounts[0].IP != "" {
		t.Fatal("stale proxy observation")
	}
	for _, uid := range []string{"c", "d", "e"} {
		s.Probe(context.Background(), do, &auth.Auth{UID: uid})
	}
	s.mu.Lock()
	n := len(s.results)
	s.mu.Unlock()
	if n > 2 {
		t.Fatal("unbounded observations")
	}
}
func TestProbeCancellationAndInvalidResponse(t *testing.T) {
	s := New(Options{Timeout: 20 * time.Millisecond})
	do := doerFunc(func(r *http.Request, a *auth.Auth) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	if _, err := s.Probe(context.Background(), do, &auth.Auth{UID: "a"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	for _, body := range []string{"not an IP", `{"ip":"127.0.0.1"}`, strings.Repeat("x", 5000)} {
		_, err := s.Probe(context.Background(), doerFunc(func(r *http.Request, a *auth.Auth) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
		}), &auth.Auth{UID: "b"})
		if err == nil {
			t.Fatal("accepted invalid public IP")
		}
	}
}
func TestProbeConcurrencyLimit(t *testing.T) {
	s := New(Options{MaxConcurrent: 1})
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	do := doerFunc(func(r *http.Request, a *auth.Auth) (*http.Response, error) {
		close(started)
		<-release
		return nil, errors.New("proxy password=secret")
	})
	go func() { defer close(done); s.Probe(context.Background(), do, &auth.Auth{UID: "a"}) }()
	<-started
	_, err := s.Probe(context.Background(), do, &auth.Auth{UID: "b"})
	if !errors.Is(err, ErrBusy) {
		t.Fatal("missing limit", err)
	}
	close(release)
	<-done
}
