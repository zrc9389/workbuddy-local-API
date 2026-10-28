package server

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCompatibilityAndIndependence(t *testing.T) {
	tests := []string{`{"s":"汉字\\n\\u003c","nested":[{"n":3,"b":true,"empty":null}],"nil":null}`, `{"parts":[{"type":"input_image","image_url":"` + strings.Repeat("Q", 1024*1024) + `"}]}`}
	for _, raw := range tests {
		var in map[string]any
		if err := json.Unmarshal([]byte(raw), &in); err != nil {
			t.Fatal(err)
		}
		out := cloneMap(in)
		if !reflect.DeepEqual(out, in) {
			t.Fatal("different JSON tree")
		}
		if nested, ok := out["nested"].([]any); ok {
			nested[0].(map[string]any)["n"] = float64(999)
			if in["nested"].([]any)[0].(map[string]any)["n"] == float64(999) {
				t.Fatal("alias")
			}
		}
	}
	custom := map[string]any{"n": json.Number("2"), "x": []int{1, 2}}
	raw, _ := json.Marshal(custom)
	var want map[string]any
	json.Unmarshal(raw, &want)
	if !reflect.DeepEqual(cloneMap(custom), want) {
		t.Fatal("fallback mismatch")
	}
}
func BenchmarkCloneLargeString(b *testing.B) {
	v := map[string]any{"content": strings.Repeat("Q", 8<<20)}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cloneMap(v)
	}
}

func BenchmarkLegacyCloneLargeString(b *testing.B) {
	v := map[string]any{"content": strings.Repeat("Q", 8<<20)}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		raw, _ := json.Marshal(v)
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
	}
}
func TestInvalidUTF8Normalizes(t *testing.T) {
	v := map[string]any{string([]byte{0xff}): string([]byte{0xfe})}
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	if err = json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cloneMap(v), want) {
		t.Fatal("invalid UTF-8 normalization changed")
	}
}
