package metacore

import (
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeCore struct {
	mu          sync.Mutex
	live        bool
	reject      bool
	config      []byte
	nodes       []coreNode
	active, max int
	delay       time.Duration
}

func (f *fakeCore) Available() bool { return true }
func (f *fakeCore) Alive() bool     { f.mu.Lock(); defer f.mu.Unlock(); return f.live }
func (f *fakeCore) Validate(ctx context.Context, b []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.reject {
		return errors.New("private validation detail")
	}
	return nil
}
func (f *fakeCore) Start(ctx context.Context, b []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.live = true
	f.config = append([]byte(nil), b...)
	return nil
}
func (f *fakeCore) Apply(ctx context.Context, b []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.reject {
		return errors.New("private apply detail")
	}
	f.config = append([]byte(nil), b...)
	return nil
}
func (f *fakeCore) Stop() error { f.mu.Lock(); defer f.mu.Unlock(); f.live = false; return nil }
func (f *fakeCore) Request(ctx context.Context, method, path string, in, out any) error {
	f.mu.Lock()
	if method == "PUT" && strings.HasPrefix(path, "/proxies/") && f.reject {
		f.reject = false
		f.mu.Unlock()
		return ErrApply
	}
	if strings.Contains(path, "healthcheck") {
		f.active++
		if f.active > f.max {
			f.max = f.active
		}
		d := f.delay
		f.mu.Unlock()
		defer func() { f.mu.Lock(); f.active--; f.mu.Unlock() }()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(d):
		}
		b, _ := json.Marshal(map[string]int{"delay": 12})
		return json.Unmarshal(bmust(b), out)
	}
	nodes := append([]coreNode(nil), f.nodes...)
	f.mu.Unlock()
	var value any = map[string]any{}
	switch {
	case path == "/version":
		value = map[string]string{"version": "fixture"}
	case strings.HasPrefix(path, "/providers/proxies/"):
		value = map[string]any{"proxies": nodes}
	case path == "/connections":
		value = map[string]any{"uploadTotal": 0, "downloadTotal": 0, "connections": []any{}}
	}
	if out == nil {
		return nil
	}
	b, _ := json.Marshal(value)
	return json.Unmarshal(b, out)
}
func bmust(b []byte) []byte { return b }
func fixtureManager(t *testing.T) (*Manager, *fakeCore) {
	t.Helper()
	f := &fakeCore{nodes: []coreNode{{Name: "fixture/one", Type: "Http"}, {Name: "fixture/two", Type: "Http"}}}
	m, err := newManager(Options{Dir: t.TempDir()}, f)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(context.Background()) })
	return m, f
}

func TestNodeDisplayNamePreservesRoutingIdentity(t *testing.T) {
	m, _ := fixtureManager(t)
	m.nodes = map[string]Node{
		"n1": {ID: "n1", Provider: "sub-1", Name: "sub-1/🇺🇸美国/推荐"},
		"n2": {ID: "n2", Provider: "sub-1", Name: "other/原名"},
	}
	nodes := m.Nodes().Nodes
	if len(nodes) != 2 || nodes[0].Name != "sub-1/🇺🇸美国/推荐" || nodes[0].DisplayName != "🇺🇸美国/推荐" || nodes[0].ID != "n1" {
		t.Fatalf("bad first node: %+v", nodes)
	}
	if nodes[1].Name != "other/原名" || nodes[1].DisplayName != "other/原名" {
		t.Fatalf("unexpected prefix removal: %+v", nodes[1])
	}
}

