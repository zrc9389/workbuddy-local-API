package conversation

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreBudgetsPersistenceAndLRU(t *testing.T) {
	p := filepath.Join(t.TempDir(), "history.json")
	o := Options{Path: p, MaxEntries: 2, MaxBytes: 1024, TTL: time.Hour}
	s, e := Open(o)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Put("a", json.RawMessage(`[{"role":"user","content":"a"}]`)); e != nil {
		t.Fatal(e)
	}
	s.Put("b", json.RawMessage(`[]`))
	s.Get("a")
	s.Put("c", json.RawMessage(`[]`))
	if _, ok := s.items["b"]; ok {
		t.Fatal("not LRU")
	}
	s2, e := Open(o)
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := s2.Get("a"); !ok {
		t.Fatal("restart lost history")
	}
	if e = s2.Put("large", make([]byte, 2048)); e == nil {
		t.Fatal("oversize accepted")
	}
	if e = s2.Clear(); e != nil {
		t.Fatal(e)
	}
	s3, _ := Open(o)
	if s3.Stats().Entries != 0 {
		t.Fatal("clear not persistent")
	}
}
func TestExpirationAndCopy(t *testing.T) {
	s, _ := Open(Options{MaxEntries: 3, MaxBytes: 1024, TTL: time.Millisecond})
	s.Put("a", json.RawMessage(`[1]`))
	time.Sleep(3 * time.Millisecond)
	if _, ok := s.Get("a"); ok {
		t.Fatal("expired exists")
	}
	if s.Stats().Bytes != 0 {
		t.Fatal("expired bytes retained")
	}
}
