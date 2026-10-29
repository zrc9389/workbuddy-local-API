package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestCompletedResultsRestoreDeleteAndExpire(t *testing.T) {
	path := filepath.Join(t.TempDir(), "status.json")
	p := pool.New("")
	p.Add(&auth.Auth{UID: "a"})
	p.Add(&auth.Auth{UID: "b"})
	s := New(p, func(context.Context, string, string) (string, error) { return "done", nil })
	defer s.Close()
	if err := s.SetStorage(path); err != nil {
		t.Fatal(err)
	}
	if !s.Start() {
		t.Fatal("start")
	}
	waitFinished(t, s)
	restored := New(p, nil)
	defer restored.Close()
	if err := restored.SetStorage(path); err != nil {
		t.Fatal(err)
	}
	if st := restored.Status(); st.Running || len(st.Steps[0].Accounts) != 2 || st.LastResult != "ok" {
		t.Fatalf("restore: %+v", st)
	}
	if err := restored.DeleteAccount("a"); err != nil {
		t.Fatal(err)
	}
	check := New(p, nil)
	defer check.Close()
	if err := check.SetStorage(path); err != nil {
		t.Fatal(err)
	}
	if st := check.Status(); len(st.Steps[0].Accounts) != 1 || st.Steps[0].Accounts[0].UID != "b" || st.Steps[0].Total != 1 {
		t.Fatalf("delete: %+v", st)
	}
	end, err := time.Parse(time.RFC3339, check.Status().LastRunAt)
	if err != nil {
		t.Fatal(err)
	}
	if err := check.Prune(end.Add(retention - time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	if err := check.Prune(end.Add(retention)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("not removed: %v", err)
	}
}

func TestDeletionDuringExecutionCannotReintroduceAccount(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "a"})
	started := make(chan struct{})
	release := make(chan struct{})
	s := New(p, func(context.Context, string, string) (string, error) {
		select {
		case <-started:
		default:
			close(started)
			<-release
		}
		return "done", nil
	})
	defer s.Close()
	if err := s.SetStorage(filepath.Join(t.TempDir(), "status.json")); err != nil {
		t.Fatal(err)
	}
	s.Start()
	<-started
	if err := s.DeleteAccount("a"); err != nil {
		t.Fatal(err)
	}
	close(release)
	st := waitFinished(t, s)
	for _, step := range st.Steps {
		for _, a := range step.Accounts {
			if a.UID == "a" {
				t.Fatal("deleted account reappeared")
			}
		}
	}
}
