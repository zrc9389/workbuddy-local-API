package pool

import (
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"path/filepath"
	"testing"
)

func TestWholeAccountGuardKnownBalanceAndManual(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u"})
	p.SetBalanceGuard(100)
	if p.Pick() == nil {
		t.Fatal("unknown balance blocked")
	}
	p.SetCredits("u", 99, 1000)
	if p.Pick() != nil {
		t.Fatal("low balance routed")
	}
	p.SetManualDisabled("u", true)
	p.SetCredits("u", 200, 1000)
	if p.Pick() != nil {
		t.Fatal("manual disable cleared by balance")
	}
	s, _ := p.Status("u")
	if !s.ManualDisabled || s.BalanceBlocked {
		t.Fatal(s)
	}
	p.SetManualDisabled("u", false)
	if p.Pick() == nil {
		t.Fatal("manual restore failed")
	}
}
func TestManualAndKnownBalancePersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.json")
	p := New(path)
	p.Add(&auth.Auth{UID: "u"})
	p.SetBalanceGuard(100)
	p.SetCredits("u", 0, 1000)
	p.SetManualDisabled("u", true)
	p.Close()
	q := New(path)
	defer q.Close()
	q.Add(&auth.Auth{UID: "u"})
	q.SetBalanceGuard(100)
	s, _ := q.Status("u")
	if !s.ManualDisabled || !s.BalanceKnown || !s.BalanceBlocked {
		t.Fatal(s)
	}
}
