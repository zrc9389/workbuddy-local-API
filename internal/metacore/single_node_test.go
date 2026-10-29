package metacore

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSingleNodeJobOnlyUpdatesSelectedNodeAndRejectsOverlap(t *testing.T) {
	m, core := fixtureManager(t)
	core.delay = 100 * time.Millisecond
	if _, err := m.importBytes(context.Background(), "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	nodes := m.Nodes().Nodes
	if len(nodes) != 2 {
		t.Fatalf("nodes: %d", len(nodes))
	}
	if _, err := m.StartNodeTest(context.Background(), "missing"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing: %v", err)
	}
	job, err := m.StartNodeTest(context.Background(), nodes[0].ID)
	if err != nil || job.Total != 1 {
		t.Fatalf("job: %+v %v", job, err)
	}
	if _, err = m.StartTests(context.Background()); !errors.Is(err, ErrBusy) {
		t.Fatalf("overlap: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for m.Tests().Running && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if j := m.Tests(); j.Running || j.Completed != 1 || j.Failed != 0 {
		t.Fatalf("result: %+v", j)
	}
	got := m.Nodes().Nodes
	for _, n := range got {
		if n.ID == nodes[0].ID && (n.Status != "ok" || n.DelayMS == nil || *n.DelayMS != 12) {
			t.Fatalf("selected: %+v", n)
		}
		if n.ID != nodes[0].ID && n.Status != "untested" {
			t.Fatalf("other node changed: %+v", n)
		}
	}
}

func TestNodeHistoryPersistsConcurrentBatchesAndPrunesOnDeletion(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	if _, err := m.importBytes(ctx, "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := m.StartTests(ctx); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(3 * time.Second)
		for m.Tests().Running && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		if m.Tests().Running {
			t.Fatal("job did not finish")
		}
	}
	readState := func() diskState {
		b, err := os.ReadFile(filepath.Join(m.opts.Dir, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		var s diskState
		if err := json.Unmarshal(b, &s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := readState()
	for _, n := range m.Nodes().Nodes {
		if len(s.NodeHistory[n.ID]) != 3 {
			t.Fatalf("node %s: history %+v", n.ID, s.NodeHistory[n.ID])
		}
	}
	restarted, err := newManager(Options{Dir: m.opts.Dir}, &fakeCore{nodes: []coreNode{{Name: "fixture/one", Type: "Http"}, {Name: "fixture/two", Type: "Http"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close(ctx)
	if err := restarted.EnsureStarted(ctx); err != nil {
		t.Fatal(err)
	}
	for _, n := range restarted.Nodes().Nodes {
		if len(n.History) != 3 {
			t.Fatalf("restored node %+v", n)
		}
		if n.Status != "ok" || n.DelayMS == nil || *n.DelayMS != 12 || n.TestedAt == nil {
			t.Fatalf("latest test status not restored: %+v", n)
		}
	}
	if err := m.RemoveSubscriptionAndUnbind(ctx, "fixture", nil); err != nil {
		t.Fatal(err)
	}
	if got := readState().NodeHistory; len(got) != 0 {
		t.Fatalf("deleted node history remains: %+v", got)
	}
}

func TestNodeLatestHistoryRestoresOutcome(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	if _, err := m.importBytes(ctx, "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("fixture has no nodes")
	}
	for _, tc := range []struct {
		name   string
		sample History
		status string
		delay  bool
	}{
		{"success", History{Delay: 42, Time: time.Now(), Status: "ok"}, "ok", true},
		{"timeout", History{Time: time.Now(), Status: "timeout"}, "timeout", false},
		{"error", History{Time: time.Now(), Status: "error"}, "error", false},
		{"legacy failure", History{Time: time.Now()}, "error", false},
		{"no time", History{Delay: 42}, "untested", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m.mu.Lock()
			state := m.snapshotLocked()
			m.mu.Unlock()
			state.NodeHistory[nodes[0].ID] = []History{tc.sample}
			got, err := m.readNodes(ctx, state)
			if err != nil {
				t.Fatal(err)
			}
			n := got[nodes[0].ID]
			if n.Status != tc.status || (n.DelayMS != nil) != tc.delay || (n.TestedAt != nil) != !tc.sample.Time.IsZero() {
				t.Fatalf("restored %+v", n)
			}
		})
	}
}

func TestBindRejectsTimedOutNodeWithoutChangingExistingBinding(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	if _, err := m.importBytes(ctx, "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	defer m.Close(ctx)
	nodes := m.Nodes().Nodes
	if len(nodes) < 2 {
		t.Fatal("fixture needs two nodes")
	}
	if _, err := m.Bind(ctx, "account", nodes[0].ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	n := m.nodes[nodes[1].ID]
	n.Status = "timeout"
	m.nodes[n.ID] = n
	m.mu.Unlock()
	called := false
	_, err := m.Bind(ctx, "account", nodes[1].ID, func(string) error { called = true; return nil })
	if !errors.Is(err, ErrNodeTimeout) || called {
		t.Fatalf("err=%v save called=%v", err, called)
	}
	bindings := m.Nodes().Bindings
	if len(bindings) != 1 || bindings[0].Node != nodes[0].ID {
		t.Fatalf("binding changed: %+v", bindings)
	}
}
