package metacore

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDemoIsExplicitBoundedAndOffline(t *testing.T) {
	m, err := New(Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	if !m.Status().Demo || len(m.Nodes().Nodes) != 3 {
		t.Fatal("demo missing")
	}
	if _, err = m.AddSubscription(context.Background(), "https://example.com/secret"); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatal("demo accepted remote subscription")
	}
	n := m.Nodes().Nodes[0]
	if _, err = m.Bind(context.Background(), "demo-account", n.ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if !m.Nodes().Demo || len(m.Nodes().Bindings) != 1 {
		t.Fatal("demo binding absent")
	}
	if _, err = m.StartTests(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for m.Tests().Running && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !m.Tests().Demo || m.Tests().Completed != 3 {
		t.Fatal(m.Tests())
	}
	if _, err = os.Stat(filepath.Join(m.opts.Dir, "state.json")); !os.IsNotExist(err) {
		t.Fatal("demo persisted state")
	}
}
func TestStatsAccountAttributionAndClosedConnectionEstimate(t *testing.T) {
	m, _ := fixtureManager(t)
	m.mu.Lock()
	m.state.Bindings = []bindingRecord{{Binding: Binding{UID: "a", RouteID: "acct-a"}}, {Binding: Binding{UID: "b", RouteID: "acct-b"}}}
	m.mu.Unlock()
	var first connectionsSnapshot
	if json.Unmarshal([]byte(`{"uploadTotal":100,"downloadTotal":200,"connections":[{"id":"one","upload":40,"download":80,"metadata":{"inboundName":"acct-a"}},{"id":"two","upload":60,"download":120,"metadata":{"inboundName":"acct-b"}}]}`), &first) != nil {
		t.Fatal("fixture")
	}
	m.recordStats(first)
	s := m.Stats()
	if s.UploadTotal != 100 || len(s.Accounts) != 2 || s.Accounts[0].UploadTotal != 40 || s.Accounts[1].DownloadTotal != 120 || !s.Estimated {
		t.Fatal(s)
	}
	m.recordStats(connectionsSnapshot{UploadTotal: 110, DownloadTotal: 230})
	s = m.Stats()
	if s.UploadTotal != 110 || s.Accounts[0].UploadTotal != 40 || s.ActiveConnections != 0 {
		t.Fatal("closed tail must not be invented", s)
	}
}
func TestRejectTamperedState(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(`{"version":1,"providers":[{"id":"bad","file":"../personal.json"}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if m, err := newManager(Options{Dir: dir}, &fakeCore{}); err == nil {
		m.Close(context.Background())
		t.Fatal("path traversal state accepted")
	}
}
