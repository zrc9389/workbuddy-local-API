package maintenance

import (
	"context"
	"errors"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"testing"
	"time"
)

func TestSixteenAccountsIncludeIsolatedAndManuallyDisabled(t *testing.T) {
	p := pool.New("")
	for i := 0; i < 16; i++ {
		p.Add(&auth.Auth{UID: fmt.Sprintf("u%02d", i)})
	}
	p.Disable("u07", "invalid token")
	p.SetManualDisabled("u07", true)
	p.SetManualDisabled("u15", true)
	started := make(chan struct{})
	release := make(chan struct{})
	calls := make(map[string]int)
	s := New(p, func(_ context.Context, step, uid string) (string, error) {
		calls[uid]++
		if step == "token" && uid == "u00" {
			close(started)
			<-release
		}
		if uid == "u07" {
			return "", errors.New("invalid token")
		}
		return "done", nil
	})
	defer s.Close()
	if !s.Start() {
		t.Fatal("start failed")
	}
	<-started
	p.SetManualDisabled("u14", true)
	close(release)
	st := waitFinished(t, s)
	if calls["u07"] != 4 || calls["u14"] != 4 || calls["u15"] != 4 {
		t.Fatalf("calls = %v", calls)
	}
	for _, step := range st.Steps {
		if step.Total != 16 || len(step.Accounts) != 16 || step.Completed != 15 || step.Failed != 1 {
			t.Fatalf("step = %+v", step)
		}
		if step.Accounts[7].State != "failed" || step.Accounts[14].State != "done" || step.Accounts[15].State != "done" {
			t.Fatalf("results = %+v", step.Accounts)
		}
	}
}

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

func TestInitialStatusContainsPendingTasks(t *testing.T) {
	s := New(pool.New(""), nil)
	defer s.Close()
	steps := s.Status().Steps
	want := []string{"token", "checkin", "activity", "travel"}
	if len(steps) != len(want) {
		t.Fatalf("initial tasks = %d, want %d", len(steps), len(want))
	}
	for index, name := range want {
		if steps[index].Name != name || steps[index].State != "pending" {
			t.Fatalf("initial task %d = %+v", index, steps[index])
		}
	}
}

func TestPauseWaitsForCurrentAccountAndResumes(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "test-account"})
	started := make(chan string, 4)
	release := make(chan struct{})
	s := New(p, func(ctx context.Context, step, _ string) (string, error) {
		started <- step
		if step == "token" {
			select {
			case <-release:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		return "done", nil
	})
	defer s.Close()
	if !s.Start() {
		t.Fatal("start failed")
	}
	if step := <-started; step != "token" {
		t.Fatalf("first step: %s", step)
	}
	if !s.SetPaused(true) {
		t.Fatal("pause failed")
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for s.Status().Steps[0].Completed == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if s.Status().Steps[0].Completed != 1 {
		t.Fatal("current account did not finish")
	}
	select {
	case step := <-started:
		t.Fatalf("started %s while paused", step)
	case <-time.After(80 * time.Millisecond):
	}
	if !s.SetPaused(false) {
		t.Fatal("resume failed")
	}
	select {
	case step := <-started:
		if step != "checkin" {
			t.Fatalf("resumed at %s", step)
		}
	case <-time.After(time.Second):
		t.Fatal("resume did not start next step")
	}
}
