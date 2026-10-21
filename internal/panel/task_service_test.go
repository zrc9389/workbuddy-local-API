package panel

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/tasks"
	"net/http/httptest"
	"testing"
)

func TestTaskServiceInjectionSharesExecutionLock(t *testing.T) {
	ap := pool.New("")
	ap.Add(&auth.Auth{UID: "u", AccessToken: "fake"})
	svc := tasks.New(tasks.Config{Pool: ap})
	p := New(Config{Pool: ap, Tasks: svc})
	if !svc.TryLockAccount("u") {
		t.Fatal("lock")
	}
	defer svc.UnlockAccount("u")
	if p.tryLockAccount("u") {
		t.Fatal("panel owns a separate task lock")
	}
	w := httptest.NewRecorder()
	p.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/tasks/queue", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var v map[string]any
	if json.Unmarshal(w.Body.Bytes(), &v) != nil || v["running"] != false || v["total"] != float64(0) {
		t.Fatal(w.Body.String())
	}
}
func TestOverviewAlwaysRequiresManagementAuthentication(t *testing.T) {
	p := New(Config{Pool: pool.New("")})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/overview", nil))
	var v map[string]any
	json.Unmarshal(w.Body.Bytes(), &v)
	if v["auth_required"] != true {
		t.Fatal("password management boundary must always be advertised")
	}
}
