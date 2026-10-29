package metacore

import "testing"

func TestExportAccountBindingUsesMatchingProvider(t *testing.T) {
	m := &Manager{state: diskState{
		Providers: []provider{{ID: "a", URL: "https://fixture.invalid/sub?key=fixture"}},
		Bindings:  []bindingRecord{{Binding: Binding{UID: "user", Node: "node"}, Provider: "a", Name: "fixture-node"}},
	}}
	url, node, ok := m.ExportAccountBinding("user")
	if !ok || url != "https://fixture.invalid/sub?key=fixture" || node != "fixture-node" {
		t.Fatal("missing binding")
	}
	if _, _, ok = m.ExportAccountBinding("other"); ok {
		t.Fatal("exported another account's binding")
	}
}