func TestNodesExposeBindingCounts(t *testing.T) {
	m, _ := fixtureManager(t)
	m.nodes = map[string]Node{"n1": {ID: "n1"}, "n2": {ID: "n2"}}
	m.state.Bindings = []bindingRecord{
		{Binding: Binding{UID: "a", Node: "n1"}},
		{Binding: Binding{UID: "b", Node: "n1"}},
		{Binding: Binding{UID: "c", Node: "n2"}},
	}
	nodes := m.Nodes().Nodes
	if len(nodes) != 2 || nodes[0].BindingCount != 2 || nodes[1].BindingCount != 1 {
		t.Fatalf("binding counts: %+v", nodes)
	}
}
func TestConfigPerAccountIsolation(t *testing.T) {
	s := diskState{Providers: []provider{{ID: "fixture", File: "providers/fixture.txt"}}, Bindings: []bindingRecord{{Binding: Binding{UID: "a", Node: "n1", RouteID: "account-a", Port: 19001}, Provider: "fixture", Name: "fixture/one", Password: "p1"}, {Binding: Binding{UID: "b", Node: "n2", RouteID: "account-b", Port: 19002}, Provider: "fixture", Name: "fixture/two", Password: "p2"}}}
	b, err := renderConfig(s, "127.0.0.1:19999", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	var c map[string]any
	if json.Unmarshal(b, &c) != nil {
		t.Fatal("invalid config")
	}
	if c["external-controller"] != "127.0.0.1:19999" || c["allow-lan"] != false {
		t.Fatal("unsafe controller")
	}
	ls := c["listeners"].([]any)
	for i, v := range ls {
		l := v.(map[string]any)
		if l["listen"] != "127.0.0.1" || l["proxy"] != s.Bindings[i].RouteID {
			t.Fatal("shared or public ingress")
		}
	}
	groups := c["proxy-groups"].([]any)
	if len(groups) != 3 {
		t.Fatal("expected inventory plus independent groups")
	}
	if strings.Contains(string(b), `"proxy":"GLOBAL"`) {
		t.Fatal("global selector")
	}
}
func TestSubscriptionSSRFPolicy(t *testing.T) {
	for _, raw := range []string{"https://user:pass@example.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://169.254.169.254/a", "file:///a", "https://example.com:0/a", "https://example.com:65536/a"} {
		if _, err := subscriptionURL(raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "::1", "::ffff:127.0.0.1", "192.0.2.3", "100.64.0.1", "198.18.1.1", "fc00::1"} {
		if publicIP(netip.MustParseAddr(ip)) {
			t.Fatal("accepted reserved", ip)
		}
	}
	for _, raw := range []string{"http://example.com/a", "https://example.com/a", "http://example.com:80/a", "https://example.com:443/a", "https://example.com:2096/a"} {
		if _, err := subscriptionURL(raw); err != nil {
			t.Fatalf("accepted protocol URL %s: %v", raw, err)
		}
	}
	if _, err := subscriptionURL("https://example.com/sub?token=do-not-echo"); err != nil {
		t.Fatal(err)
	}
}
func TestBindingRollbackAndStableIdentity(t *testing.T) {
	m, f := fixtureManager(t)
	ctx := context.Background()
	if _, err := m.importBytes(ctx, "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	ns := m.Nodes().Nodes
	var applied string
	b, err := m.Bind(ctx, "account-a", ns[0].ID, func(p string) error { applied = p; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(applied, "127.0.0.1:") {
		t.Fatal("not local proxy")
	}
	before := string(f.config)
	f.reject = true
	if _, err = m.Bind(ctx, "account-a", ns[1].ID, func(p string) error { t.Fatal("callback on failed config"); return nil }); err == nil {
		t.Fatal("expected failure")
	}
	f.reject = false
	if got := m.Nodes().Bindings[0]; got.Node != b.Node || string(f.config) != before {
		t.Fatal("rollback lost old binding")
	}
	if _, err = m.Bind(ctx, "account-a", ns[1].ID, func(p string) error { return errors.New("disk full secret") }); err == nil {
		t.Fatal("account write failure ignored")
	}
	if got := m.Nodes().Bindings[0]; got.Node != b.Node {
		t.Fatal("failed account write committed")
	}
	next, err := m.Bind(ctx, "account-a", ns[1].ID, func(p string) error {
		if p != applied {
			t.Fatal("changed local endpoint")
		}
		return nil
	})
	if err != nil || next.Port != b.Port || next.RouteID != b.RouteID {
		t.Fatal("unstable route", err)
	}
}
func TestBatchBoundAndCancel(t *testing.T) {
	m, f := fixtureManager(t)
	f.nodes = nil
	for i := 0; i < 20; i++ {
		f.nodes = append(f.nodes, coreNode{Name: string(rune('a' + i)), Type: "Http"})
	}
	f.delay = 150 * time.Millisecond
	if _, err := m.importBytes(context.Background(), "fixture", []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	j, err := m.StartTests(context.Background())
	if err != nil || !j.Running {
		t.Fatal(j, err)
	}
	time.Sleep(25 * time.Millisecond)
	m.CancelTests()
	deadline := time.Now().Add(time.Second)
	for m.Tests().Running && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	f.mu.Lock()
	max := f.max
	f.mu.Unlock()
	if max > 4 || m.Tests().Running || !m.Tests().Cancelled {
		t.Fatal("unbounded batch", max, m.Tests())
	}
}
