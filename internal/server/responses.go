package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"
)

// responses implements the public Responses-shaped adapter. CodeBuddy's
// verified inference endpoint is still /v2/chat/completions; this adapter
// translates the request at the gateway boundary and keeps multi-turn tool
// history locally when previous_response_id is used.
func (h *Handler) responses(w http.ResponseWriter, r *http.Request) {
	raw, err := h.readBody(r)
	if err != nil {
		if err == errRequestBodyTooLarge {
			writeOpenAIError(w, http.StatusRequestEntityTooLarge, "request_body_too_large", h.bodyLimitMessage())
			return
		}
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "read body: "+err.Error())
		return
	}

	var req map[string]any
	if err := json.Unmarshal(raw, &req); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "invalid JSON: "+err.Error())
		return
	}
	model, _ := req["model"].(string)
	if strings.TrimSpace(model) == "" {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "model is required")
		return
	}
	previousID, _ := req["previous_response_id"].(string)
	var history []map[string]any
	if previousID != "" {
		if e := h.cfg.History.CheckWorkingBudget(previousID, h.cfg.MaxBodyBytes); e != nil {
			writeOpenAIError(w, 413, "history_working_budget", e.Error()+"; stored history retained")
			return
		}
		var ok bool
		history, ok = h.getResponseHistory(previousID)
		if !ok {
			writeOpenAIError(w, http.StatusBadRequest, "previous_response_not_found", "previous_response_id is not available in this gateway instance")
			return
		}
	}

	chatBody, chatMessages, stream, customTools, err := buildChatRequestFromResponses(req, history)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "unsupported_request", err.Error())
		return
	}

	// Reuse the existing account-pool, refresh, retry, sticky-session and
	// upstream error policy by invoking the chat handler with an internal
	// non-streaming request. The upstream client still streams; chatCompletions
	// aggregates that stream before returning the JSON response below.
	recorder := httptest.NewRecorder()
	chatReq, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, "/internal/responses-chat", bytes.NewReader(chatBody))
	chatReq.Header = r.Header.Clone()
	chatReq.RemoteAddr = r.RemoteAddr
	h.chatCompletions(recorder, chatReq)
	if recorder.Code < 200 || recorder.Code >= 300 {
		copyHTTPResponse(w, recorder)
		return
	}

	var chatResp map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &chatResp); err != nil {
		writeOpenAIError(w, http.StatusBadGateway, "upstream_parse", "chat adapter returned invalid JSON: "+err.Error())
		return
	}
	responseID := "resp_" + session.NewMessageID()
	response := chatResponseToResponses(chatResp, responseID, model, customTools)
	if messages, ok := responseChatMessages(chatResp); ok {
		chatMessages = append(chatMessages, messages...)
	}
	if err := h.saveResponseHistory(responseID, chatMessages); err != nil {
		writeOpenAIError(w, http.StatusInsufficientStorage, "history_storage_failed", "could not retain conversation history: "+err.Error())
		return
	}

	finishSpool(r, true)
	if stream {
		writeResponsesStream(w, response)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

var errRequestBodyTooLarge = fmt.Errorf("request body too large")

func (h *Handler) readBody(r *http.Request) ([]byte, error) {
	limit := h.cfg.MaxBodyBytes
	var reader io.Reader = r.Body
	if limit > 0 {
		reader = io.LimitReader(r.Body, limit+1)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errRequestBodyTooLarge
		}
		return nil, err
	}
	if limit > 0 && int64(len(body)) > limit {
		return nil, errRequestBodyTooLarge
	}
	return body, nil
}

func (h *Handler) bodyLimitMessage() string {
	if h.cfg.MaxBodyBytes <= 0 {
		return "request body exceeds the configured limit"
	}
	return fmt.Sprintf("请求体超过 %d MB 上限：请压缩内容或调大 server.max_body_mb 配置后重试", h.cfg.MaxBodyBytes>>20)
}

func copyHTTPResponse(w http.ResponseWriter, src *httptest.ResponseRecorder) {
	for k, values := range src.Header() {
		for _, value := range values {
			w.Header().Add(k, value)
		}
	}
	w.WriteHeader(src.Code)
	_, _ = w.Write(src.Body.Bytes())
}

