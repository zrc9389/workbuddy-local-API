package pool

import (
	"testing"
	"time"
)

func TestFailWindowDecay(t *testing.T) {
	p := New("")
	p.breakerThreshold = 3
	p.breakerCooldown = 30 * time.Minute

	e := &entry{}

	// 1. First failure
	p.recordBreakerFailureLocked(e)
	if e.fails != 1 {
		t.Fatalf("expected fails=1, got %d", e.fails)
	}

	// 2. Simulate 11 minutes pass
	e.lastFailAt = time.Now().Add(-11 * time.Minute)

	// 3. Second failure occurs after 11 minutes -> fails should reset to 1
	p.recordBreakerFailureLocked(e)
	if e.fails != 1 {
		t.Fatalf("expected fails reset to 1 after decay, got %d", e.fails)
	}
	if !e.breakerUntil.IsZero() {
		t.Fatalf("breaker should not trip on decayed failure")
	}

	// 4. Two quick failures follow within 1 minute
	p.recordBreakerFailureLocked(e) // fails=2
	p.recordBreakerFailureLocked(e) // fails=3 -> trips breaker!
	if e.fails != 0 {               // breaker resets fails to 0 and sets breakerUntil
		t.Fatalf("expected fails=0 after breaker tripped, got %d", e.fails)
	}
	if e.breakerUntil.IsZero() {
		t.Fatalf("expected breaker to be tripped")
	}
}
