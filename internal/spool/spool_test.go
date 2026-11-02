package spool

import (
	"context"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpoolLimitsAndChecksums(t *testing.T) {
	s, e := Open(Options{Dir: filepath.Join(t.TempDir(), "spool"), MaxBytes: 32, MaxJobs: 1})
	if e != nil {
		t.Fatal(e)
	}
	j, e := s.Stage(context.Background(), strings.NewReader("exact body"), 16)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Stage(context.Background(), strings.NewReader("extra"), 16); e == nil {
		t.Fatal("unbounded queue")
	}
	r, e := j.Open()
	if e != nil {
		t.Fatal(e)
	}
	b, _ := io.ReadAll(r)
	r.Close()
	if string(b) != "exact body" {
		t.Fatal("changed")
	}
	if e = j.Mark("dispatch_intent"); e != nil {
		t.Fatal(e)
	}
	if e = j.Complete("committed"); e != nil {
		t.Fatal(e)
	}
	s2, e := Open(Options{Dir: s.opts.Dir, MaxBytes: 32, MaxJobs: 1})
	if e != nil {
		t.Fatal(e)
	}
	if s2.Stats().Unknown != 0 {
		t.Fatal("completed is uncertain")
	}
}
func TestRecoveryNeverAutoDispatches(t *testing.T) {
	o := Options{Dir: filepath.Join(t.TempDir(), "s"), MaxBytes: 100, MaxJobs: 2}
	s, _ := Open(o)
	j, _ := s.Stage(context.Background(), strings.NewReader("hello"), 20)
	j.Mark("dispatch_intent")
	s2, e := Open(o)
	if e != nil {
		t.Fatal(e)
	}
	if s2.Stats().Unknown != 1 {
		t.Fatal(s2.Stats())
	}
}

func TestSpoolCompleteUnknownReclaimsQuota(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "spool_reclaim")
	s, err := Open(Options{Dir: dir, MaxBytes: 1024, MaxJobs: 1})
	if err != nil {
		t.Fatal(err)
	}

	// 1. Stage a job
	j, err := s.Stage(context.Background(), strings.NewReader("sample request payload"), 50)
	if err != nil {
		t.Fatal(err)
	}

	// 2. Open and verify
	r, err := j.Open()
	if err != nil {
		t.Fatal(err)
	}
	r.Close()

	// Open a second time to exercise verified flag
	r2, err := j.Open()
	if err != nil {
		t.Fatal(err)
	}
	r2.Close()

	// 3. Complete with "unknown" (simulating cleanup on failure)
	if err := j.Complete("unknown"); err != nil {
		t.Fatalf("Complete(unknown): %v", err)
	}

	// 4. Verify quota has been returned: staging another job with MaxJobs=1 must succeed
	j2, err := s.Stage(context.Background(), strings.NewReader("second request payload"), 50)
	if err != nil {
		t.Fatalf("failed to stage second job after unknown completion: %v", err)
	}
	_ = j2.Complete("cancelled")
}
