package panel

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/scheduler"
)

func TestTasksScheduleGate(t *testing.T) {
	s := scheduler.New(scheduler.Config{Pool: pool.New("")})
	p := New(Config{Pool: pool.New(""), Scheduler: s, SaveConfig: func(raw []byte) ([]string, error) {
		var patch map[string]map[string]bool
		if err := json.Unmarshal(raw, &patch); err != nil {
			return nil, err
		}
		cfg := patch["schedule"]
		for _, key := range []string{"checkin_enabled", "travel_enabled", "activity_enabled", "keepalive_enabled"} {
			if _, ok := cfg[key]; !ok {
				t.Fatalf("missing %s", key)
			}
		}
		s.Reconfigure(nil, nil, nil, nil, nil, nil, !cfg["checkin_enabled"], !cfg["travel_enabled"], !cfg["activity_enabled"], !cfg["keepalive_enabled"], true, true)
		return nil, nil
	}})

	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panel/api/tasks/schedule", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET schedule: status=%d body=%s", rec.Code, rec.Body.String())
	}
	var state struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil || !state.Enabled {
		t.Fatalf("expected enabled by default: %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/tasks/schedule", strings.NewReader(`{"enabled":false}`)))
	if rec.Code != http.StatusOK || s.FourTasksEnabled() {
		t.Fatalf("disable schedule: status=%d enabled=%v body=%s", rec.Code, s.FourTasksEnabled(), rec.Body.String())
	}

	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/tasks/schedule", strings.NewReader(`{"enabled":true}`)))
	if rec.Code != http.StatusOK || !s.FourTasksEnabled() {
		t.Fatalf("enable schedule: status=%d enabled=%v body=%s", rec.Code, s.FourTasksEnabled(), rec.Body.String())
	}

	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/tasks/schedule", strings.NewReader(`{"enabled":"no"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid schedule body: status=%d body=%s", rec.Code, rec.Body.String())
	}
}
