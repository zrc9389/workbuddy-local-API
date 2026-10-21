package metacore

// Deliberately simulated controller for --demo. It never starts processes,
// opens sockets, fetches subscriptions, or persists real proxy assignments.
import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
)

type demoCore struct {
	mu      sync.Mutex
	live    bool
	tests   int64
	samples int64
}

func newDemoCore() *demoCore { return &demoCore{} }
func demoState() diskState {
	return diskState{Version: 1, Providers: []provider{{ID: "demo", File: "providers/demo.txt"}}, Bindings: []bindingRecord{}}
}
func demoNodes() map[string]Node {
	out := map[string]Node{}
	for _, name := range []string{"demo/Local A", "demo/Local B", "demo/Local C"} {
		id := shortHash("demo\x00" + name)
		out[id] = Node{ID: id, Name: name, Type: "Http", Provider: "demo", Status: "untested", History: []History{}}
	}
	return out
}
func (d *demoCore) Available() bool                        { return true }
func (d *demoCore) Alive() bool                            { d.mu.Lock(); defer d.mu.Unlock(); return d.live }
func (d *demoCore) Validate(context.Context, []byte) error { return nil }
func (d *demoCore) Start(context.Context, []byte) error {
	d.mu.Lock()
	d.live = true
	d.mu.Unlock()
	return nil
}
func (d *demoCore) Apply(context.Context, []byte) error { return nil }
func (d *demoCore) Stop() error                         { d.mu.Lock(); d.live = false; d.mu.Unlock(); return nil }
func (d *demoCore) Request(ctx context.Context, method, path string, in, out any) error {
	if method == "PUT" && strings.HasPrefix(path, "/proxies/") {
		return nil
	}
	var value any = map[string]any{}
	switch {
	case path == "/version":
		value = map[string]string{"version": "demo-simulated"}
	case strings.HasPrefix(path, "/providers/proxies/") && !strings.Contains(path, "healthcheck"):
		ns := []coreNode{}
		for _, n := range demoNodes() {
			ns = append(ns, coreNode{Name: n.Name, Type: n.Type})
		}
		value = map[string]any{"proxies": ns}
	case strings.Contains(path, "healthcheck"):
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
		d.mu.Lock()
		d.tests++
		seq := d.tests
		d.mu.Unlock()
		value = map[string]int64{"delay": 12 + seq%19}
	case path == "/connections":
		d.mu.Lock()
		d.samples++
		count := d.samples
		d.mu.Unlock()
		value = map[string]any{"uploadTotal": count * 256, "downloadTotal": count * 1024, "connections": []any{}}
	default:
		return errors.New("demo operation unsupported")
	}
	if out == nil {
		return nil
	}
	b, _ := json.Marshal(value)
	return json.Unmarshal(b, out)
}
