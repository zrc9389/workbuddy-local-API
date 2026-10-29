package panel

import (
	"testing"
	"time"
)

func TestCPUSamplerUsesDeltaAndResetsAfterFailure(t *testing.T) {
	var s cpuSampler
	now := time.Unix(100, 0)
	usage := uint64(1000000)
	read := func() (uint64, bool) { return usage, true }
	if _, ok := s.sample(now, read); ok {
		t.Fatal("first sample must be unavailable")
	}
	usage += 1500000
	if pct, ok := s.sample(now.Add(time.Second), read); !ok || pct != 150 {
		t.Fatalf("got %v %v", pct, ok)
	}
	if _, ok := s.sample(now.Add(2*time.Second), func() (uint64, bool) { return 0, false }); ok {
		t.Fatal("read failure must be unavailable")
	}
	if _, ok := s.sample(now.Add(3*time.Second), read); ok {
		t.Fatal("must rebaseline after failure")
	}
	usage = 1
	if _, ok := s.sample(now.Add(4*time.Second), read); ok {
		t.Fatal("counter reset must rebaseline")
	}
}
