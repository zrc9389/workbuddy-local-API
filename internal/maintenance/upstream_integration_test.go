package maintenance

import (
	"context"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

type maintenanceTransport func(*http.Request) (*http.Response, error)

func (f maintenanceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRealUpstreamActionsCoverAllAccounts(t *testing.T) {
	p := pool.New("")
	calls := map[string]map[string]int{}
	transport := maintenanceTransport(func(r *http.Request) (*http.Response, error) {
		uid := r.Header.Get("X-User-Id")
		if uid == "" {
			uid = r.Header.Get("X-Refresh-Token")
		}
		if calls[uid] == nil {
			calls[uid] = map[string]int{}
		}
		calls[uid][r.URL.Path]++
		status, body := 200, `{"code":0,"data":{}}`
		if strings.HasPrefix(uid, "isolated") {
			status, body = 401, `{"code":12153,"msg":"Offline user session not found"}`
		} else {
			switch r.URL.Path {
			case "/v2/plugin/auth/token/refresh":
				body = `{"code":0,"data":{"accessToken":"new","refreshToken":"newrt","expiresIn":3600}}`
			case "/v2/billing/meter/get-user-resource":
				body = `{"code":0,"data":{"Response":{"Data":{"Accounts":[]}}}}`
			case "/activity/growth/buddy/info":
				body = `{"code":0,"data":{"buddy":{"id":7,"name":"fixture"}}}`
			case "/activity/growth/streak":
				body = `{"code":0,"data":{"streak":{"days":3}}}`
			case "/activity/growth/buddy/travel/status":
				body = `{"code":0,"data":{"state":"traveling"}}`
			}
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	up := &upstream.Client{HTTP: &http.Client{Transport: transport}, ChatBaseCN: "https://fixture.invalid", BillingBaseCN: "https://fixture.invalid"}
	add := func(uid string) {
		p.Add(&auth.Auth{UID: uid, AccessToken: "fixture", RefreshToken: uid, FilePath: filepath.Join(t.TempDir(), "auth.json")})
	}
	for i := 0; i < 7; i++ {
		add(fmt.Sprintf("healthy%d", i))
	}
	for i := 0; i < 8; i++ {
		uid := fmt.Sprintf("isolated%d", i)
		add(uid)
		p.Disable(uid, "invalid token")
	}
	add("manual")
	p.SetManualDisabled("manual", true)
	svc := New(p, UpstreamAction(p, up))
	defer svc.Close()
	if !svc.Start() {
		t.Fatal("start failed")
	}
	st := waitFinished(t, svc)
	for _, step := range st.Steps {
		if step.Total != 16 || step.Completed != 8 || step.Failed != 8 || len(step.Accounts) != 16 {
			t.Fatalf("step=%+v", step)
		}
		for _, result := range step.Accounts {
			if result.UID == "manual" && result.State != "done" {
				t.Fatalf("manual=%+v", result)
			}
			if strings.HasPrefix(result.UID, "isolated") && result.State != "failed" {
				t.Fatalf("isolated=%+v", result)
			}
		}
	}
	for i := 0; i < 7; i++ {
		uid := fmt.Sprintf("healthy%d", i)
		for _, path := range []string{"/v2/plugin/auth/token/refresh", "/v2/billing/meter/daily-checkin", "/v2/billing/meter/get-user-resource", "/v2/report", "/activity/growth/streak", "/activity/growth/buddy/info", "/activity/growth/buddy/travel/status"} {
			if calls[uid][path] != 1 {
				t.Errorf("%s %s calls=%d", uid, path, calls[uid][path])
			}
		}
	}
	for i := 0; i < 8; i++ {
		uid := fmt.Sprintf("isolated%d", i)
		for _, path := range []string{"/v2/plugin/auth/token/refresh", "/v2/billing/meter/daily-checkin", "/v2/report", "/activity/growth/buddy/info"} {
			if calls[uid][path] != 1 {
				t.Errorf("%s %s calls=%d", uid, path, calls[uid][path])
			}
		}
	}
	for _, path := range []string{"/v2/plugin/auth/token/refresh", "/v2/billing/meter/daily-checkin", "/v2/report", "/activity/growth/buddy/info"} {
		if calls["manual"][path] != 1 {
			t.Errorf("manual %s calls=%d", path, calls["manual"][path])
		}
	}
}

func TestActivityReportAcceptedButUnauthorizedVerificationFails(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "expired", AccessToken: "fixture"})
	var report, streak int
	transport := maintenanceTransport(func(r *http.Request) (*http.Response, error) {
		status, body := 200, `{"code":0,"data":{}}`
		if r.URL.Path == "/v2/report" {
			report++
		}
		if r.URL.Path == "/activity/growth/streak" {
			streak++
			status, body = 401, `{"code":12153,"msg":"Offline user session not found"}`
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	up := &upstream.Client{HTTP: &http.Client{Transport: transport}, ChatBaseCN: "https://fixture.invalid", BillingBaseCN: "https://fixture.invalid"}
	_, err := UpstreamAction(p, up)(context.Background(), "activity", "expired")
	if err == nil || !strings.Contains(err.Error(), "连登回读失败") || report != 1 || streak != 1 {
		t.Fatalf("error=%v report=%d streak=%d", err, report, streak)
	}
}
