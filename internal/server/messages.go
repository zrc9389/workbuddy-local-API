package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
)

type anthropicContentBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	Thinking  string          `json:"thinking,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   json.RawMessage `json:"content,omitempty"`
}

type anthropicMsg struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type anthropicRequest struct {
	Model       string          `json:"model"`
	Messages    []anthropicMsg  `json:"messages"`
	System      json.RawMessage `json:"system,omitempty"`
	Tools       []anthropicTool `json:"tools,omitempty"`
	Metadata    map[string]any  `json:"metadata,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema,omitempty"`
}

func generateMessageID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "msg_" + hex.EncodeToString(b)
}

func parseSystemString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var blocks []anthropicContentBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var sb strings.Builder
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				if sb.Len() > 0 {
					sb.WriteString("\n")
				}
				sb.WriteString(b.Text)
			}
		}
		return sb.String()
	}
	return ""
}

func parseMessageContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var blocks []anthropicContentBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var sb strings.Builder
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				if sb.Len() > 0 {
					sb.WriteString("\n")
				}
				sb.WriteString(b.Text)
			}
		}
		return sb.String()
	}
	return ""
}

// anthropicMessageToOpenAI preserves tool blocks while converting the
// Anthropic message envelope into Chat Completions messages.
func anthropicMessageToOpenAI(m anthropicMsg) []map[string]any {
	var text string
	if json.Unmarshal(m.Content, &text) == nil {
		return []map[string]any{{"role": m.Role, "content": text}}
	}
	var blocks []anthropicContentBlock
	if json.Unmarshal(m.Content, &blocks) != nil {
		return []map[string]any{{"role": m.Role, "content": ""}}
	}
	var textParts []string
	var toolCalls []any
	var out []map[string]any
	for _, block := range blocks {
		switch block.Type {
		case "text", "thinking":
			text := block.Text
			if block.Type == "thinking" && block.Thinking != "" {
				text = block.Thinking
			}
			if text != "" {
				textParts = append(textParts, text)
			}
		case "tool_use":
			args := string(block.Input)
			if args == "" {
				args = "{}"
			}
			toolCalls = append(toolCalls, map[string]any{
				"id": block.ID, "type": "function",
				"function": map[string]any{"name": block.Name, "arguments": args},
			})
		case "tool_result":
			content := parseMessageContent(block.Content)
			if content == "" && len(block.Content) > 0 {
				content = string(block.Content)
			}
			out = append(out, map[string]any{
				"role": "tool", "content": content, "tool_call_id": block.ToolUseID,
			})
		}
	}
	if m.Role == "assistant" || len(toolCalls) > 0 {
		assistant := map[string]any{"role": "assistant", "content": strings.Join(textParts, "\n")}
		if len(toolCalls) > 0 {
			assistant["tool_calls"] = toolCalls
		}
		out = append([]map[string]any{assistant}, out...)
	} else if len(textParts) > 0 {
		out = append([]map[string]any{{"role": m.Role, "content": strings.Join(textParts, "\n")}}, out...)
	}
	if len(out) == 0 {
		out = append(out, map[string]any{"role": m.Role, "content": ""})
	}
	return out
}

// claudeMessages serves POST /v1/messages (Anthropic Claude API protocol)
func (h *Handler) claudeMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req anthropicRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "parse json: "+err.Error())
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "request body must contain one JSON value")
		return
	}

	if req.Model == "" {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "model is required")
		return
	}

	// 1. Build OpenAI-compatible chat completion messages
	var openAIMsgs []map[string]any

	systemText := parseSystemString(req.System)
	if systemText != "" {
		openAIMsgs = append(openAIMsgs, map[string]any{
			"role":    "system",
			"content": systemText,
		})
	}

	for _, m := range req.Messages {
		role := m.Role
		if role != "user" && role != "assistant" {
			role = "user"
		}
		for _, converted := range anthropicMessageToOpenAI(m) {
			if converted["role"] != "tool" {
				converted["role"] = role
			}
			openAIMsgs = append(openAIMsgs, converted)
		}
	}

	openAIPayload := map[string]any{
		"model":          req.Model,
		"messages":       openAIMsgs,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
		"temperature":    req.Temperature,
	}
	if req.MaxTokens > 0 {
		openAIPayload["max_tokens"] = req.MaxTokens
	}
	if len(req.Tools) > 0 {
		tools := make([]any, 0, len(req.Tools))
		for _, tool := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{
				"name": tool.Name, "description": tool.Description, "parameters": tool.InputSchema,
			}})
		}
		openAIPayload["tools"] = tools
	}

	rawOpenAI, err := json.Marshal(openAIPayload)
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	// 2. Dispatch via internal chatCompletions pipeline
	rec := httptest.NewRecorder()
	internalContext := context.WithValue(r.Context(), spoolKey{}, internalNoSpool{})
	reqOpenAI, _ := http.NewRequestWithContext(internalContext, "POST", "/v1/chat/completions", bytes.NewReader(rawOpenAI))
	reqOpenAI.Header = r.Header.Clone()
	reqOpenAI.Header.Set("Content-Type", "application/json")
	if req.Metadata != nil && reqOpenAI.Header.Get("X-Conversation-ID") == "" {
		if conversationID, _ := req.Metadata["conversation_id"].(string); conversationID != "" {
			reqOpenAI.Header.Set("X-Conversation-ID", conversationID)
		}
	}

	msgID := generateMessageID()

	if !req.Stream {
		h.chatCompletions(rec, reqOpenAI)
		resp := rec.Result()
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			for k, v := range resp.Header {
				w.Header()[k] = v
			}
			w.WriteHeader(resp.StatusCode)
			_, _ = io.Copy(w, resp.Body)
			return
		}

		var fullText strings.Builder
		inputTokens, outputTokens := 0, 0
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") && !strings.Contains(line, "[DONE]") {
				var chunk struct {
					Usage struct {
						PromptTokens     int `json:"prompt_tokens"`
						CompletionTokens int `json:"completion_tokens"`
					} `json:"usage"`
					Choices []struct {
						Delta struct {
							Content string `json:"content"`
						} `json:"delta"`
					} `json:"choices"`
				}
				if json.Unmarshal([]byte(line[6:]), &chunk) == nil {
					if chunk.Usage.PromptTokens > 0 {
						inputTokens = chunk.Usage.PromptTokens
					}
					if chunk.Usage.CompletionTokens > 0 {
						outputTokens = chunk.Usage.CompletionTokens
					}
					if len(chunk.Choices) > 0 {
						fullText.WriteString(chunk.Choices[0].Delta.Content)
					}
				}
			}
		}

		outJSON := map[string]any{
			"id":            msgID,
			"type":          "message",
			"role":          "assistant",
			"content":       []map[string]any{{"type": "text", "text": fullText.String()}},
			"model":         req.Model,
			"stop_reason":   "end_turn",
			"stop_sequence": nil,
			"usage": map[string]any{
				"input_tokens":  inputTokens,
				"output_tokens": outputTokens,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(outJSON)
		return
	}

	pr, pw := io.Pipe()
	pipeWriter := &streamingPipeWriter{
		header: make(http.Header),
		writer: pw,
	}

	doneChan := make(chan struct{})
	go func() {
		defer close(doneChan)
		defer pw.Close()
		h.chatCompletions(pipeWriter, reqOpenAI)
	}()

	flusher, ok := w.(http.Flusher)

	scanner := bufio.NewScanner(pr)
	started := false
	textStarted := false
	inputTokens, outputTokens := 0, 0
	toolBlocks := map[int]struct{ id, name string }{}
	toolStarted := map[int]bool{}
	var preStream strings.Builder

	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			if !started {
				preStream.WriteString(line)
				preStream.WriteByte('\n')
			}
			continue
		}
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimSpace(line[6:])
			if data == "[DONE]" {
				break
			}
			var chunk struct {
				Usage struct {
					PromptTokens     int `json:"prompt_tokens"`
					CompletionTokens int `json:"completion_tokens"`
				} `json:"usage"`
				Choices []struct {
					Delta struct {
						Content   string `json:"content"`
						ToolCalls []struct {
							Index    int    `json:"index"`
							ID       string `json:"id"`
							Type     string `json:"type"`
							Function struct {
								Name      string `json:"name"`
								Arguments string `json:"arguments"`
							} `json:"function"`
						} `json:"tool_calls"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if json.Unmarshal([]byte(data), &chunk) == nil {
				if chunk.Usage.PromptTokens > 0 {
					inputTokens = chunk.Usage.PromptTokens
				}
				if chunk.Usage.CompletionTokens > 0 {
					outputTokens = chunk.Usage.CompletionTokens
				}
				if len(chunk.Choices) == 0 {
					continue
				}
				deltaText := chunk.Choices[0].Delta.Content
				if deltaText == "" && len(chunk.Choices[0].Delta.ToolCalls) == 0 {
					continue
				}

				if !started {
					w.Header().Set("Content-Type", "text/event-stream")
					w.Header().Set("Cache-Control", "no-cache")
					w.Header().Set("Connection", "keep-alive")
					mStart, _ := json.Marshal(map[string]any{
						"type": "message_start",
						"message": map[string]any{
							"id":            msgID,
							"type":          "message",
							"role":          "assistant",
							"content":       []any{},
							"model":         req.Model,
							"stop_reason":   nil,
							"stop_sequence": nil,
							"usage":         map[string]any{"input_tokens": inputTokens, "output_tokens": outputTokens},
						},
					})
					fmt.Fprintf(w, "event: message_start\ndata: %s\n\n", mStart)

					started = true
				}

				if deltaText != "" {
					if !textStarted {
						cbStart, _ := json.Marshal(map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": ""}})
						fmt.Fprintf(w, "event: content_block_start\ndata: %s\n\n", cbStart)
						textStarted = true
					}
					cbDelta, _ := json.Marshal(map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": deltaText}})
					fmt.Fprintf(w, "event: content_block_delta\ndata: %s\n\n", cbDelta)
				}
				for _, tool := range chunk.Choices[0].Delta.ToolCalls {
					state := toolBlocks[tool.Index]
					if tool.ID != "" {
						state.id = tool.ID
					}
					if tool.Function.Name != "" {
						state.name = tool.Function.Name
					}
					toolBlocks[tool.Index] = state
					if !toolStarted[tool.Index] && (tool.ID != "" || tool.Function.Name != "") {
						start, _ := json.Marshal(map[string]any{"type": "content_block_start", "index": tool.Index + 1, "content_block": map[string]any{"type": "tool_use", "id": state.id, "name": state.name, "input": map[string]any{}}})
						fmt.Fprintf(w, "event: content_block_start\ndata: %s\n\n", start)
						toolStarted[tool.Index] = true
					}
					if tool.Function.Arguments != "" {
						delta, _ := json.Marshal(map[string]any{"type": "content_block_delta", "index": tool.Index + 1, "delta": map[string]any{"type": "input_json_delta", "partial_json": tool.Function.Arguments}})
						fmt.Fprintf(w, "event: content_block_delta\ndata: %s\n\n", delta)
					}
				}
				if deltaText != "" {
					outputTokens++
				}
				if ok {
					flusher.Flush()
				}
			}
		}
	}

	if started {
		if textStarted {
			cbStop, _ := json.Marshal(map[string]any{"type": "content_block_stop", "index": 0})
			fmt.Fprintf(w, "event: content_block_stop\ndata: %s\n\n", cbStop)
		}
		for index := range toolBlocks {
			stop, _ := json.Marshal(map[string]any{"type": "content_block_stop", "index": index + 1})
			fmt.Fprintf(w, "event: content_block_stop\ndata: %s\n\n", stop)
		}

		mDelta, _ := json.Marshal(map[string]any{
			"type":  "message_delta",
			"delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil},
			"usage": map[string]any{"output_tokens": outputTokens, "input_tokens": inputTokens},
		})
		fmt.Fprintf(w, "event: message_delta\ndata: %s\n\n", mDelta)

		mStop, _ := json.Marshal(map[string]any{"type": "message_stop"})
		fmt.Fprintf(w, "event: message_stop\ndata: %s\n\n", mStop)
		if ok {
			flusher.Flush()
		}
	} else {
		<-doneChan
		status := pipeWriter.statusCode
		if status < http.StatusBadRequest {
			status = http.StatusBadGateway
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		body := strings.TrimSpace(preStream.String())
		if body == "" {
			body = "{\"error\":{\"message\":\"upstream returned no message events\"}}"
		}
		_, _ = io.WriteString(w, body)
		_ = pr.Close()
		return
	}

	_ = pr.Close()
	<-doneChan
}

type internalNoSpool struct{}

type streamingPipeWriter struct {
	header     http.Header
	writer     io.Writer
	statusCode int
}

func (s *streamingPipeWriter) Header() http.Header {
	return s.header
}

func (s *streamingPipeWriter) Write(b []byte) (int, error) {
	return s.writer.Write(b)
}

func (s *streamingPipeWriter) WriteHeader(statusCode int) {
	s.statusCode = statusCode
}

func (s *streamingPipeWriter) Flush() {
}
