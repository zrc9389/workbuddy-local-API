package metacore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSubscriptionNamesUnique(t *testing.T) {
	m, _ := fixtureManager(t)
	m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("fixture"), nil })
	ctx := context.Background()
	a, err := m.AddSubscriptionNamed(ctx, "https://example.com/a", "线路")
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.AddSubscriptionNamed(ctx, "https://example.com/b", "线路")
	if err != nil {
		t.Fatal(err)
	}
	s, _ := m.Subscription(b.Provider)
	if s.Name != "线路 (2)" {
		t.Fatal(s.Name)
	}
	n := "线路"
	s, err = m.UpdateSubscription(ctx, b.Provider, &n, nil)
	if err != nil || s.Name != "线路 (2)" {
		t.Fatal(s, err)
	}
	_, err = m.AddSubscriptionNamed(ctx, "https://example.com/a", "")
	if err != nil {
		t.Fatal(err)
	}
	s, _ = m.Subscription(a.Provider)
	if s.Name != "线路" || len(m.Subscriptions()) != 2 {
		t.Fatal("duplicate import")
	}
}

func TestDefaultSubscriptionNamesUseCompactSuffix(t *testing.T) {
	m, _ := fixtureManager(t)
	m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("fixture"), nil })
	ctx := context.Background()
	if _, err := m.AddSubscriptionNamed(ctx, "https://example.com/default-a", "新增专线订阅"); err != nil {
		t.Fatal(err)
	}
	second, err := m.AddSubscriptionNamed(ctx, "https://example.com/default-b", "新增专线订阅")
	if err != nil {
		t.Fatal(err)
	}
	s, err := m.Subscription(second.Provider)
	if err != nil || s.Name != "新增专线订阅2" {
		t.Fatalf("name=%q err=%v", s.Name, err)
	}
}
func TestDeleteSubscriptionSwitchesAccountsAndRollsBack(t *testing.T) {
	m, core := seededSubscriptions(t, 2)
	id := m.Subscriptions()[0].ID
	var node string
	for _, n := range m.Nodes().Nodes {
		if n.Provider == id {
			node = n.ID
			break
		}
	}
	proxies := map[string]string{}
	for _, uid := range []string{"a", "b"} {
		_, err := m.Bind(context.Background(), uid, node, func(p string) error { proxies[uid] = p; return nil })
		if err != nil {
			t.Fatal(err)
		}
	}
	original := map[string]string{"a": proxies["a"], "b": proxies["b"]}
	calls := 0
	callback := func(uid, expected string) (func() error, error) {
		calls++
		if calls == 2 {
			return nil, errors.New("failure")
		}
		previous := proxies[uid]
		proxies[uid] = ""
		return func() error { proxies[uid] = previous; return nil }, nil
	}
	if err := m.RemoveSubscriptionAndUnbind(context.Background(), id, callback); err == nil {
		t.Fatal("expected failure")
	}
	if proxies["a"] != original["a"] || proxies["b"] != original["b"] || len(m.Subscriptions()) != 2 || len(m.Nodes().Bindings) != 2 {
		t.Fatal("failed rollback")
	}
	release, err := m.AcquireAccount(context.Background(), "a")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveSubscriptionAndUnbind(context.Background(), id, callback); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	release()
	core.reject = true
	callback = func(uid, expected string) (func() error, error) {
		previous := proxies[uid]
		proxies[uid] = ""
		return func() error { proxies[uid] = previous; return nil }, nil
	}
	if err := m.RemoveSubscriptionAndUnbind(context.Background(), id, callback); err == nil {
		t.Fatal("apply failure")
	}
	core.reject = false
	if proxies["a"] != original["a"] || proxies["b"] != original["b"] || len(m.Subscriptions()) != 2 {
		t.Fatal("apply rollback")
	}
	if err := m.RemoveSubscriptionAndUnbind(context.Background(), id, callback); err != nil {
		t.Fatal(err)
	}
	if proxies["a"] != "" || proxies["b"] != "" || len(m.Nodes().Bindings) != 0 || len(m.Subscriptions()) != 1 {
		t.Fatal("delete did not unbind")
	}
}
func TestAuthorizedSubscriptionLive(t *testing.T) {
	raw := os.Getenv("WB_TEST_SUBSCRIPTION_URL")
	if raw == "" {
		t.Skip("no authorized subscription")
	}
	binary := os.Getenv("WB_TEST_MIHOMO")
	if binary == "" {
		t.Fatal("missing kernel")
	}
	dir := t.TempDir()
	m, err := New(Options{Dir: filepath.Join(dir, "meta"), Binary: binary})
	if err != nil {
		t.Fatal("manager init failed")
	}
	defer m.Close(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := m.AddSubscriptionNamed(ctx, raw, "test")
	if err != nil {
		t.Fatal("subscription import failed:", err)
	}
	if result.Nodes < 1 {
		t.Fatal("no usable nodes")
	}
	t.Logf("imported nodes: %d", result.Nodes)
	result, err = m.RefreshSubscription(ctx, result.Provider)
	if err != nil {
		t.Fatal("subscription refresh failed:", err)
	}
	t.Logf("refreshed nodes: %d", result.Nodes)
}
func TestInterruptedDeleteBlocksUntilRetry(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	id := m.Subscriptions()[0].ID
	node := m.Nodes().Nodes[0].ID
	proxy := ""
	_, err := m.Bind(context.Background(), "a", node, func(p string) error { proxy = p; return nil })
	if err != nil {
		t.Fatal(err)
	}
	old := m.snapshot()
	old.PendingDelete = id
	if err = m.persist(old); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.state = old
	m.mu.Unlock()
	proxy = ""
	if _, err = m.AcquireAccount(context.Background(), "a"); !errors.Is(err, ErrBusy) {
		t.Fatal("pending admission", err)
	}
	core := &fakeCore{nodes: []coreNode{{Name: "shared/one", Type: "Http"}, {Name: "shared/two", Type: "Http"}}}
	restarted, err := newManager(Options{Dir: m.opts.Dir}, core)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close(context.Background())
	if _, err = restarted.AcquireAccount(context.Background(), "a"); !errors.Is(err, ErrBusy) {
		t.Fatal("restart admission", err)
	}
	err = restarted.RemoveSubscriptionAndUnbind(context.Background(), id, func(uid, expected string) (func() error, error) {
		prior := proxy
		proxy = ""
		return func() error { proxy = prior; return nil }, nil
	})
	if err != nil || len(restarted.Subscriptions()) != 0 || proxy != "" {
		t.Fatal("retry", err)
	}
	if release, err := restarted.AcquireAccount(context.Background(), "a"); err != nil {
		t.Fatal(err)
	} else {
		release()
	}
}
