package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/jsonscan"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestDecodeResponsesRequestRejectsTrailingJSONAndHonorsLimit(t *testing.T) {
	h := NewHandler(Config{MaxBodyBytes: 32 << 10})
	var got map[string]any
	if err := h.decodeResponsesRequest(httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"x"} {"extra":true}`)), &got); err == nil {
		t.Fatal("expected trailing JSON rejection")
	}
	body := `{"model":"` + strings.Repeat("x", 31) + `"}`
	if err := h.decodeResponsesRequest(httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)), &got); err != nil {
		t.Fatalf("exactly bounded JSON rejected: %v", err)
	}
}

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

func TestResponsesLargePayloadPreservesBodyAndCleansSpool(t *testing.T) {
	var outbound map[string]any
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(r.Body)
		if !json.Valid(raw) {
			t.Errorf("upstream body is invalid JSON")
		}
		_ = json.Unmarshal(raw, &outbound)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u-large", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	text := strings.Repeat("x", 300<<10)
	body := `{"model":"glm-5.2","stream":false,"max_output_tokens":32,"input":"` + text + `"}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	msgs, _ := outbound["messages"].([]any)
	if len(msgs) != 1 {
		t.Fatalf("messages=%#v", outbound["messages"])
	}
	content, _ := msgs[0].(map[string]any)["content"].(string)
	if content != text {
		t.Fatalf("content length=%d want=%d", len(content), len(text))
	}
	if got, _ := outbound["max_tokens"].(float64); got != 32 {
		t.Fatalf("max_tokens=%v", outbound["max_tokens"])
	}
	if outbound["stream"] != true {
		t.Fatalf("large upstream request must request SSE: %v", outbound["stream"])
	}
	if files, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_req_spool_*.tmp")); len(files) != 0 {
		t.Fatalf("spool files leaked: %v", files)
	}
}

func TestResponsesLargePayloadStreamCompletes(t *testing.T) {
	var outbound []byte
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		outbound, _ = io.ReadAll(r.Body)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u-stream-large", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	body := `{"model":"glm-5.2","stream":true,"input":"` + strings.Repeat("y", 300<<10) + `"}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("response.created")) || !bytes.Contains(rec.Body.Bytes(), []byte("response.completed")) {
		t.Fatalf("missing Responses stream events: %s", rec.Body.String())
	}
	if !json.Valid(outbound) {
		t.Fatal("upstream body invalid")
	}
}

