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

func TestResponsesAdapterTranslatesRequest(t *testing.T) {
	var outbound map[string]any
	up := &upstream.Client{
		HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &outbound)
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
		})},
		ChatBaseCN: "https://fake.example",
	}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"glm-5.2",
		"instructions":"be concise",
		"input":[{"role":"user","content":[{"type":"input_text","text":"hello"}]}],
		"tools":[{"type":"function","name":"get_weather","description":"weather","parameters":{"type":"object"}}],
		"tool_choice":{"type":"function","name":"get_weather"},
		"reasoning":{"effort":"high"},
		"max_output_tokens":64
	}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	if got, _ := outbound["stream"].(bool); !got {
		t.Error("upstream chat client should force stream=true")
	}
	if got, _ := outbound["reasoning_effort"].(string); got != "high" {
		t.Errorf("reasoning_effort=%q", got)
	}
	if got, _ := outbound["max_tokens"].(float64); got != 64 {
		t.Errorf("max_tokens=%v", got)
	}
	msgs, _ := outbound["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("messages=%#v", msgs)
	}
	if msgs[0].(map[string]any)["role"] != "system" || msgs[1].(map[string]any)["role"] != "user" {
		t.Errorf("messages=%#v", msgs)
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["object"] != "response" || response["status"] != "completed" {
		t.Errorf("response=%#v", response)
	}
}

func TestResponsesAdapterPreviousResponseAndToolOutput(t *testing.T) {
	var bodies []map[string]any
	toolSSE := "data: {\"id\":\"chatcmpl-tool\",\"object\":\"chat.completion.chunk\",\"created\":1753600000,\"model\":\"glm-5.2\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"{\\\"city\\\":\\\"Beijing\\\"}\"},\"index\":0}]}}]}\n\n" +
		"data: {\"id\":\"chatcmpl-tool\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n" +
		"data: [DONE]\n\n"
	up := &upstream.Client{
		HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(r.Body)
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			bodies = append(bodies, body)
			stream := toolSSE
			if len(bodies) > 1 {
				stream = sseOK
			}
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(stream))}, nil
		})},
		ChatBaseCN: "https://fake.example",
	}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u1", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	first := httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{
		"model":"glm-5.2",
		"input":"call a tool",
		"tools":[{"type":"function","name":"get_weather","parameters":{"type":"object"}}],
		"tool_choice":{"type":"function","name":"get_weather"}
	}`)))
	if first.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body)
	}
	var firstResponse map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &firstResponse); err != nil {
		t.Fatal(err)
	}
	previousID, _ := firstResponse["id"].(string)
	if previousID == "" {
		t.Fatalf("first response has no id: %#v", firstResponse)
	}
	output, _ := firstResponse["output"].([]any)
	if len(output) != 1 || output[0].(map[string]any)["type"] != "function_call" {
		t.Fatalf("first response should contain function_call: %#v", firstResponse)
	}
	callID, _ := output[0].(map[string]any)["call_id"].(string)
	if callID != "call_1" {
		t.Fatalf("call_id=%q want call_1", callID)
	}
	secondBody := `{"model":"glm-5.2","previous_response_id":"` + previousID + `","input":[{"type":"function_call_output","call_id":"` + callID + `","output":"sunny"}]}`
	second := httptest.NewRecorder()
	h.ServeHTTP(second, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(secondBody)))
	if second.Code != http.StatusOK {
		t.Fatalf("second status=%d body=%s", second.Code, second.Body)
	}
	if len(bodies) != 2 {
		t.Fatalf("upstream calls=%d", len(bodies))
	}
	msgs, _ := bodies[1]["messages"].([]any)
	if len(msgs) != 3 {
		t.Fatalf("second messages=%#v", msgs)
	}
	assistant := msgs[1].(map[string]any)
	toolCalls, _ := assistant["tool_calls"].([]any)
	if assistant["role"] != "assistant" || len(toolCalls) != 1 {
		t.Errorf("assistant tool call history=%#v", assistant)
	}
	last := msgs[len(msgs)-1].(map[string]any)
	if last["role"] != "tool" || last["tool_call_id"] != "call_1" || last["content"] != "sunny" {
		t.Errorf("tool output message=%#v", last)
	}
	var secondResponse map[string]any
	if err := json.Unmarshal(second.Body.Bytes(), &secondResponse); err != nil {
		t.Fatal(err)
	}
	if secondResponse["output_text"] != "你好" {
		t.Errorf("second output_text=%#v want 你好", secondResponse["output_text"])
	}
}

func TestResponsesStreamUsesSDKEventEnvelopes(t *testing.T) {
	response := map[string]any{
		"id":          "resp_1",
		"object":      "response",
		"status":      "completed",
		"model":       "glm-5.2",
		"output_text": "OK",
		"output": []any{map[string]any{
			"type":   "message",
			"id":     "msg_resp_1",
			"status": "completed",
			"role":   "assistant",
			"content": []any{map[string]any{
				"type":        "output_text",
				"text":        "OK",
				"annotations": []any{},
			}},
		}},
	}
	rec := httptest.NewRecorder()
	writeResponsesStream(rec, response)

	for _, expected := range []string{
		`"type":"response.created"`,
		`"response":{"id":"resp_1"`,
		`"type":"response.output_text.delta"`,
		`"type":"response.completed"`,
	} {
		if !strings.Contains(rec.Body.String(), expected) {
			t.Errorf("stream missing %s: %s", expected, rec.Body.String())
		}
	}
	if strings.Contains(rec.Body.String(), "data: [DONE]") {
		t.Errorf("Responses stream should terminate with response.completed, not Chat [DONE]: %s", rec.Body.String())
	}

	toolRec := httptest.NewRecorder()
	writeResponsesStream(toolRec, map[string]any{
		"id":          "resp_tool",
		"object":      "response",
		"status":      "completed",
		"model":       "glm-5.2",
		"output_text": "",
		"output": []any{map[string]any{
			"type":      "function_call",
			"id":        "fc_call_1",
			"call_id":   "call_1",
			"status":    "completed",
			"name":      "get_weather",
			"arguments": `{"city":"Beijing"}`,
		}},
	})
	for _, expected := range []string{
		`"type":"response.output_item.added"`,
		`"type":"response.function_call_arguments.delta"`,
		`"type":"response.function_call_arguments.done"`,
		`"type":"response.output_item.done"`,
	} {
		if !strings.Contains(toolRec.Body.String(), expected) {
			t.Errorf("tool stream missing %s: %s", expected, toolRec.Body.String())
		}
	}
}
