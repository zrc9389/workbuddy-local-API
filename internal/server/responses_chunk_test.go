package server

import (
	"encoding/json"
	"errors"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesStreamChunksLargeTextAndToolArguments(t *testing.T) {
	text := strings.Repeat("界\\\"x", 12000)
	args := strings.Repeat("a界", 20000)
	response := map[string]any{"id": "resp_test", "status": "completed", "output_text": text, "output": []any{
		map[string]any{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "tool", "arguments": args, "status": "completed"},
		map[string]any{"type": "message", "id": "msg_1", "content": []any{map[string]any{"type": "output_text", "text": text}}},
	}}
	rec := httptest.NewRecorder()
	if err := writeResponsesStream(rec, response); err != nil {
		t.Fatal(err)
	}
	var textParts, argParts []string
	var complete map[string]any
	for _, event := range strings.Split(rec.Body.String(), "\n\n") {
		for _, line := range strings.Split(event, "\n") {
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var v map[string]any
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &v); err != nil {
				t.Fatal(err)
			}
			switch v["type"] {
			case "response.output_text.delta":
				textParts = append(textParts, v["delta"].(string))
			case "response.function_call_arguments.delta":
				argParts = append(argParts, v["delta"].(string))
			case "response.completed":
				complete = v["response"].(map[string]any)
			}
		}
	}
	if len(textParts) < 2 || strings.Join(textParts, "") != text {
		t.Fatalf("text chunks=%d or content changed", len(textParts))
	}
	if len(argParts) < 2 || strings.Join(argParts, "") != args {
		t.Fatalf("argument chunks=%d or content changed", len(argParts))
	}
	if complete["output_text"] != text {
		t.Fatal("completed response changed")
	}
}

func TestResponseDeltaChunksSpoolTextAndWriteFailure(t *testing.T) {
	text := strings.Repeat("文本🙂", 50000)
	payload, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": text}}}})
	if err != nil {
		t.Fatal(err)
	}
	response, spool, err := upstream.AggregateSpool(strings.NewReader("data: " + string(payload) + "\n\ndata: [DONE]\n\n"))
	if err != nil {
		t.Fatal(err)
	}
	defer spool.Close()
	choices := response["choices"].([]any)
	content := choices[0].(map[string]any)["message"].(map[string]any)["content"]
	if _, ok := content.(*upstream.SpoolText); !ok {
		t.Fatalf("expected spooled content: %T", content)
	}
	var parts []string
	if err := writeResponseDeltaChunks(content, func(v any) error { parts = append(parts, v.(string)); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(parts) < 2 || strings.Join(parts, "") != text {
		t.Fatal("spooled text changed")
	}
	sentinel := errors.New("write failed")
	count := 0
	err = writeResponseDeltaChunks(content, func(any) error { count++; return sentinel })
	if !errors.Is(err, sentinel) || count != 1 {
		t.Fatalf("error=%v calls=%d", err, count)
	}
}

func TestResponsesStreamChunksCustomToolInput(t *testing.T) {
	input := strings.Repeat("补丁🙂", 10000)
	response := map[string]any{"id": "resp_custom", "output": []any{map[string]any{"type": "custom_tool_call", "id": "ct_1", "input": input}}, "output_text": ""}
	rec := httptest.NewRecorder()
	if err := writeResponsesStream(rec, response); err != nil {
		t.Fatal(err)
	}
	var parts []string
	for _, line := range strings.Split(rec.Body.String(), "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var v map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &v); err != nil {
			t.Fatal(err)
		}
		if v["type"] == "response.custom_tool_call_input.delta" {
			parts = append(parts, v["delta"].(string))
		}
	}
	if len(parts) < 2 || strings.Join(parts, "") != input {
		t.Fatal("custom tool input changed")
	}
}

func TestResponsesCreatedEventDoesNotMutateCompletedOutput(t *testing.T) {
	output := []any{map[string]any{"type": "function_call", "id": "fc", "arguments": "{}"}}
	response := map[string]any{"id": "resp", "status": "completed", "output": output, "output_text": "ok"}
	rec := httptest.NewRecorder()
	if err := writeResponsesStream(rec, response); err != nil {
		t.Fatal(err)
	}
	if response["status"] != "completed" || response["output_text"] != "ok" || len(response["output"].([]any)) != 1 {
		t.Fatal("original response mutated")
	}
}

func BenchmarkResponsesCreatedCopy(b *testing.B) {
	items := make([]any, 10000)
	for i := range items {
		items[i] = map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": "value"}}}
	}
	response := map[string]any{"id": "resp", "status": "completed", "output": items, "output_text": "value"}
	b.Run("previous_deep_clone", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			created := cloneMap(response)
			created["output"] = []any{}
		}
	})
	b.Run("shallow_copy", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			created := make(map[string]any, len(response))
			for k, v := range response {
				created[k] = v
			}
			created["output"] = []any{}
		}
	})
}
