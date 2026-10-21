package reqlog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestErrorsOnlyKeepsFailuresButStillCountsSuccess(t *testing.T) {
	dir := t.TempDir()
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	r.Record(Event{Time: time.Now(), RequestID: "ok", Status: 200, OK: true, Outcome: OutcomeSuccess, Model: "m"})
	r.Record(Event{Time: time.Now(), RequestID: "quota", Status: 429, Outcome: OutcomeHTTPError, Model: "m"})
	r.Record(Event{Time: time.Now(), RequestID: "server", Status: 502, Outcome: OutcomeHTTPError, Model: "m"})
	r.Record(Event{Time: time.Now(), RequestID: "stream", Status: 503, Outcome: OutcomeStreamError, Model: "m"})
	r.Record(Event{Time: time.Now(), RequestID: "interrupted", Outcome: OutcomeInterrupted, Model: "m"})
	r.Close()

	s := r.Snapshot()
	if s.Completed != 5 || s.Succeeded != 1 || s.Failed != 4 {
		t.Fatalf("aggregate = completed:%d succeeded:%d failed:%d", s.Completed, s.Succeeded, s.Failed)
	}
	ids := make(map[string]bool)
	for _, e := range s.Recent {
		ids[e.RequestID] = true
	}
	if ids["ok"] || !ids["quota"] || !ids["server"] || !ids["stream"] || !ids["interrupted"] || len(s.Recent) != 4 {
		t.Fatalf("recent = %+v", s.Recent)
	}
	rows, err := r.ReadArchive(100, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("archive rows = %d, want 4", len(rows))
	}
	for _, e := range rows {
		if !isError(&e) {
			t.Fatalf("success archived: %+v", e)
		}
	}
}

func TestErrorsOnlyReadWindowIs24Hours(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-2026-10-01.jsonl")
	old := Event{Time: time.Now().Add(-25 * time.Hour), RequestID: "old", Status: 500, Outcome: OutcomeHTTPError}
	recent := Event{Time: time.Now().Add(-23 * time.Hour), RequestID: "recent", Status: 500, Outcome: OutcomeHTTPError}
	var body []byte
	for _, e := range []Event{old, recent} {
		raw, _ := json.Marshal(e)
		body = append(body, raw...)
		body = append(body, '\n')
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	defer r.Close()
	rows, err := r.ReadArchive(10, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].RequestID != "recent" {
		t.Fatalf("rows = %+v, want only recent", rows)
	}
}

func TestErrorsOnlyCapsEventCountAndScansExistingFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-2026-10-01.jsonl")
	var body []byte
	base := time.Now().Add(-time.Hour)
	for i := 0; i < 6; i++ {
		e := Event{Time: base.Add(time.Duration(i) * time.Second), RequestID: "old-" + string(rune('a'+i)), Status: 500, Outcome: OutcomeHTTPError, Model: "m"}
		raw, _ := json.Marshal(e)
		body = append(body, raw...)
		body = append(body, '\n')
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir, MaxEvents: 3, FileMaxBytes: 1 << 20})
	r.Record(Event{Time: time.Now(), RequestID: "new", Status: 502, Outcome: OutcomeHTTPError})
	r.Record(Event{Time: time.Now(), RequestID: "new2", Status: 503, Outcome: OutcomeHTTPError})
	r.Close()

	s := r.Snapshot()
	if s.Archive.DroppedWrites != 0 {
		t.Fatalf("dropped = %d", s.Archive.DroppedWrites)
	}
	rows, err := r.ReadArchive(100, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3 (%+v)", len(rows), rows)
	}
	left, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	for _, line := range splitLines(left) {
		var e Event
		if json.Unmarshal(line, &e) == nil {
			count++
		}
	}
	if count > 3 {
		t.Fatalf("on-disk errors = %d, want <= 3", count)
	}
}

func TestErrorsOnlyCapsEventAndTotalBytes(t *testing.T) {
	dir := t.TempDir()
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir, MaxEventBytes: 160, MaxBytes: 340, FileMaxBytes: 1024})
	for i := 0; i < 10; i++ {
		r.Record(Event{Time: time.Now(), RequestID: "evt-" + string(rune('a'+i)), Status: 500,
			Outcome: OutcomeHTTPError, Model: "model", UserAgent: "some-agent"})
	}
	r.Close()
	rows, err := r.ReadArchive(100, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	var total int64
	for _, e := range entries {
		info, _ := e.Info()
		total += info.Size()
	}
	if total > 340 {
		t.Fatalf("archive bytes = %d, want <= 340", total)
	}
	if len(rows) > 2 {
		t.Fatalf("rows = %d, want <= 2 within total capacity", len(rows))
	}
}

func TestErrorsOnlyReadRejectsLegacySuccessRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-2026-10-01.jsonl")
	ok := Event{Time: time.Now(), RequestID: "legacy-ok", OK: true, Status: 200, Outcome: OutcomeSuccess}
	fail := Event{Time: time.Now(), RequestID: "legacy-fail", Status: 500, Outcome: OutcomeHTTPError}
	var body []byte
	for _, e := range []Event{ok, fail} {
		raw, _ := json.Marshal(e)
		body = append(body, raw...)
		body = append(body, '\n')
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	r.Close()
	rows, err := r.ReadArchive(10, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].RequestID != "legacy-fail" {
		t.Fatalf("rows = %+v", rows)
	}
}

