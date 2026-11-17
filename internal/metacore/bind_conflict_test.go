package metacore

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestBindNodeConflictAndForceOverride(t *testing.T) {
	m, err := New(Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())

	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("demo manager returned no nodes")
	}
	nodeID := nodes[0].ID

	// Account A binds normally.
	if _, err := m.Bind(context.Background(), "acct-a", nodeID, func(string) error { return nil }); err != nil {
		t.Fatalf("initial bind failed: %v", err)
	}

	// Account A rebinding itself to the same node must NOT conflict.
	if _, err := m.Bind(context.Background(), "acct-a", nodeID, func(string) error { return nil }); err != nil {
		t.Fatalf("self-rebind should succeed: %v", err)
	}

	// Account B binding the same node without force must fail with NodeConflictError.
	saveCalled := false
	_, err = m.Bind(context.Background(), "acct-b", nodeID, func(string) error {
		saveCalled = true
		return nil
	})
	if saveCalled {
		t.Fatal("saveProxy must not be called on conflict")
	}
	if !errors.Is(err, ErrNodeAlreadyBound) {
		t.Fatalf("expected ErrNodeAlreadyBound, got: %v", err)
	}
	var conflictErr *NodeConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected *NodeConflictError, got: %T (%v)", err, err)
	}
	if conflictErr.NodeID != nodeID {
		t.Fatalf("conflict NodeID=%q want %q", conflictErr.NodeID, nodeID)
	}
	if !reflect.DeepEqual(conflictErr.ConflictUIDs, []string{"acct-a"}) {
		t.Fatalf("conflict UIDs=%v want [acct-a]", conflictErr.ConflictUIDs)
	}

	// Account B binding with force=true must succeed.
	if _, err := m.BindWithForce(context.Background(), "acct-b", nodeID, true, func(string) error { return nil }); err != nil {
		t.Fatalf("force bind failed: %v", err)
	}

	// Account C binding the same node without force must list both acct-a and acct-b sorted.
	_, err = m.Bind(context.Background(), "acct-c", nodeID, func(string) error { return nil })
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected *NodeConflictError for acct-c, got: %v", err)
	}
	if !reflect.DeepEqual(conflictErr.ConflictUIDs, []string{"acct-a", "acct-b"}) {
		t.Fatalf("conflict UIDs=%v want [acct-a acct-b]", conflictErr.ConflictUIDs)
	}
}
