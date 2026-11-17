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

func TestSubnetGroupingWarningsAndCachedIP(t *testing.T) {
	s := New(Options{Timeout: time.Second, TTL: 50 * time.Millisecond})
	a := &auth.Auth{UID: "a", ProxyURL: "http://127.0.0.1:10001"}
	b := &auth.Auth{UID: "b", ProxyURL: "http://127.0.0.1:10002"}
	c := &auth.Auth{UID: "c", ProxyURL: "http://127.0.0.1:10003"}
	d := &auth.Auth{UID: "d", ProxyURL: "http://127.0.0.1:10004"}
	e := &auth.Auth{UID: "e", ProxyURL: "http://127.0.0.1:10005"}

	ipByUID := map[string]string{
		"a": "203.0.113.7",
		"b": "203.0.113.7",
		"c": "203.0.113.42",
		"d": "2001:db8:1:2::9",
		"e": "2001:db8:1:2::42",
	}
	var calls atomic.Int32
	do := doerFunc(func(r *http.Request, acct *auth.Auth) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"ip":"` + ipByUID[acct.UID] + `"}`)),
		}, nil
	})

	for _, acct := range []*auth.Auth{a, b, c, d, e} {
		res, err := s.Probe(context.Background(), do, acct)
		if err != nil {
			t.Fatalf("probe %s failed: %v", acct.UID, err)
		}
		if res.Subnet == "" {
			t.Fatalf("probe %s missing subnet", acct.UID)
		}
	}
	if calls.Load() != 5 {
		t.Fatalf("unexpected probe calls=%d", calls.Load())
	}

	// Matrix & CachedIP must perform 0 external network calls.
	matrix := s.Matrix([]*auth.Auth{a, b, c, d, e})
	if calls.Load() != 5 {
		t.Fatal("Matrix performed unexpected network call")
	}
	if len(matrix.SubnetGroups) != 2 {
		t.Fatalf("expected 2 subnet groups (/24 and /64), got %+v", matrix.SubnetGroups)
	}
	subnetByKey := map[string]SubnetGroup{}
	for _, sg := range matrix.SubnetGroups {
		subnetByKey[sg.Subnet] = sg
	}
	v4g, ok := subnetByKey["203.0.113.0/24"]
	if !ok || v4g.Count != 3 || len(v4g.IPs) != 2 {
		t.Fatalf("unexpected IPv4 /24 group: %+v", v4g)
	}
	v6g, ok := subnetByKey["2001:db8:1:2::/64"]
	if !ok || v6g.Count != 2 || len(v6g.IPs) != 2 {
		t.Fatalf("unexpected IPv6 /64 group: %+v", v6g)
	}

	var hasSameIP, hasV4Subnet, hasV6Subnet bool
	for _, w := range matrix.Warnings {
		if w.Type == "same_ip" && w.Key == "203.0.113.7" && w.Count == 2 {
			hasSameIP = true
		}
		if w.Type == "same_subnet" && w.Key == "203.0.113.0/24" && w.Count == 3 {
			hasV4Subnet = true
		}
		if w.Type == "same_subnet" && w.Key == "2001:db8:1:2::/64" && w.Count == 2 {
			hasV6Subnet = true
		}
	}
	if !hasSameIP || !hasV4Subnet || !hasV6Subnet {
		t.Fatalf("missing expected warnings: %+v", matrix.Warnings)
	}

	// CachedIP hit
	if got := s.CachedIP(a); got != "203.0.113.7" {
		t.Fatalf("CachedIP(a)=%q want 203.0.113.7", got)
	}
	if got := s.CachedIP(nil); got != "" {
		t.Fatalf("CachedIP(nil)=%q want empty", got)
	}
	// Proxy change invalidates CachedIP immediately
	a.ProxyURL = "http://127.0.0.1:19999"
	if got := s.CachedIP(a); got != "" {
		t.Fatalf("CachedIP after proxy change=%q want empty", got)
	}
	// TTL expiry invalidates CachedIP
	time.Sleep(65 * time.Millisecond)
	if got := s.CachedIP(b); got != "" {
		t.Fatalf("CachedIP after TTL expiry=%q want empty", got)
	}
	if calls.Load() != 5 {
		t.Fatal("CachedIP performed unexpected network call")
	}
}
