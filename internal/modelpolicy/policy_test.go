package modelpolicy

import (
	"path/filepath"
	"testing"
)

func TestPolicyPersistentAndNoMutation(t *testing.T) {
	p := filepath.Join(t.TempDir(), "models.json")
	s, e := Open(p)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Set("global:test", Rule{Disabled: true}); e != nil {
		t.Fatal(e)
	}
	s2, _ := Open(p)
	if !s2.Disabled("global:test") {
		t.Fatal("lost disable")
	}
	input := []map[string]any{{"id": "global:test"}, {"id": "other", "context_length": 10}}
	s.Set("other", Rule{ContextLength: 123})
	out := s.Apply(input)
	if len(out) != 1 || out[0]["context_length"] != 123 {
		t.Fatal(out)
	}
	if input[1]["context_length"] != 10 {
		t.Fatal("mutated shared catalog")
	}
}
