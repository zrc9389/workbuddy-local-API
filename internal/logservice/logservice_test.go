//go:build !no_logs

package logservice

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/reqlog"
)

func TestNewKeepsOnlyErrorsAndCapsReadWindow(t *testing.T) {
	dir := t.TempDir()
	sink := New(true, Config{Dir: dir, Archive: true})
	sink.Record(reqlog.Event{Time: time.Now(), RequestID: "ok", Status: 200, OK: true, Outcome: reqlog.OutcomeSuccess})
	sink.Record(reqlog.Event{Time: time.Now(), RequestID: "quota", Status: 429, Outcome: reqlog.OutcomeHTTPError, Model: "m"})
	sink.Close()

	snapshot := sink.Snapshot()
	if snapshot.Completed != 2 || snapshot.Succeeded != 1 || snapshot.Failed != 1 {
		t.Fatalf("aggregate = %+v", snapshot)
	}
	if len(snapshot.Recent) != 1 || snapshot.Recent[0].RequestID != "quota" {
		t.Fatalf("recent = %+v", snapshot.Recent)
	}
	rows, err := sink.ReadArchive(100, reqlog.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].RequestID != "quota" {
		t.Fatalf("rows = %+v, want only quota", rows)
	}

	expired := reqlog.Event{Time: time.Now().Add(-25 * time.Hour), RequestID: "expired", Status: 500, Outcome: reqlog.OutcomeHTTPError}
	raw, err := json.Marshal(expired)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "requests-expired.jsonl"), append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	reopened := New(true, Config{Dir: dir, Archive: true})
	defer reopened.Close()
	rows, err = reopened.ReadArchive(100, reqlog.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].RequestID != "quota" {
		t.Fatalf("rows after reopen = %+v, want quota only", rows)
	}
}

func TestNewDisabledIsNoop(t *testing.T) {
	sink := New(false, Config{Dir: filepath.Join(t.TempDir(), "unused"), Archive: true})
	sink.Record(reqlog.Event{Status: 500})
	if got := sink.Snapshot(); got.Completed != 0 || len(got.Recent) != 0 || got.Archive.Enabled {
		t.Fatalf("snapshot = %+v", got)
	}
}
