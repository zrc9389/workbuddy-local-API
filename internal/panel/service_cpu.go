package panel

import (
	"sync"
	"time"
)

// CPU is expressed as percent of one core; multi-core use may exceed 100%.
type cpuSampler struct {
	mu        sync.Mutex
	lastTime  time.Time
	lastUsage uint64
}

func (s *cpuSampler) sample(now time.Time, read func() (uint64, bool)) (float64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	usage, ok := read()
	if !ok {
		s.lastTime = time.Time{}
		return 0, false
	}
	if s.lastTime.IsZero() || now.Sub(s.lastTime).Microseconds() <= 0 || usage < s.lastUsage {
		s.lastTime, s.lastUsage = now, usage
		return 0, false
	}
	pct := float64(usage-s.lastUsage) / float64(now.Sub(s.lastTime).Microseconds()) * 100
	s.lastTime, s.lastUsage = now, usage
	return pct, true
}