func buildChatRequestFromResponses(req map[string]any, history []map[string]any) ([]byte, []map[string]any, bool, map[string]bool, error) {
	messages := cloneMessages(history)
	if instructions, _ := req["instructions"].(string); strings.TrimSpace(instructions) != "" {
		messages = append(messages, map[string]any{"role": "system", "content": instructions})
	}
	input, ok := req["input"]
	if !ok {
		return nil, nil, false, nil, fmt.Errorf("input is required")
	}
	inputMessages, err := responsesInputMessages(input)
	if err != nil {
		return nil, nil, false, nil, err
	}
	messages = append(messages, inputMessages...)

	chat := map[string]any{
		"model":    req["model"],
		"messages": messages,
		"stream":   false,
	}
	for _, key := range []string{"temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "parallel_tool_calls", "metadata"} {
		if value, exists := req[key]; exists {
			chat[key] = value
		}
	}
	if value, exists := req["max_tokens"]; exists {
		chat["max_tokens"] = value
	} else if value, exists := req["max_output_tokens"]; exists {
		chat["max_tokens"] = value
	}
	if value, exists := req["reasoning_effort"]; exists {
		chat["reasoning_effort"] = value
	}
	if reasoning, ok := req["reasoning"].(map[string]any); ok {
		if effort, ok := reasoning["effort"]; ok {
			chat["reasoning_effort"] = effort
		}
	}
	if value, exists := req["tool_choice"]; exists {
		chat["tool_choice"] = responsesToolChoice(value)
	}
	customTools := customToolNames(req["tools"])
	if tools, exists := req["tools"]; exists {
		converted, err := responsesTools(tools)
		if err != nil {
			return nil, nil, false, nil, err
		}
		chat["tools"] = converted
	}
	// Full history is restored before session.ExtractKey runs. Do not use the
	// changing previous_response_id as conversation ID: it breaks sticky routing.
	encoded, err := json.Marshal(chat)
	return encoded, messages, reqBool(req, "stream"), customTools, err
}

func responsesInputMessages(input any) ([]map[string]any, error) {
	if text, ok := input.(string); ok {
		return []map[string]any{{"role": "user", "content": text}}, nil
	}
	items, ok := input.([]any)
	if !ok {
		return nil, fmt.Errorf("input must be a string or array")
	}
	messages := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			messages = append(messages, map[string]any{"role": "user", "content": text})
			continue
		}
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("input item must be an object")
		}
		typ, _ := obj["type"].(string)
		switch typ {
		case "function_call_output", "custom_tool_call_output":
			callID, _ := obj["call_id"].(string)
			content, err := responseValueString(obj["output"])
			if err != nil {
				return nil, err
			}
			message := map[string]any{"role": "tool", "content": content}
			if callID != "" {
				message["tool_call_id"] = callID
			}
			messages = append(messages, message)
		case "function_call", "custom_tool_call":
			name, _ := obj["name"].(string)
			arguments, err := responsesToolCallArguments(obj, typ)
			if err != nil {
				return nil, err
			}
			call := map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":      name,
					"arguments": arguments,
				},
			}
			if id, _ := obj["id"].(string); id != "" {
				call["id"] = id
			}
			if callID, _ := obj["call_id"].(string); callID != "" {
				call["call_id"] = callID
			}
			messages = append(messages, map[string]any{"role": "assistant", "content": "", "tool_calls": []any{call}})
		default:
			role, _ := obj["role"].(string)
			if role == "" {
				role = "user"
			}
			content, err := responsesContent(obj["content"])
			if err != nil {
				return nil, err
			}
			message := map[string]any{"role": role, "content": content}
			if typ == "input_text" || typ == "output_text" {
				if text, _ := obj["text"].(string); text != "" {
					message["content"] = text
				}
			}
			messages = append(messages, message)
		}
	}
	return messages, nil
}