func TestResponsesLargePayloadPreservesImageAndTools(t *testing.T) {
	var outbound map[string]any
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(r.Body)
		if !json.Valid(raw) {
			t.Fatal("invalid upstream JSON")
		}
		_ = json.Unmarshal(raw, &outbound)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "u-image", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	image := "data:image/png;base64," + strings.Repeat("A", 2<<20)
	body := `{"model":"glm-5.2","input":[{"role":"user","content":[{"type":"input_image","image_url":"` + image + `"}]}],"tools":[{"type":"function","name":"lookup","description":"d","parameters":{"type":"object","properties":{"q":{"type":"string"}}}}]}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	msgs := outbound["messages"].([]any)
	part := msgs[0].(map[string]any)["content"].([]any)[0].(map[string]any)
	imageObj, ok := part["image_url"].(map[string]any)
	if part["type"] != "image_url" || !ok || imageObj["url"] != image {
		t.Fatalf("image part missing or not normalized; type=%v", part["type"])
	}
	tools := outbound["tools"].([]any)
	fn := tools[0].(map[string]any)["function"].(map[string]any)
	if fn["name"] != "lookup" {
		t.Fatalf("tool lost: %#v", fn)
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

type failingResponseWriter struct{ header http.Header }

func (w *failingResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}
func (w *failingResponseWriter) WriteHeader(int)           {}
func (w *failingResponseWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func (w *failingResponseWriter) Flush()                    {}

func TestResponsesStreamReportsClientWriteFailure(t *testing.T) {
	w := &failingResponseWriter{}
	err := writeResponsesStream(w, map[string]any{"id": "resp-fail", "output": []any{}, "output_text": "x"})
	if err == nil {
		t.Fatal("expected downstream write error")
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

func TestLargeResponsesMessageConversionMatchesRegular(t *testing.T) {
	inputs := []string{
		`[{"type":"function_call","id":"item","call_id":"call","name":"lookup","arguments":"{}"},{"type":"function_call_output","call_id":"call","output":"result"}]`,
		`[{"role":"user","content":[{"type":"input_text","text":"hello","extra":42},{"type":"input_image","image_url":"https://example.test/a","other":true}]}]`,
		`[]`,
	}
	for _, input := range inputs {
		var decoded any
		if err := json.Unmarshal([]byte(input), &decoded); err != nil {
			t.Fatal(err)
		}
		expected, err := responsesInputMessages(decoded)
		if err != nil {
			t.Fatal(err)
		}
		for _, msg := range expected {
			parts, _ := msg["content"].([]any)
			for _, value := range parts {
				part, ok := value.(map[string]any)
				if !ok || part["type"] != "image_url" {
					continue
				}
				if url, ok := part["image_url"].(string); ok && url != "" {
					part["image_url"] = map[string]any{"url": url}
				}
			}
		}
		got, err := largeResponsesMessagesAt(strings.NewReader(input), jsonscan.Span{Start: 0, End: int64(len(input))}, nil)
		if err != nil {
			t.Fatal(err)
		}
		var actual []map[string]any
		if err := json.Unmarshal(got, &actual); err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(expected)
		var normalized []map[string]any
		_ = json.Unmarshal(encoded, &normalized)
		if !reflect.DeepEqual(actual, normalized) {
			t.Fatalf("input %s: got %s, want %s", input, got, encoded)
		}
	}
	input := `[]`
	got, err := largeResponsesMessagesAt(strings.NewReader(input), jsonscan.Span{Start: 0, End: int64(len(input))}, json.RawMessage(`"system"`))
	if err != nil || !json.Valid(got) {
		t.Fatalf("empty input with instructions: %s %v", got, err)
	}
}

func TestResponsesLargeHistoryContinuesFromSmallRequest(t *testing.T) {
	var bodies []map[string]any
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, body)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "large-history", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up, StrictContext: true})
	text := strings.Repeat("Q", 2<<20)
	first := httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"glm-5.2","input":"`+text+`"}`)))
	if first.Code != 200 {
		t.Fatalf("first: %d %s", first.Code, first.Body)
	}
	var result map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	second := httptest.NewRecorder()
	request := `{"model":"glm-5.2","previous_response_id":"` + result["id"].(string) + `","input":"next"}`
	h.ServeHTTP(second, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(request)))
	if second.Code != 200 {
		t.Fatalf("second: %d %s", second.Code, second.Body)
	}
	if len(bodies) != 2 {
		t.Fatalf("calls=%d", len(bodies))
	}
	msgs := bodies[1]["messages"].([]any)
	if len(msgs) != 3 || msgs[0].(map[string]any)["content"] != text || msgs[2].(map[string]any)["content"] != "next" {
		t.Fatalf("history mismatch; messages=%d", len(msgs))
	}
}

func TestStreamingJSONMatchesStandardEncoding(t *testing.T) {
	values := []any{map[string]any{"text": strings.Repeat("a", 16383) + "😀<>&\n" + strings.Repeat("z", 200000), "nested": []any{nil, true, 1.0, map[string]any{"x": "\ufffd"}}}, []map[string]any{{"content": strings.Repeat("x", 1<<20)}}, []byte{1, 2, 3}}
	for _, value := range values {
		var out bytes.Buffer
		if err := writeStreamingJSON(&out, value); err != nil {
			t.Fatal(err)
		}
		want, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(out.Bytes(), want) {
			t.Fatalf("JSON differs from standard encoding")
		}
	}
}

