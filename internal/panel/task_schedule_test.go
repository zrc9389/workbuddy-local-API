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

func TestTasksScheduleControlsAllSevenSwitchesAndGranularOverrides(t *testing.T) {
	s := scheduler.New(scheduler.Config{Pool: pool.New("")})
	var lastPatch map[string]bool
	p := New(Config{Pool: pool.New(""), Scheduler: s, SaveConfig: func(raw []byte) ([]string, error) {
		var patch map[string]map[string]bool
		if err := json.Unmarshal(raw, &patch); err != nil {
			return nil, err
		}
		lastPatch = patch["schedule"]
		cur := s.ScheduleStatus()
		for k, v := range lastPatch {
			cur[k] = v
		}
		s.Reconfigure(nil, nil, nil, nil, nil, nil,
			!cur["checkin_enabled"], !cur["travel_enabled"], !cur["activity_enabled"],
			!cur["keepalive_enabled"], !cur["blackcat_enabled"], !cur["growth_enabled"])
		if cur["balance_refresh_enabled"] {
			s.SetBalanceInterval(300_000_000_000)
		} else {
			s.SetBalanceInterval(0)
		}
		return nil, nil
	}})

	// 1. Master enabled=true toggles all 7 switches
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/tasks/schedule", strings.NewReader(`{"enabled":true}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	for _, k := range []string{"checkin_enabled", "travel_enabled", "activity_enabled", "keepalive_enabled", "blackcat_enabled", "growth_enabled", "balance_refresh_enabled"} {
		if !lastPatch[k] {
			t.Fatalf("expected master enabled=true to set %s=true, got %+v", k, lastPatch)
		}
	}
	var resp struct {
		Enabled    bool            `json:"enabled"`
		AllEnabled bool            `json:"all_enabled"`
		Schedules  map[string]bool `json:"schedules"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Enabled || !resp.AllEnabled || !resp.Schedules["balance_refresh_enabled"] || !resp.Schedules["blackcat_enabled"] || !resp.Schedules["growth_enabled"] {
		t.Fatalf("unexpected schedules response: %+v", resp)
	}

	// 2. Granular override without master enabled
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/tasks/schedule", strings.NewReader(`{"blackcat_enabled":false,"balance_refresh_enabled":false}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on granular override, got %d: %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.AllEnabled || resp.Schedules["blackcat_enabled"] || resp.Schedules["balance_refresh_enabled"] || !resp.Schedules["checkin_enabled"] {
		t.Fatalf("unexpected granular override state: %+v", resp)
	}
}
