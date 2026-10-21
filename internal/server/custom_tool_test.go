package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// custom(freeform) 工具（如 apply_patch）应被降级成单字段 function 交给上游，
// 上游返回的 tool_call 再还原成 Responses 的 custom_tool_call。
func TestResponsesAcceptsCustomTool(t *testing.T) {
	var outbound map[string]any
	customSSE := "data: {\"id\":\"chatcmpl-ct\",\"object\":\"chat.completion.chunk\",\"created\":1753600000,\"model\":\"glm-5.2\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"id\":\"call_ct\",\"type\":\"function\",\"function\":{\"name\":\"apply_patch\",\"arguments\":\"{\\\"input\\\":\\\"*** Begin Patch\\\\n*** End Patch\\\"}\"},\"index\":0}]}}]}\n\n" +
		"data: {\"id\":\"chatcmpl-ct\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n" +
		"data: [DONE]\n\n"
	up := &upstream.Client{
		HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &outbound)
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(customSSE))}, nil
		})},
		ChatBaseCN: "https://fake.example",
	}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"glm-5.2",
		"input":"patch it",
		"tools":[{"type":"custom","name":"apply_patch","description":"freeform patch",
		          "format":{"type":"grammar","syntax":"lark","definition":"start: /(.|\\n)+/"}}],
		"tool_choice":"auto"
	}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}

	tools, _ := outbound["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools=%#v", tools)
	}
	entry, _ := tools[0].(map[string]any)
	if entry["type"] != "function" {
		t.Fatalf("custom tool must be downgraded to function: %#v", entry)
	}
	fn, _ := entry["function"].(map[string]any)
	if fn["name"] != "apply_patch" {
		t.Errorf("name=%v", fn["name"])
	}
	params, _ := fn["parameters"].(map[string]any)
	props, _ := params["properties"].(map[string]any)
	if _, ok := props["input"]; !ok {
		t.Errorf("downgraded schema must expose input: %#v", params)
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	output, _ := resp["output"].([]any)
	if len(output) != 1 {
		t.Fatalf("output=%#v", output)
	}
	call, _ := output[0].(map[string]any)
	if call["type"] != "custom_tool_call" {
		t.Fatalf("want custom_tool_call, got %#v", call)
	}
	if call["call_id"] != "call_ct" {
		t.Errorf("call_id=%v", call["call_id"])
	}
	input, _ := call["input"].(string)
	if !strings.Contains(input, "*** Begin Patch") {
		t.Errorf("input should be raw freeform text: %#v", call["input"])
	}
}

// 非 function / 非 custom 的内置工具仍应被明确拒绝。
func TestResponsesRejectsBuiltinTool(t *testing.T) {
	up := &upstream.Client{
		HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
		})},
		ChatBaseCN: "https://fake.example",
	}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"glm-5.2","input":"hi","tools":[{"type":"web_search"}]
	}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "does not expose Responses built-in tool") {
		t.Errorf("body=%s", rec.Body)
	}
}
