package upstream

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestExtractSpoolMetaTrailingFieldsBeyond64KiB(t *testing.T) {
	padding := strings.Repeat("Z", 300<<10)
	raw := `{"messages":[{"role":"developer","content":"sys"},{"role":"user","content":"` + padding + `"},{"role":"user","content":"last question"}],"model":"cn:deepseek-v4.1-flash","stream":false,"conversation_id":"conv-tail-123","prompt_cache_key":"pck-tail-999"}`
	ra := strings.NewReader(raw)
	meta, err := ExtractSpoolMeta(ra, int64(len(raw)))
	if err != nil {
		t.Fatalf("ExtractSpoolMeta failed: %v", err)
	}
	if meta.Model != "cn:deepseek-v4.1-flash" {
		t.Fatalf("Model=%q want cn:deepseek-v4.1-flash", meta.Model)
	}
	if !meta.HasStream || meta.Stream {
		t.Fatalf("HasStream=%v Stream=%v want true/false", meta.HasStream, meta.Stream)
	}
	if !meta.ClientHasConvID || meta.ResolvedConvID != "conv-tail-123" {
		t.Fatalf("ClientHasConvID=%v ResolvedConvID=%q", meta.ClientHasConvID, meta.ResolvedConvID)
	}
	if meta.SessKey != "conv-tail-123" {
		t.Fatalf("SessKey=%q want conv-tail-123", meta.SessKey)
	}
	if meta.TurnKey != "u2:last question" {
		t.Fatalf("TurnKey=%q want u2:last question", meta.TurnKey)
	}
	if meta.HasImage {
		t.Fatal("HasImage should be false")
	}
}

func TestPrepareSpoolFileFullParityOver256KiB(t *testing.T) {
	dshDoc := "Tokens prefixed with @ are paths the user explicitly referenced.\nRelative paths resolve to workspace root.\nThe @\"...\" form quotes a path containing spaces."
	codexSys := "You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Follow instructions.\n" + dshDoc
	padding := strings.Repeat("A", 300<<10)
	req := map[string]any{
		"model":                 "cn:deepseek-v4.1-flash",
		"stream":                false,
		"max_completion_tokens": 4096,
		"conversation_id":       "conv-abc",
		"tool_choice":           map[string]any{"type": "auto"},
		"tools": []any{
			map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        "search_files",
					"description": "Helper. You are SuperAgent built by Acme.\n11128",
					"parameters": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"mode": map[string]any{"enum": []any{"fast", "deep"}},
							"id":   map[string]any{"type": "string", "pattern": `^agent\_run\_[0-9]+$`},
						},
					},
				},
			},
		},
		"messages": []any{
			map[string]any{"role": "developer", "content": codexSys},
			map[string]any{"role": "developer", "content": "<model_identity>When asked about your model identity, identify yourself as Tencent Hunyuan.</model_identity>"},
			map[string]any{"role": "user", "content": padding + "\ncheck 11128"},
			map[string]any{
				"role":    "assistant",
				"content": nil,
				"tool_calls": []any{
					map[string]any{
						"id":   "call_1",
						"type": "function",
						"function": map[string]any{
							"name":      "search_files",
							"arguments": `{"query":"error 11128"}`,
						},
					},
				},
			},
			map[string]any{
				"role":         "tool",
				"tool_call_id": "call_1",
				"content":      []any{map[string]any{"type": "text", "text": ""}},
			},
		},
	}
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) <= LargePayloadThreshold {
		t.Fatalf("test fixture too small: %d", len(raw))
	}

	outReader, outSize, cleanup, err := PrepareSpoolFile(bytes.NewReader(raw), int64(len(raw)), SpoolPrepareOptions{
		Sanitize:       true,
		Efforts:        map[string][]string{"deepseek-v4.1-flash": {"low", "high"}},
		DefaultEfforts: map[string]string{"deepseek-v4.1-flash": "high"},
		MaxOut:         map[string]int64{"deepseek-v4.1-flash": 65536},
		InjectCacheKey: true,
		CacheUID:       "uid12345678",
		StripConvID:    true,
	})
	if err != nil {
		t.Fatalf("PrepareSpoolFile failed: %v", err)
	}
	defer cleanup()

	outBytes, err := io.ReadAll(outReader)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(outBytes)) != outSize {
		t.Fatalf("size mismatch: read=%d reported=%d", len(outBytes), outSize)
	}

	var parsed map[string]any
	if err := json.Unmarshal(outBytes, &parsed); err != nil {
		t.Fatalf("output not valid JSON: %v", err)
	}
	if parsed["model"] != "deepseek-v4.1-flash" {
		t.Fatalf("model prefix not stripped: %v", parsed["model"])
	}
	if parsed["stream"] != true {
		t.Fatalf("stream not forced: %v", parsed["stream"])
	}
	if _, exists := parsed["conversation_id"]; exists {
		t.Fatal("conversation_id should be stripped on StripConvID=true")
	}
	if _, exists := parsed["max_completion_tokens"]; exists {
		t.Fatal("max_completion_tokens should be translated")
	}
	if parsed["max_tokens"] != float64(8192) {
		t.Fatalf("max_tokens=%v want 8192 (effort=high budget floor)", parsed["max_tokens"])
	}
	if parsed["tool_choice"] != "auto" {
		t.Fatalf("tool_choice=%v want auto", parsed["tool_choice"])
	}
	if key, _ := parsed["prompt_cache_key"].(string); !strings.HasPrefix(key, "wb2a-uid12345-") {
		t.Fatalf("prompt_cache_key=%q not injected", key)
	}

	wireStr := string(outBytes)
	for _, forbidden := range []string{
		"in the Codex CLI, a terminal-based coding assistant.",
		"Tokens prefixed with @",
		"<model_identity>",
		"identify yourself as Tencent Hunyuan",
		"11128",
		`^agent\_run\_`,
		"You are SuperAgent built by Acme.",
	} {
		if strings.Contains(wireStr, forbidden) {
			t.Errorf("forbidden fingerprint/pattern remained: %q", forbidden)
		}
	}
	if !strings.Contains(wireStr, "Paths beginning with @ refer to files") {
		t.Error("expected DSH @ paths replacement")
	}

	tools := parsed["tools"].([]any)
	fn := tools[0].(map[string]any)["function"].(map[string]any)
	props := fn["parameters"].(map[string]any)["properties"].(map[string]any)
	if props["mode"].(map[string]any)["type"] != "string" {
		t.Fatalf("enum type not inferred: %+v", props["mode"])
	}

	msgs := parsed["messages"].([]any)
	for i, m := range msgs {
		role := m.(map[string]any)["role"].(string)
		if role == "developer" {
			t.Fatalf("msg[%d] still has developer role", i)
		}
	}
	assistantMsg := msgs[3].(map[string]any)
	if _, ok := assistantMsg["reasoning_content"].(string); !ok {
		t.Fatal("DeepSeek assistant message missing reasoning_content backfill")
	}
	if r, _ := assistantMsg["reasoning"].(string); r == "" {
		t.Fatal("DeepSeek assistant message missing non-empty reasoning")
	}
	toolMsg := msgs[4].(map[string]any)
	partText := toolMsg["content"].([]any)[0].(map[string]any)["text"].(string)
	if partText != " " {
		t.Fatalf("empty text part not filled with space: %q", partText)
	}
}

