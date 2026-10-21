package scheduler

import "time"

// NextCreditRecovery shares the same schedule and timezone as actual check-in.
func (s *Scheduler) NextCreditRecovery(now time.Time) time.Time {
	s.schedMu.Lock()
	defer s.schedMu.Unlock()
	if s.cfg.CheckinDisabled {
		return time.Time{}
	}
	return nextFire(now, s.cfg.CheckinHours)
}
