package maintenance

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestBatchBMaintenanceStaggerAndSkipOn401OrTokenFail(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "u-ok-1"})
	p.Add(&auth.Auth{UID: "u-401-2"})
	p.Add(&auth.Auth{UID: "u-ok-3"})

	var mu sync.Mutex
	callsByUID := make(map[string][]string)
	s := New(p, func(_ context.Context, step, uid string) (string, error) {
		mu.Lock()
		callsByUID[uid] = append(callsByUID[uid], step)
		mu.Unlock()
		if uid == "u-401-2" && step == "checkin" {
			return "", errors.New("http 401 unauthorized")
		}
		return "ok", nil
	})
	defer s.Close()
	s.SetAccountStagger(15*time.Millisecond, 25*time.Millisecond)

	start := time.Now()
	if !s.Start() {
		t.Fatal("start failed")
	}
	st := waitFinished(t, s)
	elapsed := time.Since(start)
	// 3 accounts across 4 steps -> multiple inter-account staggers of >= 15ms
	if elapsed < 60*time.Millisecond {
		t.Fatalf("expected maintenance account stagger >= 60ms, got %v", elapsed)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(callsByUID["u-401-2"]) != 2 {
		t.Fatalf("expected u-401-2 to stop after checkin 401 (token+checkin=2 calls), got %v", callsByUID["u-401-2"])
	}
	if len(callsByUID["u-ok-1"]) != 4 || len(callsByUID["u-ok-3"]) != 4 {
		t.Fatalf("healthy accounts should complete all 4 steps: u1=%v u3=%v", callsByUID["u-ok-1"], callsByUID["u-ok-3"])
	}
	// activity and travel steps should record skipped for u-401-2
	for _, idx := range []int{2, 3} {
		foundSkipped := false
		for _, ar := range st.Steps[idx].Accounts {
			if ar.UID == "u-401-2" && ar.State == "skipped" {
				foundSkipped = true
			}
		}
		if !foundSkipped {
			t.Fatalf("step %s missing skipped record for u-401-2: %+v", st.Steps[idx].Name, st.Steps[idx].Accounts)
		}
	}
}
