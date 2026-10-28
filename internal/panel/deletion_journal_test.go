package panel

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDeletionCoordinatorResumesAfterFailedStage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "deletions.json")
	c, err := newDeletionCoordinator(path)
	if err != nil {
		t.Fatal(err)
	}
	called := 0
	stages := []deletionStage{
		{Name: "freeze", Run: func() error { called++; return nil }},
		{Name: "credential", Run: func() error { called++; return errors.New("temporary") }},
		{Name: "pool", Run: func() error { called++; return nil }},
	}
	if _, err := c.execute("uid-1", "/tmp/auth.json", stages); err == nil {
		t.Fatal("expected stage failure")
	}
	if called != 2 {
		t.Fatalf("called=%d want 2", called)
	}
	pending := c.pending()
	if len(pending) != 1 || pending[0].Phase != "credential" || pending[0].Error != "stage failed" {
		t.Fatalf("pending=%+v", pending)
	}
	c2, err := newDeletionCoordinator(path)
	if err != nil {
		t.Fatal(err)
	}
	resumed := []deletionStage{
		{Name: "freeze", Run: func() error { t.Fatal("freeze must not rerun"); return nil }},
		{Name: "credential", Run: func() error { called++; return nil }},
		{Name: "pool", Run: func() error { called++; return nil }},
	}
	if _, err := c2.execute("uid-1", "/tmp/auth.json", resumed); err != nil {
		t.Fatal(err)
	}
	if len(c2.pending()) != 0 {
		t.Fatalf("journal not cleared: %+v", c2.pending())
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
