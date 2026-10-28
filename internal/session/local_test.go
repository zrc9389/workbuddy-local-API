package session

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalBindPersistenceBounded(t *testing.T) {
	p := filepath.Join(t.TempDir(), "binds.json")
	cfg := Config{LocalPath: p, MaxEntries: 2, TTL: time.Hour, Available: func() []string { return []string{"u1", "u2"} }}
	r := New(cfg)
	r.Bind("a", "u1")
	time.Sleep(time.Millisecond)
	r.Bind("b", "u2")
	time.Sleep(time.Millisecond)
	r.Bind("c", "u1")
	if r.Count() != 2 {
		t.Fatal("unbounded bindings")
	}
	if err := r.FlushLocal(); err != nil {
		t.Fatal(err)
	}
	r2 := New(cfg)
	if err := r2.LoadLocal(); err != nil {
		t.Fatal(err)
	}
	if r2.Count() != 2 {
		t.Fatal("lost binds")
	}
	if uid, ok := r2.Resolve("b"); !ok || uid != "u2" {
		t.Fatal(uid, ok)
	}
}

func TestLongestAcceptedBindingsRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "bindings.json")
	cfg := Config{LocalPath: p, MaxEntries: 4096, TTL: time.Hour}
	r := New(cfg)
	for i := 0; i < 4096; i++ {
		r.Bind(fmt.Sprintf("%04d", i)+strings.Repeat("a", 2044), "u")
	}
	if e := r.FlushLocal(); e != nil {
		t.Fatal(e)
	}
	r2 := New(cfg)
	if e := r2.LoadLocal(); e != nil {
		t.Fatal(e)
	}
	if r2.Count() != 4096 {
		t.Fatal(r2.Count())
	}
}

func TestDeleteAccountRemovesBindingsAndPersists(t *testing.T) {
	p := filepath.Join(t.TempDir(), "bindings.json")
	r := New(Config{LocalPath: p, MaxEntries: 10, TTL: time.Hour, Available: func() []string { return []string{"u1", "u2"} }})
	r.Bind("a", "u1")
	r.Bind("b", "u2")
	if err := r.DeleteAccount("u1"); err != nil {
		t.Fatal(err)
	}
	r.mu.RLock()
	_, ok := r.entries["a"]
	r.mu.RUnlock()
	if ok {
		t.Fatal("deleted binding remains")
	}
	r2 := New(Config{LocalPath: p, MaxEntries: 10, TTL: time.Hour, Available: func() []string { return []string{"u1", "u2"} }})
	if err := r2.LoadLocal(); err != nil {
		t.Fatal(err)
	}
	r2.mu.RLock()
	_, ok = r2.entries["a"]
	r2.mu.RUnlock()
	if ok {
		t.Fatal("deleted binding persisted")
	}
	if uid, ok := r2.Resolve("b"); !ok || uid != "u2" {
		t.Fatalf("other binding=%q %v", uid, ok)
	}
}