func splitLines(body []byte) [][]byte {
	var out [][]byte
	start := 0
	for i, b := range body {
		if b == '\n' {
			if i > start {
				out = append(out, body[start:i])
			}
			start = i + 1
		}
	}
	if start < len(body) {
		out = append(out, body[start:])
	}
	return out
}

func TestErrorsOnlyPruneUsesEventTimeAndDropsLegacySuccess(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	oldPath := filepath.Join(dir, "requests-now.jsonl")
	newPath := filepath.Join(dir, "requests-old.jsonl")
	var oldBody, newBody []byte
	for _, e := range []Event{
		{Time: now.Add(-25 * time.Hour), RequestID: "expired", Status: 500, Outcome: OutcomeHTTPError},
		{Time: now.Add(-time.Minute), RequestID: "legacy-ok", Status: 200, OK: true, Outcome: OutcomeSuccess},
	} {
		raw, _ := json.Marshal(e)
		oldBody = append(oldBody, raw...)
		oldBody = append(oldBody, '\n')
	}
	recent := Event{Time: now.Add(-time.Hour), RequestID: "keep", Status: 502, Outcome: OutcomeHTTPError}
	raw, _ := json.Marshal(recent)
	newBody = append(newBody, raw...)
	newBody = append(newBody, '\n')
	if err := os.WriteFile(oldPath, oldBody, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newPath, newBody, 0o600); err != nil {
		t.Fatal(err)
	}
	// 反向设置 mtime：旧事件所在文件是新的，保留事件所在文件是旧的。
	if err := os.Chtimes(oldPath, now, now); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newPath, now.Add(-10*24*time.Hour), now.Add(-10*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	if err := r.archive.pruneErrors(); err != nil {
		t.Fatal(err)
	}
	r.Close()
	rows, err := r.ReadArchive(100, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].RequestID != "keep" {
		t.Fatalf("rows = %+v, want only keep", rows)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatalf("expired-only file should be removed, stat err = %v", err)
	}
}

func TestErrorsOnlySnapshotDropsExpiredMemoryEvents(t *testing.T) {
	r := New(Config{ErrorsOnly: true})
	r.Record(Event{Time: time.Now().Add(-25 * time.Hour), RequestID: "expired", Status: 500, Outcome: OutcomeHTTPError})
	r.Record(Event{Time: time.Now(), RequestID: "fresh", Status: 500, Outcome: OutcomeHTTPError})
	s := r.Snapshot()
	if len(s.Recent) != 1 || s.Recent[0].RequestID != "fresh" {
		t.Fatalf("recent = %+v, want only fresh", s.Recent)
	}
	if s.Completed != 2 || s.Failed != 2 {
		t.Fatalf("aggregate = %+v", s)
	}
}

func TestErrorsOnlyOversizedEventIsNotListedInMemory(t *testing.T) {
	r := New(Config{ErrorsOnly: true, MaxEventBytes: 160})
	r.Record(Event{Time: time.Now(), RequestID: "tiny", Status: 500, Outcome: OutcomeHTTPError})
	r.Record(Event{Time: time.Now(), RequestID: "huge", Status: 500, Outcome: OutcomeHTTPError, UserAgent: strings.Repeat("x", 400)})
	s := r.Snapshot()
	if len(s.Recent) != 1 || s.Recent[0].RequestID != "tiny" {
		t.Fatalf("recent = %+v, want only tiny", s.Recent)
	}
	if s.Completed != 2 || s.Failed != 2 {
		t.Fatalf("aggregate = %+v", s)
	}
}

func TestEventIDIsStableAndOpaque(t *testing.T) {
	e := Event{Time: time.Unix(1700000000, 123).UTC(), RequestID: "req-secret", Account: "acct-secret",
		ClientIP: "203.0.113.9", UserAgent: "agent-secret", Status: 502, Outcome: OutcomeHTTPError, Model: "m", DurationMs: 12}
	id := EventID(e)
	if len(id) != 32 {
		t.Fatalf("id = %q, want 32 hex chars", id)
	}
	if id != EventID(e) {
		t.Fatal("id must be stable for the same event")
	}
	if strings.Contains(id, "req-secret") || strings.Contains(id, "acct-secret") {
		t.Fatalf("id leaks identifying fields: %s", id)
	}
	e.Model = "other"
	if EventID(e) == id {
		t.Fatal("different events should not collide")
	}
}

func TestFindArchiveAndRecentByStableID(t *testing.T) {
	dir := t.TempDir()
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	now := time.Now()
	ok := Event{Time: now, RequestID: "ok", Status: 200, OK: true, Outcome: OutcomeSuccess}
	fail := Event{Time: now, RequestID: "fail", Status: 500, Outcome: OutcomeHTTPError, Model: "m"}
	r.Record(ok)
	r.Record(fail)
	r.Close()

	id := EventID(fail)
	got, err := r.FindArchive(id)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.RequestID != "fail" {
		t.Fatalf("find archive = %+v", got)
	}
	if another, err := r.FindArchive(EventID(ok)); err != nil || another != nil {
		t.Fatalf("success row should not be findable: %+v err=%v", another, err)
	}
	if recent := r.FindRecent(id); recent == nil || recent.RequestID != "fail" {
		t.Fatalf("find recent = %+v", recent)
	}

	mem := New(Config{ErrorsOnly: true})
	mem.Record(fail)
	if recent := mem.FindRecent(EventID(fail)); recent == nil {
		t.Fatal("memory-only recorder should locate by id")
	}
	if mem.FindRecent("missing") != nil {
		t.Fatal("missing id should return nil")
	}
}
