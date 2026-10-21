package maintenance

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"testing"
	"time"
)

func TestUnifiedRunReportsRealOutcomesAndRejectsOverlap(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "u"})
	entered := make(chan struct{})
	release := make(chan struct{})
	calls := 0
	s := New(p, func(ctx context.Context, job, uid string) (string, error) {
		calls++
		if calls == 1 {
			close(entered)
			<-release
		}
		return "done", nil
	})
	if !s.Start() {
		t.Fatal("not started")
	}
	<-entered
	if s.Start() {
		t.Fatal("duplicate")
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for s.Status().Running && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	st := s.Status()
	if st.Running || len(st.Steps) != 4 || calls != 4 {
		t.Fatal(st, calls)
	}
	for _, step := range st.Steps {
		if step.Completed != 1 || step.State != "done" {
			t.Fatal(step)
		}
	}
}
