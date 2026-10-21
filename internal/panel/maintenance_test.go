package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/maintenance"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

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
