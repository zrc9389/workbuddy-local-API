package spool

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOversizeAndDiskFailurePreserveAdmission(t *testing.T) {
	s, _ := Open(Options{Dir: filepath.Join(t.TempDir(), "spool"), MaxBytes: 64, MaxJobs: 2})
	if _, e := s.Stage(context.Background(), strings.NewReader(strings.Repeat("x", 17)), 16); e == nil {
		t.Fatal("oversize silently truncated")
	}
	if s.Stats().Jobs != 0 || s.Stats().Bytes != 0 {
		t.Fatal("oversize leaked capacity")
	}
	if _, e := s.Stage(context.Background(), strings.NewReader("x"), 65); e == nil {
		t.Fatal("disk capacity ignored")
	}
	if s.Stats().Jobs != 0 {
		t.Fatal("full queue mutated")
	}
	blocked := filepath.Join(t.TempDir(), "not-dir")
	os.WriteFile(blocked, []byte("preserve"), 0600)
	if _, e := Open(Options{Dir: blocked}); e == nil {
		t.Fatal("invalid disk store accepted")
	}
	b, _ := os.ReadFile(blocked)
	if string(b) != "preserve" {
		t.Fatal("disk error overwrote existing data")
	}
}
