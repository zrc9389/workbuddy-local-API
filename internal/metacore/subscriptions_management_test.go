package metacore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func seededSubscriptions(t *testing.T, count int) (*Manager, *fakeCore) {
	t.Helper()
	m, core := fixtureManager(t)
	core.nodes = []coreNode{{Name: "shared/one", Type: "Http"}, {Name: "shared/two", Type: "Http"}}
	for i := 0; i < count; i++ {
		id := "sub-" + string(rune('a'+i))
		if _, err := m.importBytes(context.Background(), id, []byte("fixture-"+id)); err != nil {
			t.Fatal(err)
		}
	}
	return m, core
}

func withStoredURL(t *testing.T, m *Manager, id, raw string) {
	t.Helper()
	if err := m.lock(); err != nil {
		t.Fatal(err)
	}
	defer m.unlock()
	next := m.snapshot()
	for i := range next.Providers {
		if next.Providers[i].ID == id {
			next.Providers[i].URL = raw
		}
	}
	if err := m.persist(next); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.state = next
	m.mu.Unlock()
}

func TestSubscriptionsBeyondTwoAndNodeFilter(t *testing.T) {
	m, _ := seededSubscriptions(t, 4)
	list := m.Subscriptions()
	if len(list) != 4 {
		t.Fatalf("subscription count = %d, want 4", len(list))
	}
	for _, subscription := range list {
		if subscription.NodeCount != 2 {
			t.Fatalf("provider %s nodes = %d", subscription.ID, subscription.NodeCount)
		}
	}
	if got := len(m.Nodes().Nodes); got != 8 {
		t.Fatalf("total nodes = %d, want 8", got)
	}
}

