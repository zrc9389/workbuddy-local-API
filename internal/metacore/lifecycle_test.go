package metacore

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAccountLeaseGatesShutdownAndReloadThenRestarts(t *testing.T) {
	m, f := fixtureManager(t)
	ctx := context.Background()
	if _, err := m.importBytes(ctx, "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	n := m.Nodes().Nodes[0]
	if _, err := m.Bind(ctx, "account", n.ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	release, err := m.AcquireAccount(ctx, "account")
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.lastUse = time.Now().Add(-time.Hour)
	m.mu.Unlock()
	m.maybeIdle(connectionsSnapshot{})
	if !f.Alive() {
		t.Fatal("stopped leased core")
	}
	if err = m.Close(ctx); !errors.Is(err, ErrBusy) {
		t.Fatal("closed leased manager", err)
	}
	if _, err = m.importBytes(ctx, "new", []byte("fixture2")); !errors.Is(err, ErrBusy) {
		t.Fatal("reloaded leased provider", err)
	}
	release()
	release()
	m.mu.Lock()
	if m.leases != 0 {
		t.Fatal("release not idempotent")
	}
	m.lastUse = time.Now().Add(-time.Hour)
	m.mu.Unlock()
	m.maybeIdle(connectionsSnapshot{})
	if f.Alive() {
		t.Fatal("bound but idle core not stopped")
	}
	release, err = m.AcquireAccount(ctx, "account")
	if err != nil || !f.Alive() {
		t.Fatal("failed demand restart", err)
	}
	release()
	if err = m.Close(ctx); err != nil {
		t.Fatal(err)
	}
}
func TestUnboundLeaseDoesNotStartKernel(t *testing.T) {
	m, f := fixtureManager(t)
	release, err := m.AcquireAccount(context.Background(), "not-managed")
	if err != nil || release == nil || f.Alive() {
		t.Fatal("unbound lease started kernel", err)
	}
	release()
}
