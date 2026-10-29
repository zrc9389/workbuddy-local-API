package reqlog

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestErrorArchiveCleanupAtEventDeadline(t *testing.T) {
	dir := t.TempDir()
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	defer r.Close()
	deadline := time.Now().Add(1200 * time.Millisecond)
	r.Record(Event{Time: deadline.Add(-errorRetention), Status: 500, Outcome: OutcomeHTTPError})
	time.Sleep(500 * time.Millisecond)
	files, _ := filepath.Glob(filepath.Join(dir, "requests-*.jsonl"))
	if len(files) != 1 {
		t.Fatalf("expected fresh record, files=%v", files)
	}
	limit := time.Now().Add(4 * time.Second)
	for time.Now().Before(limit) {
		files, _ = filepath.Glob(filepath.Join(dir, "requests-*.jsonl"))
		if len(files) == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	data, _ := os.ReadFile(files[0])
	t.Fatalf("expired event still on disk: %q", data)
}

func TestUnknownFieldsWithValidTimeExpireAtDeadline(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-legacy.jsonl")
	at := time.Now().Add(-errorRetention + 1200*time.Millisecond).UTC().Format(time.RFC3339Nano)
	if err := os.WriteFile(path, []byte(fmt.Sprintf("{\"time\":%q,\"future_field\":true}\n", at)), 0600); err != nil {
		t.Fatal(err)
	}
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	defer r.Close()
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	limit := time.Now().Add(4 * time.Second)
	for time.Now().Before(limit) {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timestamped legacy record survived its retention deadline")
}

func TestPeriodicPruneRunsDespiteFrequentFlush(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-legacy.jsonl")
	if err := os.WriteFile(path, []byte("{\"time\":\"2020-01-01T00:00:00Z\",\"status\":500}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	w := &archiveWriter{cfg: normalizeConfig(Config{Enabled: true, ErrorsOnly: true, Dir: dir}), ch: make(chan Event), stop: make(chan struct{}), done: make(chan struct{})}
	go w.runWithIntervals(10*time.Millisecond, 100*time.Millisecond)
	defer func() { close(w.stop); <-w.done }()
	limit := time.Now().Add(time.Second)
	for time.Now().Before(limit) {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("periodic pruning was starved by flush timer")
}

func TestExpiredRecordWithUnknownFieldsIsRemoved(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "requests-legacy.jsonl")
	original := []byte("{\"time\":\"2020-01-01T00:00:00Z\",\"status\":500,\"outcome\":\"http_error\",\"future_field\":true}\n")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	r := New(Config{Enabled: true, ErrorsOnly: true, Dir: dir})
	r.Close()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expired record with valid timestamp remains: %v", err)
	}
}