func responsesContent(value any) (any, error) {
	if value == nil {
		return "", nil
	}
	if _, ok := value.(string); ok {
		return value, nil
	}
	parts, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("message content must be string or array")
	}
	out := make([]any, 0, len(parts))
	for _, part := range parts {
		obj, ok := part.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("content part must be an object")
		}
		copyPart := cloneMap(obj)
		switch copyPart["type"] {
		case "input_text", "output_text":
			copyPart["type"] = "text"
		case "input_image":
			copyPart["type"] = "image_url"
		}
		out = append(out, copyPart)
	}
	return out, nil
}

func responsesTools(value any) ([]any, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("tools must be an array")
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("tool must be an object")
		}
		typ, _ := obj["type"].(string)
		if typ != "function" && typ != "custom" {
			return nil, fmt.Errorf("CodeBuddy chat upstream does not expose Responses built-in tool %q", typ)
		}
		fn := map[string]any{}
		for _, key := range []string{"name", "description", "parameters", "strict"} {
			if item, exists := obj[key]; exists {
				fn[key] = item
			}
		}
		// CodeBuddy 上游只接受 Chat Completions 的 function 形状。
		// Responses 的 custom（freeform）工具（如 apply_patch）没有 JSON Schema，
		// 这里用单字段 input 等价表达，返回时再还原为 custom_tool_call。
		if typ == "custom" {
			if _, exists := fn["parameters"]; !exists {
				fn["parameters"] = customToolSchema(obj)
			}
		}
		out = append(out, map[string]any{"type": "function", "function": fn})
	}
	return out, nil
}

func responsesToolChoice(value any) any {
	obj, ok := value.(map[string]any)
	if !ok {
		return value
	}
	if typ, _ := obj["type"].(string); typ == "function" {
		if fn, ok := obj["function"].(map[string]any); ok {
			return map[string]any{"type": "function", "function": map[string]any{"name": fn["name"]}}
		}
		if name, ok := obj["name"].(string); ok {
			return map[string]any{"type": "function", "function": map[string]any{"name": name}}
		}
	}
	if typ, _ := obj["type"].(string); typ != "" {
		return typ
	}
	return value
}

func responseValueString(value any) (string, error) {
	if value == nil {
		return "", nil
	}
	if text, ok := value.(string); ok {
		return text, nil
	}
	raw, err := json.Marshal(value)
	return string(raw), err
}

func reqBool(req map[string]any, key string) bool {
	value, _ := req[key].(bool)
	return value
}

