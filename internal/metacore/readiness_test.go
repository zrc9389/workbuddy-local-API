package metacore

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
)

type delayedProviderCore struct {
	*fakeCore
	pending atomic.Int32
}

func (f *delayedProviderCore) Request(ctx context.Context, method, path string, in, out any) error {
	if strings.HasPrefix(path, "/providers/proxies/") && f.pending.Add(-1) >= 0 {
		saved := f.nodes
		f.mu.Lock()
		f.nodes = nil
		f.mu.Unlock()
		e := f.fakeCore.Request(ctx, method, path, in, out)
		f.mu.Lock()
		f.nodes = saved
		f.mu.Unlock()
		return e
	}
	return f.fakeCore.Request(ctx, method, path, in, out)
}
func TestStartupWaitsForAsynchronousProviderReadiness(t *testing.T) {
	f := &delayedProviderCore{fakeCore: &fakeCore{nodes: []coreNode{{Name: "fixture/one", Type: "Http"}}}}
	f.pending.Store(2)
	m, e := newManager(Options{Dir: t.TempDir()}, f)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close(context.Background())
	m.state.Providers = []provider{{ID: "fixture", File: "providers/test.txt"}}
	if e = m.Ensure(context.Background()); e != nil {
		t.Fatal("controller ready before provider init", e)
	}
	if len(m.Nodes().Nodes) != 1 {
		t.Fatal("startup returned without nodes")
	}
}