func TestDisableRemovesNodesAndProtectsBindings(t *testing.T) {
	m, _ := seededSubscriptions(t, 2)
	first := m.Subscriptions()[0]
	var node Node
	for _, candidate := range m.Nodes().Nodes {
		if candidate.Provider == first.ID {
			node = candidate
			break
		}
	}
	if node.ID == "" {
		t.Fatal("no node for first subscription")
	}
	if _, err := m.Bind(context.Background(), "bound-account", node.ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	disabled := false
	if _, err := m.UpdateSubscription(context.Background(), first.ID, nil, &disabled); !errors.Is(err, ErrSubscriptionInUse) {
		t.Fatalf("disable bound subscription = %v, want in use", err)
	}
	if err := m.DeleteAccountBinding(context.Background(), "bound-account"); err != nil {
		t.Fatal(err)
	}
	updated, err := m.UpdateSubscription(context.Background(), first.ID, nil, &disabled)
	if err != nil || updated.Enabled || updated.NodeCount != 0 {
		t.Fatalf("disabled subscription = %+v, %v", updated, err)
	}
	for _, n := range m.Nodes().Nodes {
		if n.Provider == first.ID {
			t.Fatal("disabled provider still exposes nodes")
		}
	}
	if len(m.Nodes().Nodes) != 2 {
		t.Fatalf("remaining nodes = %d, want 2", len(m.Nodes().Nodes))
	}
	enabled := true
	if _, err = m.UpdateSubscription(context.Background(), first.ID, nil, &enabled); err != nil {
		t.Fatal(err)
	}
	if len(m.Nodes().Nodes) != 4 {
		t.Fatalf("re-enabled nodes = %d, want 4", len(m.Nodes().Nodes))
	}
}

func TestRenameAndExplicitURLReveal(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	id := m.Subscriptions()[0].ID
	raw := "https://example.com/sub?token=private-token"
	withStoredURL(t, m, id, raw)
	if preview := m.Subscriptions()[0].URLPreview; preview == raw || strings.Contains(preview, "private-token") || strings.Contains(preview, "token") {
		t.Fatalf("preview leaked secret: %q", preview)
	}
	name := "主要线路"
	updated, err := m.UpdateSubscription(context.Background(), id, &name, nil)
	if err != nil || updated.Name != name {
		t.Fatalf("rename = %+v, %v", updated, err)
	}
	revealed, err := m.SubscriptionURL(id)
	if err != nil || revealed != raw {
		t.Fatalf("reveal = %q, %v", revealed, err)
	}
	long := strings.Repeat("长", 65)
	if _, err = m.UpdateSubscription(context.Background(), id, &long, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("overlong name accepted: %v", err)
	}
}

func TestRefreshByIDReplacesContentAndRemovesOldFile(t *testing.T) {
	m, _ := seededSubscriptions(t, 2)
	id := m.Subscriptions()[0].ID
	withStoredURL(t, m, id, "https://example.com/sub")
	oldFile := ""
	m.mu.Lock()
	for _, p := range m.state.Providers {
		if p.ID == id {
			oldFile = p.File
		}
	}
	m.mu.Unlock()
	m.fetchURL = func(context.Context, string) ([]byte, error) { return []byte("refreshed-content"), nil }
	result, err := m.RefreshSubscription(context.Background(), id)
	if err != nil || result.Provider != id || result.Nodes != 2 {
		t.Fatalf("refresh = %+v, %v", result, err)
	}
	if _, err = os.Stat(filepath.Join(m.opts.Dir, filepath.FromSlash(oldFile))); !os.IsNotExist(err) {
		t.Fatalf("previous provider file remained: %v", err)
	}
	if other := m.Subscriptions()[1]; other.ID == id {
		t.Fatal("refresh replaced wrong subscription")
	}
}

func TestRefreshFailureKeepsSubscriptionAndRecordsError(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	id := m.Subscriptions()[0].ID
	withStoredURL(t, m, id, "https://example.com/sub")
	m.fetchURL = func(context.Context, string) ([]byte, error) { return nil, errors.New("subscription download failed") }
	if _, err := m.RefreshSubscription(context.Background(), id); err == nil {
		t.Fatal("failed refresh accepted")
	}
	list := m.Subscriptions()
	if len(list) != 1 || list[0].LastError == "" {
		t.Fatalf("failure not recorded: %+v", list)
	}
	if err := m.RemoveSubscription(context.Background(), "missing"); !errors.Is(err, ErrSubscriptionNotFound) {
		t.Fatalf("missing delete = %v", err)
	}
}

func TestDeleteSubscriptionConflictAndCapacity(t *testing.T) {
	m, _ := seededSubscriptions(t, 2)
	first := m.Subscriptions()[0]
	var node Node
	for _, candidate := range m.Nodes().Nodes {
		if candidate.Provider == first.ID {
			node = candidate
			break
		}
	}
	if node.ID == "" {
		t.Fatal("no node for first subscription")
	}
	if _, err := m.Bind(context.Background(), "bound-account", node.ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveSubscription(context.Background(), first.ID); !errors.Is(err, ErrSubscriptionInUse) {
		t.Fatalf("delete bound subscription = %v, want in use", err)
	}
	if err := m.DeleteAccountBinding(context.Background(), "bound-account"); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveSubscription(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}
	if got := m.Subscriptions(); len(got) != 1 {
		t.Fatalf("subscriptions after delete = %d, want 1", len(got))
	}
	if got := len(m.Nodes().Nodes); got != 2 {
		t.Fatalf("nodes after delete = %d, want 2", got)
	}
}

func TestDisabledProviderIsExcludedFromRenderedConfig(t *testing.T) {
	state := diskState{Version: 2, Providers: []provider{
		{ID: "enabled", File: "providers/enabled.txt", Name: "enabled", Enabled: true},
		{ID: "disabled", File: "providers/disabled.txt", Name: "disabled", Enabled: false},
	}}
	raw, err := renderConfig(state, "127.0.0.1:1", "secret")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, `"disabled"`) || !strings.Contains(text, `"enabled"`) {
		t.Fatalf("renderConfig ignored enabled state: %s", text)
	}
	if !validState(state) {
		t.Fatal("valid disabled provider state rejected")
	}
}

func TestProviderImportAndFetcherSeam(t *testing.T) {
	m, _ := fixtureManager(t)
	m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("downloaded"), nil })
	result, err := m.AddSubscriptionNamed(context.Background(), "https://example.com/sub?token=secret", "主线路")
	if err != nil || result.Nodes != 2 {
		t.Fatalf("add named = %+v, %v", result, err)
	}
	list := m.Subscriptions()
	if len(list) != 1 || list[0].Name != "主线路" || !list[0].Enabled || !list[0].HasURL {
		t.Fatalf("added subscription = %+v", list)
	}
	if strings.Contains(list[0].URLPreview, "secret") || strings.Contains(list[0].URLPreview, "token") {
		t.Fatalf("preview leaked token: %q", list[0].URLPreview)
	}
	if _, err := m.importBytes(context.Background(), "sub-b", []byte("fixture-b")); err != nil {
		t.Fatal(err)
	}
	if got := len(m.Subscriptions()); got != 2 {
		t.Fatalf("subscriptions = %d, want 2", got)
	}
}