func TestResponsesLargeToolArgumentsComplete(t *testing.T) {
	args := `{"input":"` + strings.Repeat("q", 2<<20) + `"}`
	var stream strings.Builder
	for start := 0; start < len(args); start += 8192 {
		end := start + 8192
		if end > len(args) {
			end = len(args)
		}
		fragment, _ := json.Marshal(args[start:end])
		stream.WriteString(`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"run","arguments":`)
		stream.Write(fragment)
		stream.WriteString(`}}]}}]}` + "\n\n")
	}
	stream.WriteString("data: [DONE]\n\n")
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		io.Copy(io.Discard, r.Body)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(stream.String()))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "large-tool", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	rec := httptest.NewRecorder()
	body := `{"model":"glm-5.2","input":"` + strings.Repeat("x", 300<<10) + `"}`
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)))
	if rec.Code != 200 {
		t.Fatalf("status=%d %s", rec.Code, rec.Body)
	}
	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	output := result["output"].([]any)
	call := output[0].(map[string]any)
	if call["arguments"] != args {
		t.Fatalf("arguments incomplete")
	}
}

func TestChatLargeAggregatedContentAndToolSpool(t *testing.T) {
	text := strings.Repeat("abcd", 300000)
	var events strings.Builder
	for i := 0; i < len(text); i += 8000 {
		end := i + 8000
		if end > len(text) {
			end = len(text)
		}
		b, _ := json.Marshal(text[i:end])
		events.WriteString(`data: {"choices":[{"delta":{"content":`)
		events.Write(b)
		events.WriteString(`,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"run","arguments":`)
		events.Write(b)
		events.WriteString(`}}]}}]}` + "\n\n")
	}
	events.WriteString("data: [DONE]\n\n")
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		io.Copy(io.Discard, r.Body)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(events.String()))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	before, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "chat-spool", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"glm-5.2","messages":[{"role":"user","content":"hi"}]}`)))
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	msg := result["choices"].([]any)[0].(map[string]any)["message"].(map[string]any)
	if msg["content"] != text {
		t.Fatal("content mismatch")
	}
	fn := msg["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)
	if fn["arguments"] != text {
		t.Fatal("arguments mismatch")
	}
	after, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
	if len(after) != len(before) {
		t.Fatalf("response spools leaked: before=%v after=%v", before, after)
	}
}

func TestResponsesSpoolLargeContentAndArguments(t *testing.T) {
	text := strings.Repeat("xy世界", 140000)
	var events strings.Builder
	for start := 0; start < len(text); {
		end := start + 8000
		if end > len(text) {
			end = len(text)
		}
		for end < len(text) && !utf8.RuneStart(text[end]) {
			end--
		}
		part, _ := json.Marshal(text[start:end])
		events.WriteString(`data: {"choices":[{"delta":{"content":`)
		events.Write(part)
		events.WriteString(`,"reasoning_content":`)
		events.Write(part)
		events.WriteString(`,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"run","arguments":`)
		events.Write(part)
		events.WriteString(`}}]}}]}` + "\n\n")
		start = end
	}
	events.WriteString("data: [DONE]\n\n")
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		io.Copy(io.Discard, r.Body)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(events.String()))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "response-spool", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	for _, stream := range []bool{false, true} {
		before, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
		rec := httptest.NewRecorder()
		body := fmt.Sprintf(`{"model":"glm-5.2","stream":%t,"input":"hello"}`, stream)
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)))
		if rec.Code != 200 {
			t.Fatalf("stream=%v status=%d %s", stream, rec.Code, rec.Body)
		}
		var result map[string]any
		if !stream {
			if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		} else {
			for _, line := range strings.Split(rec.Body.String(), "\n") {
				if strings.HasPrefix(line, "data: ") {
					var event map[string]any
					if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
						t.Fatal(err)
					}
					if event["type"] == "response.completed" {
						result = event["response"].(map[string]any)
					}
				}
			}
		}
		if result == nil {
			t.Fatal("response missing")
		}
		if result["output_text"] != text {
			t.Fatal("content mismatch")
		}
		out := result["output"].([]any)
		found := false
		for _, v := range out {
			item := v.(map[string]any)
			if item["type"] == "function_call" {
				if item["arguments"] != text {
					t.Fatal("arguments mismatch")
				}
				found = true
			}
		}
		if !found {
			t.Fatal("tool call missing")
		}
		after, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
		if len(after) != len(before) {
			t.Fatalf("spool leak before=%d after=%d", len(before), len(after))
		}
	}
}

type failingResponsesWriter struct{ header http.Header }

func (w *failingResponsesWriter) Header() http.Header { return w.header }
func (w *failingResponsesWriter) WriteHeader(int)     {}
func (w *failingResponsesWriter) Write([]byte) (int, error) {
	return 0, errors.New("client disconnected")
}

type cancelBody struct {
	r      io.Reader
	cancel context.CancelFunc
}

func (r *cancelBody) Read(p []byte) (int, error) {
	n, e := r.r.Read(p)
	if e == io.EOF {
		r.cancel()
		return n, context.Canceled
	}
	return n, e
}
func (r *cancelBody) Close() error { return nil }
func TestResponsesCustomToolSpoolAndCleanup(t *testing.T) {
	input := strings.Repeat("a\n\"世界\\", 70000)
	wrapped, _ := json.Marshal(map[string]any{"input": input})
	var events strings.Builder
	for i := 0; i < len(wrapped); {
		end := i + 4000
		if end > len(wrapped) {
			end = len(wrapped)
		}
		for end < len(wrapped) && !utf8.RuneStart(wrapped[end]) {
			end--
		}
		part, _ := json.Marshal(string(wrapped[i:end]))
		events.WriteString(`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_custom","function":{"name":"custom","arguments":`)
		events.Write(part)
		events.WriteString(`}}]}}]}` + "\n\n")
		i = end
	}
	events.WriteString("data: [DONE]\n\n")
	for _, stream := range []bool{false, true} {
		up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			io.Copy(io.Discard, r.Body)
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(events.String()))}, nil
		})}, ChatBaseCN: "https://fake.example"}
		h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "custom-spool", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
		before, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
		rec := httptest.NewRecorder()
		body := fmt.Sprintf(`{"model":"glm-5.2","stream":%t,"input":"hello","tools":[{"type":"custom","name":"custom"}]}`, stream)
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body)))
		if rec.Code != 200 {
			t.Fatalf("status=%d %s", rec.Code, rec.Body)
		}
		var result map[string]any
		if !stream {
			if e := json.Unmarshal(rec.Body.Bytes(), &result); e != nil {
				t.Fatal(e)
			}
		} else {
			for _, line := range strings.Split(rec.Body.String(), "\n") {
				if strings.HasPrefix(line, "data: ") {
					var v map[string]any
					if e := json.Unmarshal([]byte(line[6:]), &v); e != nil {
						t.Fatal(e)
					}
					if v["type"] == "response.completed" {
						result = v["response"].(map[string]any)
					}
				}
			}
		}
		if result == nil {
			t.Fatal("missing response")
		}
		item := result["output"].([]any)[0].(map[string]any)
		if item["input"] != input {
			t.Fatalf("custom input mismatch stream=%v", stream)
		}
		after, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
		if len(after) != len(before) {
			t.Fatal("spool leaked")
		}
	}
}
func TestResponsesSpoolCleanupOnCancelAndWriteFailure(t *testing.T) {
	text := strings.Repeat("x", 300<<10)
	payload, _ := json.Marshal(text)
	event := `data: {"choices":[{"delta":{"content":` + string(payload) + `}}]}` + "\n\n"
	for _, mode := range []string{"cancel", "upstream_error", "write_error"} {
		t.Run(mode, func(t *testing.T) {
			before, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				io.Copy(io.Discard, r.Body)
				var body io.ReadCloser
				if mode == "cancel" {
					body = &cancelBody{strings.NewReader(event), cancel}
				} else if mode == "upstream_error" {
					body = io.NopCloser(io.MultiReader(strings.NewReader(event), errorReader{}))
				} else {
					body = io.NopCloser(strings.NewReader(event + "data: [DONE]\n\n"))
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: body}, nil
			})}, ChatBaseCN: "https://fake.example"}
			h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "failure-" + mode, AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
			req := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"glm-5.2","input":"hello"}`)).WithContext(ctx)
			if mode == "write_error" {
				h.ServeHTTP(&failingResponsesWriter{make(http.Header)}, req)
			} else {
				h.ServeHTTP(httptest.NewRecorder(), req)
			}
			after, _ := filepath.Glob(filepath.Join(os.TempDir(), "wb_response_value_*.tmp"))
			if len(after) != len(before) {
				t.Fatalf("spool leak: %v", after)
			}
		})
	}
}

type errorReader struct{}

// Opt-in isolated process measurement. The request source and response sink do
// not retain the body; the fake upstream consumes it incrementally.
func TestResponsesMeasuredLargeRequest(t *testing.T) {
	arg := os.Getenv("WB_MEASURE_BYTES")
	if arg == "" {
		t.Skip("measurement is opt-in")
	}
	size, err := strconv.Atoi(arg)
	if err != nil || size < 1 {
		t.Fatal("invalid measurement size")
	}
	var received atomic.Int64
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		n, e := io.Copy(io.Discard, r.Body)
		if e != nil {
			return nil, e
		}
		received.Store(n)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "measure", AccessToken: "at", ExpiresAt: 9999999999})})
	h.cfg.Upstream = up
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	baseline := m.HeapAlloc
	var peak atomic.Uint64
	peak.Store(baseline)
	stop := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				var x runtime.MemStats
				runtime.ReadMemStats(&x)
				if x.HeapAlloc > peak.Load() {
					peak.Store(x.HeapAlloc)
				}
			case <-stop:
				return
			}
		}
	}()
	reader := io.MultiReader(strings.NewReader(`{"model":"glm-5.2","input":"`), io.LimitReader(repeatingByte('x'), int64(size)), strings.NewReader(`"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", reader))
	close(stop)
	<-stopped
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if received.Load() < int64(size) {
		t.Fatalf("truncated upstream: %d", received.Load())
	}
	t.Logf("request_bytes=%d upstream_bytes=%d heap_baseline=%d heap_sampled_peak=%d delta=%d", size, received.Load(), baseline, peak.Load(), peak.Load()-baseline)
}

