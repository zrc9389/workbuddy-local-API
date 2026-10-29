package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/localauth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/maintenance"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestAuthenticatedMaintenanceFlow(t *testing.T) {
	accounts := pool.New("")
	accounts.Add(&auth.Auth{UID: "test-account"})
	calls := make(chan string, 4)
	svc := maintenance.New(accounts, func(_ context.Context, step, _ string) (string, error) {
		calls <- step
		return "ok", nil
	})
	defer svc.Close()
	authenticator, err := localauth.New(filepath.Join(t.TempDir(), "password.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := authenticator.Wrap(New(Config{Pool: accounts, Maintenance: svc}))
	request := func(method, path, body string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://127.0.0.1:7863"+path, strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:12345"
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	login := request("POST", "/auth/login", `{"password":"isolated-test-password"}`, nil, "")
	if login.Code != http.StatusOK {
		t.Fatalf("login: %d", login.Code)
	}
	var session struct {
		CSRF string `json:"csrf_token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	cookies := login.Result().Cookies()
	if len(cookies) == 0 || session.CSRF == "" {
		t.Fatal("missing session")
	}
	denied := request("POST", "/panel/api/maintenance/run", "{}", cookies[0], "")
	if denied.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF: %d", denied.Code)
	}
	select {
	case step := <-calls:
		t.Fatalf("unauthorized request triggered %s", step)
	default:
	}
	response := request("POST", "/panel/api/maintenance/run", "{}", cookies[0], session.CSRF)
	if response.Code != http.StatusAccepted {
		t.Fatalf("start: %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{"token", "checkin", "activity", "travel"} {
		select {
		case step := <-calls:
			if step != expected {
				t.Fatalf("got %s, want %s", step, expected)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("step %s not called", expected)
		}
	}
}

// 与生产一致：鉴权在 Panel 外层由 localauth 包裹，测试直接发请求只验证 handler 透传，
// 不放宽任何生产鉴权配置。
func maintenanceStatusJSON(t *testing.T, p *Panel) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panel/api/maintenance/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode status: %v (body=%s)", err, rec.Body.String())
	}
	for _, key := range []string{"last_run_at", "last_finished_at", "last_result", "last_failed"} {
		if _, ok := body[key]; !ok {
			t.Fatalf("missing JSON key %q in %s", key, rec.Body.String())
		}
	}
	return body
}

func TestMaintenanceStatusExposesTimingFields(t *testing.T) {
	accounts := pool.New("")
	accounts.Add(&auth.Auth{UID: "u"})
	svc := maintenance.New(accounts, func(context.Context, string, string) (string, error) {
		return "done", nil
	})
	p := New(Config{Pool: accounts, Maintenance: svc})

	fresh := maintenanceStatusJSON(t, p)
	if fresh["last_run_at"] != "" || fresh["last_finished_at"] != "" || fresh["last_result"] != "" {
		t.Fatalf("fresh status should be empty: %v", fresh)
	}
	if failed, ok := fresh["last_failed"].(float64); !ok || failed != 0 {
		t.Fatalf("fresh last_failed=%v want 0", fresh["last_failed"])
	}

	if !svc.Start() {
		t.Fatal("maintenance did not start")
	}
	deadline := time.Now().Add(3 * time.Second)
	var body map[string]any
	for time.Now().Before(deadline) {
		body = maintenanceStatusJSON(t, p)
		if running, _ := body["running"].(bool); !running {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if running, _ := body["running"].(bool); running {
		t.Fatal("maintenance did not finish")
	}
	runAt, _ := body["last_run_at"].(string)
	finishedAt, _ := body["last_finished_at"].(string)
	if runAt == "" || finishedAt == "" {
		t.Fatalf("timing fields not passed through: %v", body)
	}
	if _, err := time.Parse(time.RFC3339, runAt); err != nil {
		t.Fatalf("last_run_at=%q not RFC3339: %v", runAt, err)
	}
	if _, err := time.Parse(time.RFC3339, finishedAt); err != nil {
		t.Fatalf("last_finished_at=%q not RFC3339: %v", finishedAt, err)
	}
	if body["last_result"] != "ok" {
		t.Fatalf("last_result=%v want ok", body["last_result"])
	}
}

func TestOverviewReportsServiceMemoryAvailability(t *testing.T) {
	p := New(Config{Pool: pool.New("")})
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panel/api/overview", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("overview status = %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	available, ok := body["service_memory_available"].(bool)
	if !ok {
		t.Fatal("service memory availability missing")
	}
	bytes, ok := body["service_memory_bytes"].(float64)
	if !ok || (available && bytes <= 0) {
		t.Fatalf("invalid service memory value: %v", body["service_memory_bytes"])
	}
}
