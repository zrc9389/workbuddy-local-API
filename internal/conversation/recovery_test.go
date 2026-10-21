package conversation

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNullHistoryIsEmpty(t *testing.T) {
	p := filepath.Join(t.TempDir(), "history.json")
	os.WriteFile(p, []byte("null"), 0600)
	s, e := Open(Options{Path: p})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Put("x", json.RawMessage(`[]`)); e != nil {
		t.Fatal(e)
	}
}
func TestPersistenceFailureDoesNotCommit(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "history.json")
	s, _ := Open(Options{Path: p, MaxEntries: 1})
	s.Put("old", json.RawMessage(`[]`))
	os.Mkdir(s.file("new")+".tmp", 0700)
	if e := s.Put("new", json.RawMessage(`[]`)); e == nil {
		t.Fatal("expected write failure")
	}
	if _, ok := s.Get("old"); !ok {
		t.Fatal("failed transaction evicted old history")
	}
	if _, ok := s.Get("new"); ok {
		t.Fatal("failed history write committed")
	}
	os.Mkdir(p+".tmp", 0700)
	if e := s.Clear(); e == nil {
		t.Fatal("expected clear failure")
	}
	if s.Stats().Entries != 1 {
		t.Fatal("failed clear changed memory")
	}
}
func TestCorruptHistoryRejected(t *testing.T) {
	for _, data := range []string{`{} {}`, `{"":{"value":[],"used":1,"expires":"2999-01-01T00:00:00Z"}}`} {
		p := filepath.Join(t.TempDir(), "history.json")
		os.WriteFile(p, []byte(data), 0600)
		if _, e := Open(Options{Path: p}); e == nil {
			t.Fatal("accepted corrupt history", data)
		}
	}
}

func TestShrinkHistoryBudgetAndHTMLRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "history.json")
	s, _ := Open(Options{Path: p, MaxBytes: 4 << 20})
	raw, _ := json.Marshal(strings.Repeat("a", 3500000))
	if e := s.Put("old", raw); e != nil {
		t.Fatal(e)
	}
	small, e := Open(Options{Path: p, MaxBytes: 1 << 20})
	if e != nil {
		t.Fatal("shrinking budget prevents startup", e)
	}
	if small.Stats().Bytes > 1<<20 {
		t.Fatal("new budget ignored")
	}
	raw = json.RawMessage(`"` + strings.Repeat("<", 600000) + `"`)
	if e = small.Put("html", raw); e != nil {
		t.Fatal(e)
	}
	if _, e = Open(Options{Path: p, MaxBytes: 1 << 20}); e != nil {
		t.Fatal("writer output cannot be read", e)
	}
}
