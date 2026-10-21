package maintenance

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func waitFinished(t *testing.T, s *Service) Status {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		st := s.Status()
		if !st.Running {
			return st
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("maintenance run did not finish")
	return Status{}
}

func assertRFC3339(t *testing.T, name, value string) time.Time {
	t.Helper()
	if value == "" {
		t.Fatalf("%s is empty", name)
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("%s=%q is not RFC3339: %v", name, value, err)
	}
	return parsed
}

// 未运行时不得暴露任何上一轮记录。
func TestStatusEmptyBeforeFirstRun(t *testing.T) {
	s := New(pool.New(""), func(context.Context, string, string) (string, error) {
		return "done", nil
	})
	st := s.Status()
	if st.LastRunAt != "" || st.LastFinishedAt != "" || st.LastResult != "" || st.LastFailed != 0 {
		t.Fatalf("fresh service leaked run history: %+v", st)
	}
}

// 部分失败：四步各 1 成功 1 失败，结果 partial，失败数按步求和。
func TestRunRecordsPartialOutcome(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "a"})
	p.Add(&auth.Auth{UID: "b"})
	s := New(p, func(_ context.Context, job, uid string) (string, error) {
		if uid == "b" {
			return "", errors.New("upstream exploded")
		}
		return "done", nil
	})
	if !s.Start() {
		t.Fatal("not started")
	}
	st := waitFinished(t, s)

	runAt := assertRFC3339(t, "last_run_at", st.LastRunAt)
	finishedAt := assertRFC3339(t, "last_finished_at", st.LastFinishedAt)
	if finishedAt.Before(runAt) {
		t.Fatalf("finished_at %v before run_at %v", finishedAt, runAt)
	}
	if st.LastResult != "partial" {
		t.Fatalf("last_result=%q want partial", st.LastResult)
	}
	if st.LastFailed != 4 {
		t.Fatalf("last_failed=%d want 4 (one failure in each of four steps)", st.LastFailed)
	}
}

// 全成功：结果 ok，失败数为 0。
func TestRunRecordsOKOutcome(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "a"})
	s := New(p, func(context.Context, string, string) (string, error) {
		return "done", nil
	})
	if !s.Start() {
		t.Fatal("not started")
	}
	st := waitFinished(t, s)
	if st.LastResult != "ok" || st.LastFailed != 0 {
		t.Fatalf("last_result=%q last_failed=%d want ok/0", st.LastResult, st.LastFailed)
	}
	assertRFC3339(t, "last_run_at", st.LastRunAt)
	assertRFC3339(t, "last_finished_at", st.LastFinishedAt)
}
