package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewRestartTriggerDelaysCancelAndIsIdempotent(t *testing.T) {
	var requested atomic.Bool
	var cancelCount atomic.Int32
	ctx, rawCancel := context.WithCancel(context.Background())
	cancel := func() {
		cancelCount.Add(1)
		rawCancel()
	}

	trigger := newRestartTrigger(&requested, cancel, 40*time.Millisecond)
	start := time.Now()
	if err := trigger(); err != nil {
		t.Fatalf("first trigger failed: %v", err)
	}
	if !requested.Load() {
		t.Fatal("expected restartRequested flag to be set immediately")
	}
	// Context must still be alive immediately after trigger so HTTP 202 can finish flushing.
	if ctx.Err() != nil {
		t.Fatal("context cancelled too early before delay")
	}
	// Second concurrent call is idempotent.
	if err := trigger(); err != nil {
		t.Fatalf("second trigger failed: %v", err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected delayed cancel to close context")
	}
	if elapsed := time.Since(start); elapsed < 30*time.Millisecond {
		t.Fatalf("cancel fired faster than configured delay: %v", elapsed)
	}
	if got := cancelCount.Load(); got != 1 {
		t.Fatalf("expected cancel to run exactly once, got %d", got)
	}
}
