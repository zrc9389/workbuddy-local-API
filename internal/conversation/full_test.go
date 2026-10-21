package conversation

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestArchiveFullRejectsWithoutDeletingOldHistory(t *testing.T) {
	s, e := Open(Options{Path: filepath.Join(t.TempDir(), "archive.json"), MaxBytes: 1024, MaxEntries: 1})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Put("old", json.RawMessage(`["retained"]`)); e != nil {
		t.Fatal(e)
	}
	s.totalDiskBytes = maxArchiveBytes
	if e = s.Put("new", json.RawMessage(`[]`)); e == nil {
		t.Fatal("disk cap ignored")
	}
	if raw, ok := s.Get("old"); !ok || string(raw) != `["retained"]` {
		t.Fatal("full disk erased archive")
	}
}