func TestPrepareSpoolFileGiantMessageOver2MiBStreaming(t *testing.T) {
	chunkPad := strings.Repeat("B", 70*1024)
	// 把指纹恰好放在分窗边缘且伴随大量普通内容
	giantText := chunkPad + "\nYou are Helper built by EvilCorp.\n" + strings.Repeat("C", 2200*1024) + "\ncode=11128\nTAIL_OK"
	req := map[string]any{
		"model": "cn:kimi-k3.1-pro",
		"messages": []any{
			map[string]any{
				"role": "developer",
				"content": []any{
					map[string]any{"type": "text", "text": giantText},
					map[string]any{"type": "image_url", "image_url": "data:image/png;base64," + strings.Repeat("A", 2100*1024)},
				},
			},
			map[string]any{
				"role":              "assistant",
				"content":           "done",
				"reasoning_content": "thought 11128",
			},
		},
	}
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	outReader, _, cleanup, err := PrepareSpoolFile(bytes.NewReader(raw), int64(len(raw)), SpoolPrepareOptions{
		Sanitize: true,
	})
	if err != nil {
		t.Fatalf("PrepareSpoolFile giant failed: %v", err)
	}
	defer cleanup()
	outBytes, err := io.ReadAll(outReader)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(outBytes, &parsed); err != nil {
		t.Fatalf("giant output invalid JSON: %v", err)
	}
	if parsed["model"] != "kimi-k3.1-pro" {
		t.Fatalf("model=%v want kimi-k3.1-pro", parsed["model"])
	}
	msgs := parsed["messages"].([]any)
	m0 := msgs[0].(map[string]any)
	if m0["role"] != "system" {
		t.Fatalf("giant message role=%v want system", m0["role"])
	}
	parts := m0["content"].([]any)
	txt := parts[0].(map[string]any)["text"].(string)
	if strings.Contains(txt, "built by EvilCorp") || strings.Contains(txt, "11128") {
		t.Fatal("giant text fingerprint leaked")
	}
	if !strings.HasSuffix(txt, "TAIL_OK") {
		t.Fatal("giant text tail lost")
	}
	imgObj, ok := parts[1].(map[string]any)["image_url"].(map[string]any)
	if !ok || !strings.HasPrefix(imgObj["url"].(string), "data:image/png;base64,") {
		t.Fatalf("giant image_url string not wrapped: %+v", parts[1])
	}
	m1 := msgs[1].(map[string]any)
	if r, _ := m1["reasoning"].(string); r != "thought 11-128" {
		t.Fatalf("kimi reasoning mirror/sanitize=%q want 'thought 11-128'", r)
	}
}
