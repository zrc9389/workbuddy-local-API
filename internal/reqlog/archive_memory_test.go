package reqlog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeEvents(t *testing.T, path string, events []Event) int64 {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var size int64
	enc := json.NewEncoder(f)
	for _, e := range events {
		if err := enc.Encode(e); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(e)
		size += int64(len(raw)) + 1
	}
	return size
}

// Reading a large archive must retain only the requested window, not every event.
func TestReadArchiveRetainsOnlyRequestedWindow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-bulk.jsonl")
	base := time.Now().Add(-time.Hour)
	const total = 20000
	events := make([]Event, 0, total)
	for i := 0; i < total; i++ {
		events = append(events, Event{
			Time: base.Add(time.Duration(i) * time.Millisecond), RequestID: "r" + strings.Repeat("x", 8),
			Status: 200, OK: true, Outcome: OutcomeSuccess, Model: "m",
		})
	}
	writeEvents(t, path, events)

	r := New(Config{Enabled: true, Dir: dir})
	defer r.Close()
	rows, err := r.ReadArchive(25, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 25 {
		t.Fatalf("rows = %d, want 25", len(rows))
	}
	for i := 1; i < len(rows); i++ {
		if rows[i].Time.After(rows[i-1].Time) {
			t.Fatalf("rows not newest-first at %d", i)
		}
	}
	if got := rows[0].Time; got.Before(base.Add(time.Duration(total-1) * time.Millisecond)) {
		t.Fatalf("newest row not retained: %v", got)
	}
}

// refreshUsage and pruneErrors must stream, and must agree with a full recount.
func TestRefreshUsageAndPruneStreamMatchOnDisk(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	path := filepath.Join(dir, "requests-2026-10-01.jsonl")
	events := []Event{
		{Time: now.Add(-2 * time.Hour), RequestID: "keep-1", Status: 500, Outcome: OutcomeHTTPError},
		{Time: now.Add(-25 * time.Hour), RequestID: "expired", Status: 502, Outcome: OutcomeHTTPError},
		{Time: now.Add(-time.Hour), RequestID: "keep-2", Status: 429, Outcome: OutcomeHTTPError},
		{Time: now.Add(-time.Hour), RequestID: "legacy-ok", Status: 200, OK: true, Outcome: OutcomeSuccess},
	}
	writeEvents(t, path, events)

	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	if err := r.archive.refreshUsage(); err != nil {
		t.Fatal(err)
	}
	// New() already ran a startup prune, so expired rows are gone by now.
	if r.archive.count != 2 {
		t.Fatalf("count = %d, want 2 persisted rows", r.archive.count)
	}
	if err := r.archive.pruneErrors(); err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var kept []Event
	for _, line := range splitLines(body) {
		var e Event
		if err := json.Unmarshal(line, &e); err != nil {
			t.Fatalf("pruned file has invalid JSON: %v", err)
		}
		kept = append(kept, e)
	}
	if len(kept) != 2 || r.archive.count != 2 {
		t.Fatalf("kept=%d count=%d, want 2/2", len(kept), r.archive.count)
	}
	if r.archive.total != int64(len(body)) {
		t.Fatalf("total = %d, want %d", r.archive.total, len(body))
	}
	for _, e := range kept {
		if e.RequestID == "expired" || e.RequestID == "legacy-ok" {
			t.Fatalf("row should have been pruned: %+v", e)
		}
	}
}

// Oversized legacy rows must be skipped, not make the whole archive unreadable.
func TestArchiveSkipsOversizedLineAndKeepsScanning(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-oversize.jsonl")
	now := time.Now()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	good, _ := json.Marshal(Event{Time: now, RequestID: "good", Status: 500, Outcome: OutcomeHTTPError})
	if _, err := f.WriteString(strings.Repeat("x", maxArchiveLineBytes+64) + "\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write(good); err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("\n"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	defer r.Close()
	rows, err := r.ReadArchive(10, Filter{})
	if err != nil {
		t.Fatalf("oversized row must not fail the scan: %v", err)
	}
	if len(rows) != 1 || rows[0].RequestID != "good" {
		t.Fatalf("rows = %+v, want only good", rows)
	}
}

// no_logs semantics: an archive that never wrote a file must stay empty and
// must not create one while scanning.
func TestReadArchiveWithoutWrittenFileStaysEmpty(t *testing.T) {
	dir := t.TempDir()
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	defer r.Close()
	rows, err := r.ReadArchive(10, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows = %+v, want empty", rows)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("read-only scan created files: %v", entries)
	}
	disabled := New(Config{Enabled: false, Dir: dir})
	defer disabled.Close()
	if rows, err := disabled.ReadArchive(10, Filter{}); err != nil || rows != nil {
		t.Fatalf("disabled archive = %v, %v; want nil, nil", rows, err)
	}
}
