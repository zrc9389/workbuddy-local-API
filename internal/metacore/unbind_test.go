package metacore

import (
	"context"
	"testing"
)

func TestDeleteBindingRestoresCapacity(t *testing.T) {
	m, e := New(Options{Demo: true, Dir: t.TempDir()})
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close(context.Background())
	ns := m.Nodes()
	_, e = m.Bind(context.Background(), "account-a", ns.Nodes[0].ID, func(string) error { return nil })
	if e != nil {
		t.Fatal(e)
	}
	release, e := m.AcquireAccount(context.Background(), "account-a")
	if e != nil {
		t.Fatal(e)
	}
	if e = m.DeleteAccountBinding(context.Background(), "account-a"); e != ErrBusy {
		t.Fatal("active account removal allowed", e)
	}
	release()
	if e = m.DeleteAccountBinding(context.Background(), "account-a"); e != nil {
		t.Fatal(e)
	}
	if len(m.Nodes().Bindings) != 0 {
		t.Fatal("binding leaked")
	}
}
