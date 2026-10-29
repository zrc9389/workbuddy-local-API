package panel

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetentionManagerStartupAndPeriodicRetry(t *testing.T) {
	m := NewRetentionManager()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := make(chan int, 4)
	var attempts atomic.Int32
	m.Run(ctx, time.Millisecond, func(time.Time) error {
		attempt := int(attempts.Add(1))
		calls <- attempt
		if attempt == 1 {
			return os.ErrPermission
		}
		return nil
	})
	select {
	case got := <-calls:
		if got != 1 {
			t.Fatalf("startup attempt=%d", got)
		}
	case <-time.After(time.Second):
		t.Fatal("startup cleanup did not run")
	}
	select {
	case got := <-calls:
		if got != 2 {
			t.Fatalf("retry attempt=%d", got)
		}
	case <-time.After(time.Second):
		t.Fatal("failed cleanup was not retried")
	}
}

func TestRetentionManagerUsesCurrentTimeAfterSlowCleanup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	release := make(chan struct{})
	second := make(chan time.Time, 1)
	calls := 0
	NewRetentionManager().Run(ctx, 10*time.Millisecond, func(now time.Time) error {
		calls++
		if calls == 1 {
			close(started)
			<-release
		} else if calls == 2 {
			second <- now
		}
		return nil
	})
	<-started
	time.Sleep(100 * time.Millisecond)
	beforeRelease := time.Now()
	close(release)
	select {
	case got := <-second:
		if got.Before(beforeRelease) {
			t.Fatalf("stale queued tick: %v before %v", got, beforeRelease)
		}
	case <-time.After(time.Second):
		t.Fatal("no retry after slow cleanup")
	}
}

func TestRetentionManagerPruneJSONFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "usage.json")
	now := time.Now().UTC()
	oldTS := now.Add(-25 * time.Hour).Format(time.RFC3339)
	newTS := now.Add(-time.Hour).Format(time.RFC3339)
	data := "[{\"ts\":\"" + oldTS + "\",\"uid\":\"old\"},{\"ts\":\"" + newTS + "\",\"uid\":\"new\"}]"
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	m := NewRetentionManager()
	removed, err := m.PruneJSONFile(path, now)
	if err != nil || removed != 1 {
		t.Fatalf("removed=%d err=%v", removed, err)
	}
	raw, _ := os.ReadFile(path)
	if string(raw) == data || len(raw) == 0 {
		t.Fatalf("retention did not replace file")
	}
}

func TestRetentionManagerWindowFixed24Hours(t *testing.T) {
	if got := NewRetentionManager().Window(); got != 24*time.Hour {
		t.Fatalf("window=%s", got)
	}
}