func responseChatMessages(chatResp map[string]any) ([]map[string]any, bool) {
	choices, ok := chatResp["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil, false
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	if message == nil {
		return nil, false
	}
	return []map[string]any{cloneMap(message)}, true
}

func chatResponseToResponses(chatResp map[string]any, responseID, requestedModel string, customTools map[string]bool) map[string]any {
	model := requestedModel
	if value, ok := chatResp["model"].(string); ok && value != "" {
		model = value
	}
	response := map[string]any{
		"id":          responseID,
		"object":      "response",
		"created_at":  time.Now().Unix(),
		"status":      "completed",
		"model":       model,
		"output":      []any{},
		"output_text": "",
	}
	choices, _ := chatResp["choices"].([]any)
	if len(choices) > 0 {
		choice, _ := choices[0].(map[string]any)
		message, _ := choice["message"].(map[string]any)
		if message != nil {
			if reasoning, _ := message["reasoning_content"].(string); reasoning != "" {
				response["output"] = append(response["output"].([]any), map[string]any{
					"type": "reasoning",
					"id":   "rs_" + responseID,
					"summary": []any{map[string]any{
						"type": "summary_text",
						"text": reasoning,
					}},
				})
			}
			if content, _ := message["content"].(string); content != "" {
				response["output"] = append(response["output"].([]any), map[string]any{
					"type":   "message",
					"id":     "msg_" + responseID,
					"status": "completed",
					"role":   "assistant",
					"content": []any{map[string]any{
						"type":        "output_text",
						"text":        content,
						"annotations": []any{},
					}},
				})
				response["output_text"] = content
			}
			if calls, ok := message["tool_calls"].([]any); ok {
				for index, rawCall := range calls {
					call, _ := rawCall.(map[string]any)
					fn, _ := call["function"].(map[string]any)
					callID, _ := call["id"].(string)
					if callID == "" {
						callID = fmt.Sprintf("call_%s_%d", responseID, index)
					}
					name, _ := fn["name"].(string)
					arguments, _ := fn["arguments"].(string)
					if customTools[name] {
						response["output"] = append(response["output"].([]any), map[string]any{
							"type":    "custom_tool_call",
							"id":      "ctc_" + callID,
							"call_id": callID,
							"status":  "completed",
							"name":    name,
							"input":   customToolInput(arguments),
						})
						continue
					}
					response["output"] = append(response["output"].([]any), map[string]any{
						"type":      "function_call",
						"id":        "fc_" + callID,
						"call_id":   callID,
						"status":    "completed",
						"name":      name,
						"arguments": arguments,
					})
				}
			}
		}
	}
	if usage, ok := chatResp["usage"].(map[string]any); ok {
		response["usage"] = map[string]any{
			"input_tokens":  usage["prompt_tokens"],
			"output_tokens": usage["completion_tokens"],
			"total_tokens":  usage["total_tokens"],
		}
	}
	return response
}

func writeResponsesStream(w http.ResponseWriter, response map[string]any) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	sequence := 0
	created := cloneMap(response)
	created["status"] = "in_progress"
	created["output"] = []any{}
	created["output_text"] = ""
	writeResponsesEvent(w, "response.created", map[string]any{
		"type":            "response.created",
		"sequence_number": sequence,
		"response":        created,
	})
	sequence++
	id, _ := response["id"].(string)
	messageID := "msg_" + id
	messageIndex := 0
	if outputs, ok := response["output"].([]any); ok {
		for outputIndex, rawItem := range outputs {
			item, ok := rawItem.(map[string]any)
			if !ok {
				continue
			}
			if item["type"] == "message" {
				messageIndex = outputIndex
				if itemID, _ := item["id"].(string); itemID != "" {
					messageID = itemID
				}
				continue
			}
			if item["type"] == "custom_tool_call" {
				added := cloneMap(item)
				added["status"] = "in_progress"
				writeResponsesEvent(w, "response.output_item.added", map[string]any{
					"type":            "response.output_item.added",
					"sequence_number": sequence,
					"output_index":    outputIndex,
					"item":            added,
				})
				sequence++
				itemID, _ := item["id"].(string)
				input, _ := item["input"].(string)
				if input != "" {
					writeResponsesEvent(w, "response.custom_tool_call_input.delta", map[string]any{
						"type":            "response.custom_tool_call_input.delta",
						"sequence_number": sequence,
						"item_id":         itemID,
						"output_index":    outputIndex,
						"delta":           input,
					})
					sequence++
				}
				writeResponsesEvent(w, "response.custom_tool_call_input.done", map[string]any{
					"type":            "response.custom_tool_call_input.done",
					"sequence_number": sequence,
					"item_id":         itemID,
					"output_index":    outputIndex,
					"input":           input,
				})
				sequence++
				writeResponsesEvent(w, "response.output_item.done", map[string]any{
					"type":            "response.output_item.done",
					"sequence_number": sequence,
					"output_index":    outputIndex,
					"item":            item,
				})
				sequence++
				continue
			}
			if item["type"] != "function_call" {
				continue
			}
			added := cloneMap(item)
			added["status"] = "in_progress"
			writeResponsesEvent(w, "response.output_item.added", map[string]any{
				"type":            "response.output_item.added",
				"sequence_number": sequence,
				"output_index":    outputIndex,
				"item":            added,
			})
			sequence++
			itemID, _ := item["id"].(string)
			arguments, _ := item["arguments"].(string)
			name, _ := item["name"].(string)
			if arguments != "" {
				writeResponsesEvent(w, "response.function_call_arguments.delta", map[string]any{
					"type":            "response.function_call_arguments.delta",
					"sequence_number": sequence,
					"item_id":         itemID,
					"output_index":    outputIndex,
					"delta":           arguments,
				})
				sequence++
			}
			writeResponsesEvent(w, "response.function_call_arguments.done", map[string]any{
				"type":            "response.function_call_arguments.done",
				"sequence_number": sequence,
				"item_id":         itemID,
				"output_index":    outputIndex,
				"name":            name,
				"arguments":       arguments,
			})
			sequence++
			writeResponsesEvent(w, "response.output_item.done", map[string]any{
				"type":            "response.output_item.done",
				"sequence_number": sequence,
				"output_index":    outputIndex,
				"item":            item,
			})
			sequence++
		}
	}
	if text, _ := response["output_text"].(string); text != "" {
		writeResponsesEvent(w, "response.output_text.delta", map[string]any{
			"type":            "response.output_text.delta",
			"sequence_number": sequence,
			"item_id":         messageID,
			"output_index":    messageIndex,
			"content_index":   0,
			"delta":           text,
			"logprobs":        []any{},
		})
		sequence++
	}
	writeResponsesEvent(w, "response.completed", map[string]any{
		"type":            "response.completed",
		"sequence_number": sequence,
		"response":        response,
	})
}

