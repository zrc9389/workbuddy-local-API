package upstream

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

func TestAggregateSpoolRejectsUpstreamError(t *testing.T) {
	data := "data: {\"choices\":[{\"delta\":{\"content\":\"" + strings.Repeat("x", responseMemoryThreshold+1) + "\"}}]}\n\ndata: {\"error\":{\"message\":\"sensitive upstream details\"}}\n\n"
	result, store, err := AggregateSpool(strings.NewReader(data))
	if err == nil || result != nil || store != nil {
		t.Fatalf("error event accepted: result=%v store=%v err=%v", result, store, err)
	}
	if strings.Contains(err.Error(), "sensitive upstream details") {
		t.Fatal("upstream error details leaked")
	}
}

func TestAggregateSpoolLargeFieldsAndCleanup(t *testing.T) {
	text := strings.Repeat("abcdef", 200000)
	var s strings.Builder
	for i := 0; i < len(text); i += 6000 {
		end := i + 6000
		if end > len(text) {
			end = len(text)
		}
		fmt.Fprintf(&s, `data: {"choices":[{"delta":{"content":%q,"reasoning_content":%q,"tool_calls":[{"index":0,"id":"call","function":{"name":"run","arguments":%q}}]}}]}`+"\n\n", text[i:end], text[i:end], text[i:end])
	}
	s.WriteString("data: [DONE]\n\n")
	result, store, err := AggregateSpool(strings.NewReader(s.String()))
	if err != nil {
		t.Fatal(err)
	}
	msg := result["choices"].([]any)[0].(map[string]any)["message"].(map[string]any)
	call := msg["tool_calls"].([]map[string]any)[0]
	fn := call["function"].(map[string]any)
	for _, v := range []any{msg["content"], msg["reasoning_content"], fn["arguments"]} {
		textFile, ok := v.(*SpoolText)
		if !ok {
			t.Fatalf("large value not spooled: %T", v)
		}
		h := sha256.New()
		n, err := io.Copy(h, textFile.Reader())
		if err != nil || n != int64(len(text)) || fmt.Sprintf("%x", h.Sum(nil)) != fmt.Sprintf("%x", sha256.Sum256([]byte(text))) {
			t.Fatal("value changed", n, err)
		}
	}
	paths := []string{}
	for _, f := range store.files {
		paths = append(paths, f.Name())
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if _, err = os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("spool remains: %s", path)
		}
	}
}
