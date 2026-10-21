package conversation

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestDurableHistorySurvivesCacheEvictionAndTTL(t *testing.T) {
	p := filepath.Join(t.TempDir(), "h.json")
	o := Options{Path: p, MaxEntries: 1, MaxBytes: 1024, TTL: time.Millisecond}
	s, _ := Open(o)
	s.Put("a", json.RawMessage(`["original"]`))
	s.Put("b", json.RawMessage(`["second"]`))
	time.Sleep(3 * time.Millisecond)
	if raw, ok := s.Get("a"); !ok || string(raw) != `["original"]` {
		t.Fatal("cache eviction deleted durable memory")
	}
	s2, e := Open(o)
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := s2.Get("b"); !ok {
		t.Fatal("restart history loss")
	}
}

func TestPressureReclaimsOnlyDurableCache(t *testing.T) {
	s, _ := Open(Options{Path: filepath.Join(t.TempDir(), "h.json")})
	s.Put("x", json.RawMessage(`["retained"]`))
	if s.ReclaimCache() == 0 || s.Stats().Entries != 0 {
		t.Fatal("cache not reclaimed")
	}
	if raw, ok := s.Get("x"); !ok || string(raw) != `["retained"]` {
		t.Fatal("pressure deleted durable context")
	}
	volatile, _ := Open(Options{})
	volatile.Put("x", json.RawMessage(`[]`))
	if volatile.ReclaimCache() != 0 {
		t.Fatal("volatile history discarded")
	}
	if _, ok := volatile.Get("x"); !ok {
		t.Fatal("volatile lost")
	}
}