func writeResponsesEvent(w http.ResponseWriter, event string, value any) {
	raw, _ := json.Marshal(value)
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, raw)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (h *Handler) getResponseHistory(id string) ([]map[string]any, bool) {
	raw, ok := h.cfg.History.Get(id)
	if !ok {
		return nil, false
	}
	var msgs []map[string]any
	if json.Unmarshal(raw, &msgs) != nil {
		return nil, false
	}
	return msgs, true
}
func (h *Handler) saveResponseHistory(id string, messages []map[string]any) error {
	raw, e := json.Marshal(messages)
	if e != nil {
		return e
	}
	return h.cfg.History.Put(id, raw)
}

func cloneMessages(messages []map[string]any) []map[string]any {
	if len(messages) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		out = append(out, cloneMap(message))
	}
	return out
}

func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		return map[string]any{}
	}
	return out
}

// customToolNames 返回请求中 custom（freeform）工具的名字集合。
func customToolNames(value any) map[string]bool {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	names := map[string]bool{}
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if typ, _ := obj["type"].(string); typ == "custom" {
			if name, _ := obj["name"].(string); name != "" {
				names[name] = true
			}
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

// customToolSchema 把 Responses 的 custom（freeform）工具等价表达为
// 单字段 input 的 JSON Schema，供只支持 function 工具的上游使用。
func customToolSchema(obj map[string]any) map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"input": map[string]any{
				"type":        "string",
				"description": customToolFormatHint(obj),
			},
		},
		"required": []any{"input"},
	}
}

func customToolFormatHint(obj map[string]any) string {
	const maxDefinition = 4000
	hint := "本工具的输入是原始文本，请把完整内容原样放进 input 字段。"
	format, ok := obj["format"].(map[string]any)
	if !ok {
		return hint
	}
	if syntax, _ := format["syntax"].(string); syntax != "" {
		hint += " 语法：" + syntax + "。"
	}
	definition, _ := format["definition"].(string)
	if definition == "" {
		return hint
	}
	if len(definition) > maxDefinition {
		definition = definition[:maxDefinition] + "\n... (语法定义已截断)"
	}
	return hint + "\n" + definition
}

// customToolInput 从上游返回的 function arguments 中取回 freeform 原文。
func customToolInput(arguments string) string {
	if arguments == "" {
		return ""
	}
	var payload map[string]any
	if json.Unmarshal([]byte(arguments), &payload) == nil {
		if input, ok := payload["input"].(string); ok {
			return input
		}
	}
	return arguments
}

// responsesToolCallArguments 生成回填 assistant 消息所需的 arguments 字符串。
func responsesToolCallArguments(obj map[string]any, typ string) (string, error) {
	if typ == "custom_tool_call" {
		input, err := responseValueString(obj["input"])
		if err != nil {
			return "", err
		}
		raw, err := json.Marshal(map[string]any{"input": input})
		return string(raw), err
	}
	return responseValueString(obj["arguments"])
}
