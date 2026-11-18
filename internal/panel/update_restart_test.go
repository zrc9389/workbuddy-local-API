package panel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestUpdateApplyRestartServiceStatus(t *testing.T) {
	newPanelWithRestart := func(restartFn func() error) *Panel {
		p := New(Config{
			Pool: pool.New(""),
			UpdateChecker: func(context.Context) (UpdateResult, error) {
				return UpdateResult{
					CurrentVersion: "3.0.2",
					LatestVersion:  "3.0.3",
					HasUpdate:      true,
					Artifact:       &UpdateArtifact{Name: "wb2api", URL: "https://example.test/wb2api", SHA256: strings.Repeat("a", 64), Verified: true},
				}, nil
			},
			UpdateApplier: func(context.Context, UpdateArtifact) error {
				return nil
			},
			RestartService: restartFn,
		})
		// Populate verified artifact via /panel/api/update/check
		checkRec := httptest.NewRecorder()
		p.ServeHTTP(checkRec, httptest.NewRequest(http.MethodPost, "/panel/api/update/check", strings.NewReader("{}")))
		if checkRec.Code != http.StatusOK {
			t.Fatalf("check failed: %d %s", checkRec.Code, checkRec.Body.String())
		}
		return p
	}

	// Case 1: RestartService configured and succeeds -> 202 {"ok": true, "status": "restarting"}
	var restarted bool
	p1 := newPanelWithRestart(func() error {
		restarted = true
		return nil
	})
	rec := httptest.NewRecorder()
	p1.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/update/apply", strings.NewReader("{}")))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if !restarted || resp["ok"] != true || resp["status"] != "restarting" {
		t.Fatalf("unexpected restarting response: restarted=%v resp=%v", restarted, resp)
	}

	// Case 2: RestartService nil -> backward compatible 202 {"ok": true, "status": "restart_required"}
	p2 := newPanelWithRestart(nil)
	rec2 := httptest.NewRecorder()
	p2.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/panel/api/update/apply", strings.NewReader("{}")))
	if rec2.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec2.Code, rec2.Body.String())
	}
	var resp2 map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &resp2)
	if resp2["ok"] != true || resp2["status"] != "restart_required" {
		t.Fatalf("unexpected restart_required response: %v", resp2)
	}

	// Case 3: RestartService fails -> 502 restart_failed
	p3 := newPanelWithRestart(func() error { return errors.New("boom") })
	rec3 := httptest.NewRecorder()
	p3.ServeHTTP(rec3, httptest.NewRequest(http.MethodPost, "/panel/api/update/apply", strings.NewReader("{}")))
	if rec3.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rec3.Code, rec3.Body.String())
	}
	var resp3 map[string]any
	_ = json.Unmarshal(rec3.Body.Bytes(), &resp3)
	if resp3["ok"] != false || resp3["code"] != "restart_failed" {
		t.Fatalf("unexpected restart_failed response: %v", resp3)
	}
}
