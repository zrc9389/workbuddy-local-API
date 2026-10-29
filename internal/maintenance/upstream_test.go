package maintenance

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Exercise the production action against a fake transport, never a real account.
func TestUpstreamActionCallsAllFourRealEndpoints(t *testing.T) {
	paths := []string{}
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		body := "{\"code\":0,\"data\":{}}"
		switch r.URL.Path {
		case "/v2/plugin/auth/token/refresh":
			body = "{\"code\":0,\"data\":{\"accessToken\":\"fake-new\",\"refreshToken\":\"fake-new-refresh\"}}"
		case "/v2/billing/meter/get-user-resource":
			body = "{\"code\":0,\"data\":{\"Response\":{\"Data\":{\"Accounts\":[{\"CycleCapacitySize\":100,\"CycleCapacityRemain\":50}]}}}}"
		case "/activity/growth/buddy/info":
			body = "{\"code\":0,\"data\":{\"buddy\":{\"id\":1}}}"
		case "/activity/growth/streak":
			body = "{\"code\":0,\"data\":{\"streak\":{\"days\":3}}}"
		case "/activity/growth/buddy/travel/status":
			body = "{\"code\":0,\"data\":{\"state\":\"idle\"}}"
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	client := &upstream.Client{HTTP: &http.Client{Transport: transport}, ChatBaseCN: "https://test.invalid", BillingBaseCN: "https://test.invalid"}
	p := pool.New("")
	p.Add(&auth.Auth{UID: "fake", AccessToken: "fake-old", RefreshToken: "fake-refresh", FilePath: filepath.Join(t.TempDir(), "auth.json")})
	action := UpstreamAction(p, client)
	for _, step := range []string{"token", "checkin", "activity", "travel"} {
		if _, err := action(context.Background(), step, "fake"); err != nil {
			t.Fatalf("%s: %v", step, err)
		}
	}
	want := []string{"POST /v2/plugin/auth/token/refresh", "POST /v2/billing/meter/daily-checkin", "POST /v2/billing/meter/get-user-resource", "POST /v2/report", "GET /activity/growth/streak", "GET /activity/growth/buddy/info", "GET /activity/growth/buddy/travel/status", "POST /activity/growth/buddy/travel/depart"}
	if strings.Join(paths, "|") != strings.Join(want, "|") {
		t.Fatalf("paths=%v want=%v", paths, want)
	}
}
