package modelpolicy

import "testing"

func TestCNPrefixCannotBypassPolicy(t *testing.T) {
	s, _ := Open("")
	s.Set("glm-test", Rule{Disabled: true})
	for _, id := range []string{"glm-test", "cn:glm-test", "GLM-TEST"} {
		if !s.Disabled(id) {
			t.Fatalf("alias escaped disable: %s", id)
		}
	}
	if s.Disabled("global:glm-test") {
		t.Fatal("CN policy affected global")
	}
	s.Set("cn:glm-test", Rule{Disabled: false})
	if s.Disabled("glm-test") {
		t.Fatal("alias change failed")
	}
}