type repeatingByte byte

func (b repeatingByte) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(b)
	}
	return len(p), nil
}

func TestResponsesStreamsBeforeUpstreamCompletes(t *testing.T) {
	pr, pw := io.Pipe()
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		io.Copy(io.Discard, r.Body)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: pr}, nil
	})}, ChatBaseCN: "https://fake.example"}
	h := NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "stream-live", AccessToken: "at", ExpiresAt: 9999999999}), Upstream: up})
	writer := &notifyingWriter{header: make(http.Header), wrote: make(chan struct{}, 1)}
	done := make(chan struct{})
	go func() {
		h.ServeHTTP(writer, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader("{\"model\":\"glm-5.2\",\"stream\":true,\"input\":\"hi\"}")))
		close(done)
	}()
	go func() { io.WriteString(pw, "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n") }()
	select {
	case <-writer.wrote:
	case <-time.After(3 * time.Second):
		pw.Close()
		<-done
		t.Fatal("no event before upstream finished")
	}
	pw.Close()
	<-done
}

func TestLiveResponsesFailureDoesNotComplete(t *testing.T) {
	rec := httptest.NewRecorder()
	l := newLiveResponsesWriter(rec, "model")
	if err := l.text("hello"); err != nil {
		t.Fatal(err)
	}
	l.fail("history_storage_failed")
	body := rec.Body.String()
	if !strings.Contains(body, "response.failed") || strings.Contains(body, "response.completed") {
		t.Fatal(body)
	}
}

type notifyingWriter struct {
	header http.Header
	wrote  chan struct{}
	buf    bytes.Buffer
}

func (w *notifyingWriter) Header() http.Header { return w.header }
func (w *notifyingWriter) WriteHeader(int)     {}
func (w *notifyingWriter) Write(p []byte) (int, error) {
	w.buf.Write(p)
	if bytes.Contains(w.buf.Bytes(), []byte("response.output_text.delta")) {
		select {
		case w.wrote <- struct{}{}:
		default:
		}
	}
	return len(p), nil
}
func (w *notifyingWriter) Flush() {}

func (errorReader) Read([]byte) (int, error) { return 0, errors.New("upstream read error") }
