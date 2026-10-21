package scheduler

import (
	"testing"
	"time"
)

func TestNextCreditRecoveryUsesActiveSchedule(t *testing.T) {
	s := New(Config{CheckinHours: []int{9, 21}})
	now := time.Date(2026, 10, 18, 10, 0, 0, 0, time.FixedZone("CST", 8*3600))
	if got := s.NextCreditRecovery(now); got.Hour() != 21 || got.Day() != 18 {
		t.Fatal(got)
	}
	s.cfg.CheckinDisabled = true
	if !s.NextCreditRecovery(now).IsZero() {
		t.Fatal("disabled schedule returned recovery")
	}
}
