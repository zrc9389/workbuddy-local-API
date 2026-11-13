package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestParseSystemAndMessageContent(t *testing.T) {
	// 1. String system
	rawStr := json.RawMessage(`"You are a helpful assistant."`)
	if s := parseSystemString(rawStr); s != "You are a helpful assistant." {
		t.Fatalf("unexpected system string: %s", s)
	}

	// 2. Block system
	rawBlocks := json.RawMessage(`[{"type":"text","text":"Line 1"},{"type":"text","text":"Line 2"}]`)
	if s := parseSystemString(rawBlocks); s != "Line 1\nLine 2" {
		t.Fatalf("unexpected block system: %s", s)
	}

	// 3. Message content blocks
	msgBlocks := json.RawMessage(`[{"type":"text","text":"Hello world"}]`)
	if s := parseMessageContent(msgBlocks); s != "Hello world" {
		t.Fatalf("unexpected msg content: %s", s)
	}
}

func TestAnthropicMessageConversionPreservesTextAndTools(t *testing.T) {
	text := anthropicMessageToOpenAI(anthropicMsg{Role: "assistant", Content: json.RawMessage(`[{"type":"thinking","thinking":"reason"},{"type":"text","text":"answer"}]`)})
	if len(text) != 1 || text[0]["role"] != "assistant" {
		t.Fatalf("assistant text conversion = %#v", text)
	}
	toolUse := anthropicMessageToOpenAI(anthropicMsg{Role: "assistant", Content: json.RawMessage(`[{"type":"tool_use","id":"call-1","name":"lookup","input":{"q":"x"}}]`)})
	calls, ok := toolUse[0]["tool_calls"].([]any)
	if !ok || len(calls) != 1 {
		t.Fatalf("tool_use conversion = %#v", toolUse)
	}
	toolResult := anthropicMessageToOpenAI(anthropicMsg{Role: "user", Content: json.RawMessage(`[ {"type":"tool_result","tool_use_id":"call-1","content":"done"} ]`)})
	if len(toolResult) != 1 || toolResult[0]["role"] != "tool" || toolResult[0]["tool_call_id"] != "call-1" {
		t.Fatalf("tool_result conversion = %#v", toolResult)
	}
}

func TestClaudeMessagesMissingModel(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest("POST", "/v1/messages", strings.NewReader(`{"messages":[{"role":"user","content":"hi"}]}`))
	w := httptest.NewRecorder()

	h.claudeMessages(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model, got %d", w.Code)
	}
}

func TestClaudeMessagesLargeRequestUsesConvertedBody(t *testing.T) {
	marker := "large-anthropic-tail-marker"
	body := "{\"model\":\"claude-test\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"" + strings.Repeat("x", 300<<10) + marker + "\"}]}"
	var sent []byte
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var err error
		sent, err = io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fixture.example", BillingBaseCN: "https://fixture.example"}
	p := testPoolWith(&auth.Auth{UID: "claude-large", AccessToken: "token", ExpiresAt: 9999999999})
	h := NewHandler(Config{Pool: p, Upstream: up, MaxBodyBytes: 16 << 20})
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if bytes.Contains(sent, []byte("\"system\":")) || !bytes.Contains(sent, []byte("\"stream\":true")) || !bytes.Contains(sent, []byte(marker)) {
		t.Fatalf("upstream did not receive converted Chat body: %.160s", sent)
	}
	var converted map[string]any
	if err := json.Unmarshal(sent, &converted); err != nil {
		t.Fatalf("upstream body is invalid JSON: %v", err)
	}
	if _, ok := converted["messages"]; !ok {
		t.Fatal("messages missing from converted body")
	}
}