func TestRenameWorksWithIdleStoppedCore(t *testing.T) {
	m, core := seededSubscriptions(t, 2)
	if err := core.Stop(); err != nil {
		t.Fatal(err)
	}
	id := m.Subscriptions()[0].ID
	name := "空闲改名"
	updated, err := m.UpdateSubscription(context.Background(), id, &name, nil)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != name || updated.NodeCount != 2 {
		t.Fatalf("idle rename = %+v", updated)
	}
	if core.Alive() {
		t.Fatal("rename unnecessarily restarted the sidecar")
	}
}

func TestRemoveSubscriptionFailureKeepsProviderFileAndNodes(t *testing.T) {
	m, core := seededSubscriptions(t, 2)
	id := m.Subscriptions()[0].ID
	file := ""
	m.mu.Lock()
	for _, p := range m.state.Providers {
		if p.ID == id {
			file = p.File
		}
	}
	m.mu.Unlock()
	before := len(m.Nodes().Nodes)
	core.mu.Lock()
	core.reject = true
	core.mu.Unlock()
	err := m.RemoveSubscription(context.Background(), id)
	if !errors.Is(err, ErrRollback) && !errors.Is(err, ErrApply) {
		t.Fatalf("failed delete = %v", err)
	}
	if len(m.Subscriptions()) != 2 {
		t.Fatal("failed delete removed subscription state")
	}
	if got := len(m.Nodes().Nodes); got != before {
		t.Fatalf("failed delete changed cached nodes: %d -> %d", before, got)
	}
	if _, statErr := os.Stat(filepath.Join(m.opts.Dir, filepath.FromSlash(file))); statErr != nil {
		t.Fatalf("failed delete removed provider file: %v", statErr)
	}
}

func TestSuccessfulRefreshClearsPreviousError(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	id := m.Subscriptions()[0].ID
	withStoredURL(t, m, id, "https://example.com/sub")
	m.setFetcher(func(context.Context, string) ([]byte, error) { return nil, errors.New("temporary failure") })
	if _, err := m.RefreshSubscription(context.Background(), id); err == nil {
		t.Fatal("failed refresh accepted")
	}
	if m.Subscriptions()[0].LastError == "" {
		t.Fatal("failure not recorded")
	}
	m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("fresh"), nil })
	if _, err := m.RefreshSubscription(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if got := m.Subscriptions()[0].LastError; got != "" {
		t.Fatalf("stale error retained: %q", got)
	}
}

func TestSubscriptionLimitStillEnforced(t *testing.T) {
	m, _ := seededSubscriptions(t, maxProviders)
	if got := len(m.Subscriptions()); got != maxProviders {
		t.Fatalf("subscriptions = %d, want %d", got, maxProviders)
	}
	if _, err := m.importBytes(context.Background(), "sub-overflow", []byte("overflow")); err == nil {
		t.Fatal("subscription beyond maxProviders accepted")
	}
}

func TestReimportSameURLKeepsCustomName(t *testing.T) {
	m, _ := fixtureManager(t)
	m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("downloaded"), nil })
	raw := "https://example.com/sub"
	if _, err := m.AddSubscriptionNamed(context.Background(), raw, "主力线路"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddSubscriptionNamed(context.Background(), raw, ""); err != nil {
		t.Fatal(err)
	}
	list := m.Subscriptions()
	if len(list) != 1 || list[0].Name != "主力线路" {
		t.Fatalf("reimport changed name: %+v", list)
	}
}

func TestLegacyStateMigratesToEnabledSubscriptions(t *testing.T) {
	dir := t.TempDir()
	legacy := `{"version":1,"providers":[{"id":"legacy","file":"providers/legacy.txt"}],"bindings":[]}`
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "providers"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "providers", "legacy.txt"), []byte("legacy"), 0600); err != nil {
		t.Fatal(err)
	}
	core := &fakeCore{nodes: []coreNode{{Name: "legacy/one", Type: "Http"}}}
	m, err := newManager(Options{Dir: dir}, core)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close(context.Background()) })
	list := m.Subscriptions()
	if len(list) != 1 || !list[0].Enabled || list[0].Name == "" {
		t.Fatalf("migrated subscription = %+v", list)
	}
}
