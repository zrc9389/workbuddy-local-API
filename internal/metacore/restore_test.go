package metacore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

func TestRestoreAccountBindingMergeAndRollback(t *testing.T) {
	ctx := context.Background()
	m, _ := fixtureManager(t)
	const url = "https://example.com/sub?token=fixture"
	fetches := 0
	m.setFetcher(func(context.Context, string) ([]byte, error) { fetches++; return []byte("fixture"), nil })
	var proxy string
	if err := m.RestoreAccountBinding(ctx, "first", url, "fixture/one", func(p string) error { proxy = p; return nil }); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(proxy, "127.0.0.1:") || !m.IsBound("first") || fetches != 1 {
		t.Fatal("restore failed")
	}
	before := m.snapshot()
	diskBefore, err := os.ReadFile(filepath.Join(m.opts.Dir, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := m.RestoreAccountBinding(ctx, "first", url, "fixture/two", func(string) error { t.Fatal("overwrote binding"); return nil }); err == nil {
		t.Fatal("existing binding replaced")
	}
	if err := m.RestoreAccountBinding(ctx, "second", url, "fixture/one", func(string) error { t.Fatal("reused occupied node"); return nil }); err == nil {
		t.Fatal("occupied node accepted")
	}
	if err := m.RestoreAccountBinding(ctx, "second", url, "fixture/two", func(string) error { return errors.New("save failed") }); err == nil {
		t.Fatal("write failure ignored")
	}
	after := m.snapshot()
	diskAfter, err := os.ReadFile(filepath.Join(m.opts.Dir, "state.json"))
	if err != nil || string(diskAfter) != string(diskBefore) {
		t.Fatal("failed restore changed persisted state")
	}
	if fetches != 1 || len(after.Providers) != 1 || len(after.Bindings) != 1 || after.Bindings[0] != before.Bindings[0] || after.Providers[0] != before.Providers[0] {
		t.Fatal("existing state changed")
	}
	if err := m.RestoreAccountBinding(ctx, "second", url, "fixture/two", func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if fetches != 1 || !m.IsBound("second") {
		t.Fatal("existing subscription was not reused")
	}
}

func TestRestoreSavesNewLocalProxyAndPersistsBinding(t *testing.T) {
	m, _ := fixtureManager(t)
	m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("fixture"), nil })
	path := filepath.Join(t.TempDir(), "workbuddy-user.json")
	a := &auth.Auth{UID: "user", AccessToken: "fixture-token", ProxyURL: "http://old:1", FilePath: path}
	if err := m.RestoreAccountBinding(context.Background(), "user", "https://example.com/sub", "fixture/one", a.SetProxyAndSave); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := auth.Parse(raw)
	if err != nil || !strings.Contains(loaded.ProxyURLValue(), "127.0.0.1:") || loaded.ProxyURLValue() == "http://old:1" {
		t.Fatal("new listener not persisted")
	}
	fresh, err := newManager(Options{Dir: m.opts.Dir}, &fakeCore{nodes: []coreNode{{Name: "fixture/one", Type: "Http"}, {Name: "fixture/two", Type: "Http"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close(context.Background())
	if !fresh.IsBound("user") {
		t.Fatal("binding not persisted")
	}
}

func TestRestoreNewSubscriptionRollsBackOnFailure(t *testing.T) {
	for _, missing := range []bool{true, false} {
		t.Run(map[bool]string{true: "missing node", false: "credential write"}[missing], func(t *testing.T) {
			m, _ := fixtureManager(t)
			m.setFetcher(func(context.Context, string) ([]byte, error) { return []byte("fixture"), nil })
			name := "fixture/one"
			if missing {
				name = "missing"
			}
			err := m.RestoreAccountBinding(context.Background(), "new", "https://example.com/sub", name, func(string) error { return errors.New("write failed") })
			if err == nil || len(m.snapshot().Providers) != 0 || len(m.snapshot().Bindings) != 0 {
				t.Fatal("failed restore left state")
			}
			entries, err := os.ReadDir(filepath.Join(m.opts.Dir, "providers"))
			if err != nil || len(entries) != 0 {
				t.Fatal("failed restore left new provider file")
			}
		})
	}
}
