package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/linguo2625469/workbuddy2api-panel/internal/jsonscan"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// responses implements the public Responses-shaped adapter. CodeBuddy's
// verified inference endpoint is still /v2/chat/completions; this adapter
// translates the request at the gateway boundary and keeps multi-turn tool
// history locally when previous_response_id is used.
func (h *Handler) responses(w http.ResponseWriter, r *http.Request) {
	payload, err := h.readPayload(r)
	if err != nil {
		if errors.Is(err, errRequestBodyTooLarge) {
			if r.Context().Value(unknownBudgetKey{}) != nil {
				writeOpenAIError(w, 413, "working_budget_exceeded", "unknown-length request exceeds the configured working budget; content was not dispatched")
				return
			}
			writeOpenAIError(w, http.StatusRequestEntityTooLarge, "request_body_too_large", h.bodyLimitMessage())
			return
		}
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "read body: "+err.Error())
		return
	}
	defer payload.Close()
	if payload.Size > DefaultMemoryBufferThreshold {
		if h.responsesLargePayload(w, r, payload) {
			return
		}
		writeOpenAIError(w, http.StatusBadRequest, "unsupported_request", "large Responses request could not be converted safely without full in-memory decoding")
		return
	}
	rd, err := payload.OpenReader()
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "open request body: "+err.Error())
		return
	}
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(rd)
	err = dec.Decode(&raw)
	if err == nil {
		var extra any
		if extraErr := dec.Decode(&extra); extraErr != io.EOF {
			if extraErr == nil {
				err = errors.New("multiple JSON values")
			} else {
				err = extraErr
			}
		}
	}
	rd.Close()
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "invalid JSON: "+err.Error())
		return
	}
	req, err := rawResponsesToMap(raw)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	model, _ := req["model"].(string)
	if strings.TrimSpace(model) == "" {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "model is required")
		return
	}
	previousID, _ := req["previous_response_id"].(string)
	if previousID != "" {
		if h.responsesLargePayload(w, r, payload) {
			return
		}
		writeOpenAIError(w, 400, "unsupported_request", "history could not be converted safely")
		return
	}
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
	recorder := newChatCapture()
	if stream {
		recorder.live = newLiveResponsesWriter(w, model)
	}
	defer recorder.close()
	chatReq, err := http.NewRequestWithContext(context.WithValue(r.Context(), spoolKey{}, nil), http.MethodPost, "/internal/responses-chat", bytes.NewReader(chatBody))
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, "internal_error", "failed to construct internal chat request: "+err.Error())
		return
	}
	chatReq.Header = r.Header.Clone()
	chatReq.RemoteAddr = r.RemoteAddr
	h.chatCompletions(recorder, chatReq)
	if recorder.Code < 200 || recorder.Code >= 300 {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("upstream_error")
			return
		}
		copyHTTPResponse(w, recorder)
		return
	}
	chatResp := recorder.response
	if chatResp == nil {
		writeOpenAIError(w, http.StatusBadGateway, "upstream_parse", "chat adapter returned no response")
		return
	}
	responseID := "resp_" + session.NewMessageID()
	if recorder.live != nil {
		responseID = recorder.live.id
	}
	response := chatResponseToResponses(chatResp, responseID, model, customTools)
	if messages, ok := responseChatMessages(chatResp); ok {
		chatMessages = append(chatMessages, messages...)
	}
	historyFile, err := os.CreateTemp("", "wb_responses_saved_*.tmp")
	if err != nil {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("history_storage_failed")
			return
		}
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return
	}
	defer func() { historyFile.Close(); os.Remove(historyFile.Name()) }()
	err = writeStreamingJSON(historyFile, chatMessages)
	if err == nil {
		err = h.cfg.History.PutReaderContext(r.Context(), responseID, historyFile)
	}
	if err != nil {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("history_storage_failed")
			return
		}
		writeOpenAIError(w, http.StatusInsufficientStorage, "history_storage_failed", "could not retain conversation history: "+err.Error())
		return
	}
	if stream {
		if err := recorder.live.complete(response); err != nil {
			return
		}
		finishSpool(r, true)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := writeStreamingJSON(w, response); err != nil {
		return
	}
	finishSpool(r, true)
}

func (h *Handler) responsesLargePayload(w http.ResponseWriter, r *http.Request, payload *RequestPayload) bool {
	ra, closer, err := payload.OpenReaderAt()
	if err != nil {
		return false
	}
	defer closer.Close()
	spans, err := jsonscan.Object(io.NewSectionReader(ra, 0, payload.Size))
	if err != nil {
		return false
	}
	byKey := make(map[string]jsonscan.Span, len(spans))
	for _, span := range spans {
		byKey[span.Key] = span
	}
	readSmall := func(key string) (json.RawMessage, error) {
		span, ok := byKey[key]
		if !ok {
			return nil, nil
		}
		limit := int64(1 << 20)
		if key == "tools" {
			limit = 64 << 20
		}
		if span.End-span.Start > limit {
			return nil, fmt.Errorf("field %q is too large for bounded conversion", key)
		}
		b := make([]byte, span.End-span.Start)
		_, err := ra.ReadAt(b, span.Start)
		if err != nil && err != io.EOF {
			return nil, err
		}
		return b, nil
	}
	modelRaw, err := readSmall("model")
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "unsupported_request", err.Error())
		return true
	}
	var model string
	if json.Unmarshal(modelRaw, &model) != nil || strings.TrimSpace(model) == "" {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request", "model is required")
		return true
	}
	var history io.ReadSeekCloser
	previousRaw, err := readSmall("previous_response_id")
	if err != nil {
		writeOpenAIError(w, 400, "unsupported_request", err.Error())
		return true
	}
	var previousID string
	_ = json.Unmarshal(previousRaw, &previousID)
	if previousID != "" {
		var ok bool
		history, ok = h.cfg.History.OpenReader(previousID)
		if !ok {
			writeOpenAIError(w, 400, "previous_response_not_found", "previous_response_id is not available in this gateway instance")
			return true
		}
		defer history.Close()
	}

	instructions, err := readSmall("instructions")
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "unsupported_request", err.Error())
		return true
	}
	messages, err := os.CreateTemp("", "wb_responses_messages_*.tmp")
	if err != nil {
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	defer func(f *os.File) { f.Close(); os.Remove(f.Name()) }(messages)
	if err := writeLargeResponsesMessages(messages, ra, byKey["input"], instructions); err != nil {
		writeOpenAIError(w, 400, "unsupported_request", err.Error())
		return true
	}
	if history != nil {
		combined, err := os.CreateTemp("", "wb_responses_history_*.tmp")
		if err != nil {
			writeOpenAIError(w, 500, "spool_error", err.Error())
			return true
		}
		defer func() { combined.Close(); os.Remove(combined.Name()) }()
		if err = joinHistory(combined, history, messages); err != nil {
			writeOpenAIError(w, 500, "history_storage_failed", err.Error())
			return true
		}
		messages = combined
	}
	if _, err := messages.Seek(0, io.SeekStart); err != nil {
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	raw := make(map[string]json.RawMessage)
	raw["model"] = modelRaw
	for _, key := range []string{"tool_choice", "max_tokens", "max_output_tokens", "reasoning", "reasoning_effort", "temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "parallel_tool_calls", "metadata"} {
		raw[key], err = readSmall(key)
		if err != nil {
			writeOpenAIError(w, http.StatusBadRequest, "unsupported_request", err.Error())
			return true
		}
	}
	chat, err := os.CreateTemp("", "wb_responses_chat_*.tmp")
	if err != nil {
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	defer func() { chat.Close(); os.Remove(chat.Name()) }()
	var tools io.Reader
	customTools := map[string]bool{}
	if span, ok := byKey["tools"]; ok {
		toolFile, e := os.CreateTemp("", "wb_responses_tools_*.tmp")
		if e != nil {
			writeOpenAIError(w, 500, "spool_error", e.Error())
			return true
		}
		defer func() { toolFile.Close(); os.Remove(toolFile.Name()) }()
		customTools, e = writeLargeToolsAt(toolFile, ra, span)
		if e != nil {
			writeOpenAIError(w, 400, "unsupported_request", e.Error())
			return true
		}
		if _, e = toolFile.Seek(0, io.SeekStart); e != nil {
			writeOpenAIError(w, 500, "spool_error", e.Error())
			return true
		}
		tools = toolFile
	}
	if err := writeLargeChatBody(chat, raw, messages, tools); err != nil {
		writeOpenAIError(w, 400, "unsupported_request", err.Error())
		return true
	}
	if _, err := chat.Seek(0, io.SeekStart); err != nil {
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	if _, err := messages.Seek(0, io.SeekStart); err != nil {
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	streamRaw, _ := readSmall("stream")
	return h.forwardLargeResponses(w, r, model, chat, messages, reqBoolRaw(map[string]json.RawMessage{"stream": streamRaw}, "stream"), customTools)
}

func largeResponsesMessagesAt(ra io.ReaderAt, span jsonscan.Span, instructions json.RawMessage) ([]byte, error) {
	var out bytes.Buffer
	if err := writeLargeResponsesMessages(&out, ra, span, instructions); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func writeLargeResponsesMessages(dst io.Writer, ra io.ReaderAt, span jsonscan.Span, instructions json.RawMessage) error {
	if span.End <= span.Start {
		return errors.New("input is required")
	}
	out := bufio.NewWriterSize(dst, 32<<10)
	out.WriteByte('[')
	if len(instructions) > 0 && strings.TrimSpace(string(instructions)) != `""` {
		out.WriteString(`{"role":"system","content":`)
		out.Write(instructions)
		out.WriteByte('}')
	}
	hasInstructions := len(instructions) > 0 && strings.TrimSpace(string(instructions)) != `""`
	first := make([]byte, 1)
	if _, err := ra.ReadAt(first, span.Start); err != nil {
		return err
	}
	if first[0] == '"' {
		if hasInstructions {
			out.WriteByte(',')
		}
		out.WriteString(`{"role":"user","content":`)
		if err := jsonscan.CopySpan(out, ra, span); err != nil {
			return err
		}
		out.WriteByte('}')
		out.WriteByte(']')
		return out.Flush()
	}
	if first[0] != '[' {
		return errors.New("input must be a string or array")
	}
	items, err := jsonscan.Array(io.NewSectionReader(ra, span.Start, span.End-span.Start))
	if err != nil {
		return err
	}
	for i, item := range items {
		if i > 0 || hasInstructions {
			out.WriteByte(',')
		}
		item.Start += span.Start
		item.End += span.Start
		if item.End-item.Start > 1<<20 {
			if _, err := ra.ReadAt(first, item.Start); err != nil {
				return err
			}
			if first[0] == '"' {
				out.WriteString(`{"role":"user","content":`)
				if err := jsonscan.CopySpan(out, ra, item); err != nil {
					return err
				}
				out.WriteByte('}')
				continue
			}
			if err := largeInputObjectAt(out, ra, item); err != nil {
				return err
			}
			continue
		}
		b := make([]byte, item.End-item.Start)
		if _, e := ra.ReadAt(b, item.Start); e != nil && e != io.EOF {
			return e
		}
		var decoded any
		if err := json.Unmarshal(b, &decoded); err != nil {
			return err
		}
		converted, err := responsesInputMessages([]any{decoded})
		if err != nil {
			return err
		}
		if parts, ok := converted[0]["content"].([]any); ok {
			for _, rawPart := range parts {
				part, ok := rawPart.(map[string]any)
				if !ok || part["type"] != "image_url" {
					continue
				}
				if url, ok := part["image_url"].(string); ok && url != "" {
					part["image_url"] = map[string]any{"url": url}
				}
			}
		}
		encoded, err := json.Marshal(converted[0])
		if err != nil {
			return err
		}
		out.Write(encoded)
	}
	out.WriteByte(']')
	return out.Flush()
}

func largeInputObjectAt(out *bufio.Writer, ra io.ReaderAt, item jsonscan.Span) error {
	spans, err := jsonscan.Object(io.NewSectionReader(ra, item.Start, item.End-item.Start))
	if err != nil {
		return err
	}
	fields := make(map[string]jsonscan.Span, len(spans))
	for _, sp := range spans {
		sp.Start += item.Start
		sp.End += item.Start
		fields[sp.Key] = sp
	}
	for _, key := range []string{"type", "role"} {
		if field := fields[key]; field.End-field.Start > 65536 {
			return errors.New("message type or role exceeds safe conversion limit")
		}
	}
	typ := readStringAt(ra, fields["type"], 0)
	if typ == "function_call_output" || typ == "custom_tool_call_output" {
		output, ok := fields["output"]
		if !ok {
			out.WriteString(`{"role":"tool","content":""`)
		} else {
			first := []byte{0}
			if _, err := ra.ReadAt(first, output.Start); err != nil {
				return err
			}
			if first[0] != '"' {
				return errors.New("large non-string tool output cannot be converted safely")
			}
			out.WriteString(`{"role":"tool","content":`)
			if err := jsonscan.CopySpan(out, ra, output); err != nil {
				return err
			}
		}
		if id, ok := fields["call_id"]; ok {
			if id.End-id.Start > 65536 {
				return errors.New("tool call ID too large")
			}
			if value := readStringAt(ra, id, 0); value != "" {
				out.WriteString(`,"tool_call_id":`)
				if err := jsonscan.CopySpan(out, ra, id); err != nil {
					return err
				}
			}
		}
		out.WriteByte('}')
		return nil
	}
	if typ == "function_call" || typ == "custom_tool_call" {
		return errors.New("large tool call item cannot be converted safely")
	}
	role := readStringAt(ra, fields["role"], 0)
	if role == "" {
		role = "user"
	}
	rb, _ := json.Marshal(role)
	out.WriteString(`{"role":`)
	out.Write(rb)
	out.WriteString(`,"content":`)
	if sp, ok := fields["content"]; ok {
		if err := largeContentAt(out, ra, sp); err != nil {
			return err
		}
	} else if sp, ok := fields["text"]; ok {
		if err := jsonscan.CopySpan(out, ra, sp); err != nil {
			return err
		}
	} else {
		out.WriteString(`""`)
	}
	out.WriteByte('}')
	return nil
}

func readStringAt(ra io.ReaderAt, span jsonscan.Span, base int64) string {
	if span.End <= span.Start || span.End-span.Start > 65536 {
		return ""
	}
	span.Start += base
	span.End += base
	b := make([]byte, span.End-span.Start)
	if _, e := ra.ReadAt(b, span.Start); e != nil && e != io.EOF {
		return ""
	}
	var v string
	_ = json.Unmarshal(b, &v)
	return v
}
func minInt64(v int64, max int64) int {
	if v < max {
		return int(v)
	}
	return int(max)
}

func largeContentAt(out *bufio.Writer, ra io.ReaderAt, span jsonscan.Span) error {
	first := make([]byte, 1)
	if _, err := ra.ReadAt(first, span.Start); err != nil {
		return err
	}
	if first[0] == '"' {
		return jsonscan.CopySpan(out, ra, span)
	}
	if first[0] != '[' {
		return errors.New("message content must be string or array")
	}
	parts, err := jsonscan.Array(io.NewSectionReader(ra, span.Start, span.End-span.Start))
	if err != nil {
		return err
	}
	out.WriteByte('[')
	for i, part := range parts {
		if i > 0 {
			out.WriteByte(',')
		}
		part.Start += span.Start
		part.End += span.Start
		pSpans, err := jsonscan.Object(io.NewSectionReader(ra, part.Start, part.End-part.Start))
		if err != nil {
			return err
		}
		fields := make(map[string]jsonscan.Span, len(pSpans))
		for _, p := range pSpans {
			p.Start += part.Start
			p.End += part.Start
			fields[p.Key] = p
		}
		if field := fields["type"]; field.End-field.Start > 65536 {
			return errors.New("content type exceeds safe conversion limit")
		}
		typ := readStringAt(ra, fields["type"], 0)
		if typ == "input_text" || typ == "output_text" || typ == "input_image" || typ == "image_url" {
			convertedType := "text"
			if typ == "input_image" || typ == "image_url" {
				convertedType = "image_url"
			}
			out.WriteByte('{')
			for j, field := range pSpans {
				if j > 0 {
					out.WriteByte(',')
				}
				key, _ := json.Marshal(field.Key)
				out.Write(key)
				out.WriteByte(':')
				if field.Key == "type" {
					value, _ := json.Marshal(convertedType)
					out.Write(value)
				} else {
					field.Start += part.Start
					field.End += part.Start
					wrapImage := false
					if convertedType == "image_url" && field.Key == "image_url" && field.End-field.Start > 2 {
						var first [1]byte
						if _, err := ra.ReadAt(first[:], field.Start); err != nil {
							return err
						}
						wrapImage = first[0] == '"'
					}
					if wrapImage {
						out.WriteString(`{"url":`)
					}
					if err := jsonscan.CopySpan(out, ra, field); err != nil {
						return err
					}
					if wrapImage {
						out.WriteByte('}')
					}
				}
			}
			out.WriteByte('}')
		} else if err := jsonscan.CopySpan(out, ra, part); err != nil {
			return err
		}
	}
	out.WriteByte(']')
	return nil
}

func writeLargeChatBody(dst io.Writer, raw map[string]json.RawMessage, messages, tools io.Reader) error {
	out := bufio.NewWriterSize(dst, 32<<10)
	out.WriteString(`{"model":`)
	out.Write(raw["model"])
	out.WriteString(`,"messages":`)
	if _, err := io.Copy(out, messages); err != nil {
		return err
	}
	out.WriteString(`,"stream":true,"stream_options":{"include_usage":true}`)
	for _, key := range []string{"temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "parallel_tool_calls", "metadata", "reasoning_effort"} {
		if key == "reasoning_effort" && len(raw[key]) == 0 && len(raw["reasoning"]) > 0 {
			var reasoning map[string]json.RawMessage
			if json.Unmarshal(raw["reasoning"], &reasoning) == nil {
				raw[key] = reasoning["effort"]
			}
		}
		if value := raw[key]; len(value) > 0 {
			keyJSON, _ := json.Marshal(key)
			out.WriteByte(',')
			out.Write(keyJSON)
			out.WriteByte(':')
			out.Write(value)
		}
	}
	if value := raw["max_tokens"]; len(value) > 0 {
		out.WriteString(`,"max_tokens":`)
		out.Write(value)
	} else if value := raw["max_output_tokens"]; len(value) > 0 {
		out.WriteString(`,"max_tokens":`)
		out.Write(value)
	}
	if tools != nil {
		out.WriteString(`,"tools":`)
		if _, err := io.Copy(out, tools); err != nil {
			return err
		}
	}
	if value := raw["tool_choice"]; len(value) > 0 {
		var decoded any
		if json.Unmarshal(value, &decoded) == nil {
			normalized, _ := json.Marshal(responsesToolChoice(decoded))
			out.WriteString(`,"tool_choice":`)
			out.Write(normalized)
		}
	}
	out.WriteByte('}')
	return out.Flush()
}

func largeResponsesTools(raw json.RawMessage) ([]byte, error) {
	items, err := jsonscan.Array(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	out.WriteByte('[')
	for index, item := range items {
		if index > 0 {
			out.WriteByte(',')
		}
		if item.End-item.Start > 1<<20 {
			return nil, errors.New("tool definition is too large for safe conversion")
		}
		value := make([]byte, item.End-item.Start)
		copy(value, raw[item.Start:item.End])
		var object map[string]json.RawMessage
		if err := json.Unmarshal(value, &object); err != nil {
			return nil, errors.New("tool must be an object")
		}
		var typ string
		_ = json.Unmarshal(object["type"], &typ)
		if typ != "function" && typ != "custom" {
			return nil, fmt.Errorf("unsupported tool type %q", typ)
		}
		out.WriteString(`{"type":"function","function":{}`)
		out.Truncate(out.Len() - 1)
		first := true
		if typ == "custom" && len(object["parameters"]) == 0 {
			object["parameters"] = json.RawMessage(`{"type":"object","properties":{"input":{"type":"string"}},"required":["input"]}`)
		}
		for _, key := range []string{"name", "description", "parameters", "strict"} {
			if field := object[key]; len(field) > 0 {
				if !first {
					out.WriteByte(',')
				}
				first = false
				keyJSON, _ := json.Marshal(key)
				out.Write(keyJSON)
				out.WriteByte(':')
				out.Write(field)
			}
		}
		out.WriteString(`}}`)
	}
	out.WriteByte(']')
	return out.Bytes(), nil
}

func reqBoolRaw(raw map[string]json.RawMessage, key string) bool {
	var v bool
	_ = json.Unmarshal(raw[key], &v)
	return v
}

func (h *Handler) forwardLargeResponses(w http.ResponseWriter, r *http.Request, model string, body io.Reader, messages io.ReadSeeker, stream bool, customTools map[string]bool) bool {
	recorder := newChatCapture()
	if stream {
		recorder.live = newLiveResponsesWriter(w, model)
	}
	defer recorder.close()
	chatReq, err := http.NewRequestWithContext(context.WithValue(context.WithValue(r.Context(), spoolKey{}, nil), internalResponsesKey{}, true), http.MethodPost, "/internal/responses-chat", body)
	if err != nil {
		return false
	}
	chatReq.Header = r.Header.Clone()
	chatReq.RemoteAddr = r.RemoteAddr
	h.chatCompletions(recorder, chatReq)
	if recorder.Code < 200 || recorder.Code >= 300 {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("upstream_error")
			return true
		}
		copyHTTPResponse(w, recorder)
		return true
	}
	chatResp := recorder.response
	if chatResp == nil {
		writeOpenAIError(w, http.StatusBadGateway, "upstream_parse", "chat adapter returned no response")
		return true
	}
	responseID := "resp_" + session.NewMessageID()
	if recorder.live != nil {
		responseID = recorder.live.id
	}
	response := chatResponseToResponses(chatResp, responseID, model, customTools)
	assistant, _ := responseChatMessages(chatResp)
	historyFile, err := os.CreateTemp("", "wb_responses_saved_*.tmp")
	if err != nil {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("history_storage_failed")
			return true
		}
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	defer func() { historyFile.Close(); os.Remove(historyFile.Name()) }()
	if assistant == nil {
		assistant = []map[string]any{}
	}
	assistantFile, err := os.CreateTemp("", "wb_responses_assistant_*.tmp")
	if err != nil {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("history_storage_failed")
			return true
		}
		writeOpenAIError(w, 500, "spool_error", err.Error())
		return true
	}
	defer func() { assistantFile.Close(); os.Remove(assistantFile.Name()) }()
	err = writeStreamingJSON(assistantFile, assistant)
	if err == nil {
		err = joinHistory(historyFile, messages, assistantFile)
	}
	if err == nil {
		err = h.cfg.History.PutReaderContext(r.Context(), responseID, historyFile)
	}
	if err != nil {
		if recorder.live != nil && recorder.live.started {
			recorder.live.fail("history_storage_failed")
			return true
		}
		writeOpenAIError(w, http.StatusInsufficientStorage, "history_storage_failed", "could not retain conversation history: "+err.Error())
		return true
	}
	if stream {
		if err := recorder.live.complete(response); err != nil {
			return true
		}
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := writeStreamingJSON(w, response); err != nil {
			return true
		}
	}
	finishSpool(r, true)
	return true
}

func largeCustomToolNames(raw json.RawMessage) map[string]bool {
	out := map[string]bool{}
	if len(raw) == 0 {
		return out
	}
	items, err := jsonscan.Array(bytes.NewReader(raw))
	if err != nil {
		return out
	}
	for _, item := range items {
		b := make([]byte, item.End-item.Start)
		copy(b, raw[item.Start:item.End])
		var obj map[string]json.RawMessage
		if json.Unmarshal(b, &obj) != nil {
			continue
		}
		var typ, name string
		_ = json.Unmarshal(obj["type"], &typ)
		_ = json.Unmarshal(obj["name"], &name)
		if typ == "custom" && name != "" {
			out[name] = true
		}
	}
	return out
}

func (h *Handler) saveResponseHistoryRaw(id string, messages []byte, assistant []map[string]any) error {
	base := bytes.TrimSpace(messages)
	if len(base) == 0 || base[0] != '[' || base[len(base)-1] != ']' {
		return errors.New("invalid generated message history")
	}
	base = bytes.TrimSpace(base[:len(base)-1])
	if len(assistant) == 0 {
		base = append(base, ']')
		return h.cfg.History.Put(id, base)
	}
	if len(base) > 1 {
		base = append(base, ',')
	}
	part, err := json.Marshal(assistant)
	if err != nil {
		return err
	}
	base = append(base, part[1:]...)
	return h.cfg.History.Put(id, base)
}

// rawResponsesToMap decodes only top-level values. Large strings and schemas are
// not part of a second full request object; they are decoded only by the
// selected semantic converter below.
func rawResponsesToMap(raw map[string]json.RawMessage) (map[string]any, error) {
	out := make(map[string]any, len(raw))
	for key, value := range raw {
		if len(value) > 64<<20 {
			return nil, fmt.Errorf("field %q exceeds the supported conversion limit", key)
		}
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			return nil, fmt.Errorf("invalid field %q: %w", key, err)
		}
		out[key] = decoded
	}
	return out, nil
}

var errRequestBodyTooLarge = fmt.Errorf("request body too large")

// decodeResponsesRequest decodes directly from the admitted body stream. The
// previous readBody+json.Unmarshal path retained a second full copy of large
// Responses requests after admission had already spilled them to disk.
func (h *Handler) decodeResponsesRequest(r *http.Request, dst *map[string]any) error {
	var src io.Reader = r.Body
	var limited *io.LimitedReader
	if h.cfg.MaxBodyBytes > 0 {
		limited = &io.LimitedReader{R: r.Body, N: h.cfg.MaxBodyBytes + 1}
		src = limited
	}
	dec := json.NewDecoder(src)
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if limited != nil && limited.N <= 0 {
			return errRequestBodyTooLarge
		}
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	if limited != nil && limited.N <= 0 {
		return errRequestBodyTooLarge
	}
	return nil
}

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

type chatCapture struct {
	Code     int
	header   http.Header
	Body     bytes.Buffer
	response map[string]any
	spool    *upstream.ResponseSpool
	live     *liveResponsesWriter
}

func newChatCapture() *chatCapture {
	return &chatCapture{Code: http.StatusOK, header: make(http.Header)}
}
func (c *chatCapture) Header() http.Header                     { return c.header }
func (c *chatCapture) WriteHeader(code int)                    { c.Code = code }
func (c *chatCapture) Write(p []byte) (int, error)             { return c.Body.Write(p) }
func (c *chatCapture) acceptChatResponse(value map[string]any) { c.response = value }
func (c *chatCapture) observeResponseText(text string) error {
	if c.live == nil {
		return nil
	}
	return c.live.text(text)
}
func (c *chatCapture) acceptResponseSpool(value *upstream.ResponseSpool) { c.spool = value }
func (c *chatCapture) close() {
	if c.spool != nil {
		_ = c.spool.Close()
	}
}

func copyHTTPResponse(w http.ResponseWriter, src *chatCapture) {
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
			if reasoning := message["reasoning_content"]; textPresent(reasoning) {
				response["output"] = append(response["output"].([]any), map[string]any{
					"type": "reasoning",
					"id":   "rs_" + responseID,
					"summary": []any{map[string]any{
						"type": "summary_text",
						"text": reasoning,
					}},
				})
			}
			if content := message["content"]; textPresent(content) {
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
			calls, _ := message["tool_calls"].([]any)
			if typed, ok := message["tool_calls"].([]map[string]any); ok {
				calls = make([]any, len(typed))
				for index := range typed {
					calls[index] = typed[index]
				}
			}
			if len(calls) > 0 {
				for index, rawCall := range calls {
					call, _ := rawCall.(map[string]any)
					fn, _ := call["function"].(map[string]any)
					callID, _ := call["id"].(string)
					if callID == "" {
						callID = fmt.Sprintf("call_%s_%d", responseID, index)
					}
					name, _ := fn["name"].(string)
					arguments := fn["arguments"]
					if arguments == nil {
						arguments = ""
					}
					if customTools[name] {
						response["output"] = append(response["output"].([]any), map[string]any{
							"type":    "custom_tool_call",
							"id":      "ctc_" + callID,
							"call_id": callID,
							"status":  "completed",
							"name":    name,
							"input":   customToolInputValue(arguments),
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

type responseEventWriter struct {
	http.ResponseWriter
	err error
}

// liveResponsesWriter emits text while the upstream is still producing it.
// Tool calls remain buffered until truncation checks and history commit succeed.
type liveResponsesWriter struct {
	w         *responseEventWriter
	id, model string
	sequence  int
	started   bool
}

func newLiveResponsesWriter(w http.ResponseWriter, model string) *liveResponsesWriter {
	return &liveResponsesWriter{w: &responseEventWriter{ResponseWriter: w}, id: "resp_" + session.NewMessageID(), model: model}
}
func (l *liveResponsesWriter) start() {
	if l.started {
		return
	}
	l.started = true
	l.w.Header().Set("Content-Type", "text/event-stream")
	l.w.Header().Set("Cache-Control", "no-cache")
	l.w.Header().Set("X-Accel-Buffering", "no")
	l.w.WriteHeader(http.StatusOK)
	writeResponsesEvent(l.w, "response.created", map[string]any{"type": "response.created", "sequence_number": l.sequence, "response": map[string]any{"id": l.id, "object": "response", "created_at": time.Now().Unix(), "status": "in_progress", "model": l.model, "output": []any{}, "output_text": ""}})
	l.sequence++
}
func (l *liveResponsesWriter) text(text string) error {
	l.start()
	if l.sequence == 1 {
		writeResponsesEvent(l.w, "response.output_item.added", map[string]any{"type": "response.output_item.added", "sequence_number": l.sequence, "output_index": 0, "item": map[string]any{"id": "msg_" + l.id, "type": "message", "status": "in_progress", "role": "assistant", "content": []any{}}})
		l.sequence++
		writeResponsesEvent(l.w, "response.content_part.added", map[string]any{"type": "response.content_part.added", "sequence_number": l.sequence, "item_id": "msg_" + l.id, "output_index": 0, "content_index": 0, "part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}}})
		l.sequence++
	}
	writeResponsesEvent(l.w, "response.output_text.delta", map[string]any{"type": "response.output_text.delta", "sequence_number": l.sequence, "item_id": "msg_" + l.id, "output_index": 0, "content_index": 0, "delta": text, "logprobs": []any{}})
	l.sequence++
	return l.w.err
}
func (l *liveResponsesWriter) fail(code string) {
	if l.w.err != nil {
		return
	}
	writeResponsesEvent(l.w, "response.failed", map[string]any{"type": "response.failed", "sequence_number": l.sequence, "response": map[string]any{"id": l.id, "object": "response", "status": "failed", "error": map[string]any{"code": code, "message": "Response could not be completed"}}})
}
func (l *liveResponsesWriter) complete(response map[string]any) error {
	if !l.started {
		return writeResponsesStream(l.w, response)
	}
	// Live text uses index zero. Keep the completed response and later tool
	// events consistent even when reasoning was produced before the text.
	if output, ok := response["output"].([]any); ok {
		for i, v := range output {
			if item, ok := v.(map[string]any); ok && item["type"] == "message" && i > 0 {
				copy(output[1:i+1], output[:i])
				output[0] = v
				break
			}
		}
	}
	writeResponsesEvent(l.w, "response.output_text.done", map[string]any{"type": "response.output_text.done", "sequence_number": l.sequence, "item_id": "msg_" + l.id, "output_index": 0, "content_index": 0, "text": response["output_text"], "logprobs": []any{}})
	l.sequence++
	if output, ok := response["output"].([]any); ok && len(output) > 0 {
		item, _ := output[0].(map[string]any)
		if item != nil && item["type"] == "message" {
			parts, _ := item["content"].([]any)
			if len(parts) > 0 {
				writeResponsesEvent(l.w, "response.content_part.done", map[string]any{"type": "response.content_part.done", "sequence_number": l.sequence, "item_id": "msg_" + l.id, "output_index": 0, "content_index": 0, "part": parts[0]})
				l.sequence++
			}
			writeResponsesEvent(l.w, "response.output_item.done", map[string]any{"type": "response.output_item.done", "sequence_number": l.sequence, "output_index": 0, "item": item})
			l.sequence++
		}
	}
	if l.w.err != nil {
		return l.w.err
	}
	return writeResponsesStreamTail(l.w, response, l.sequence, true)
}

func (w *responseEventWriter) Write(p []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	n, err := w.ResponseWriter.Write(p)
	if err != nil && w.err == nil {
		w.err = err
	}
	return n, err
}

func (w *responseEventWriter) Flush() {
	if w.err != nil {
		return
	}
	if fl, ok := w.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

func writeResponsesStream(w http.ResponseWriter, response map[string]any) error {
	return writeResponsesStreamTail(w, response, 0, false)
}

func writeResponsesStreamTail(w http.ResponseWriter, response map[string]any, sequence int, live bool) error {
	ew := &responseEventWriter{ResponseWriter: w}
	w = ew
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	if !live {
		// The created event replaces output entirely; copying its nested tree wastes
		// memory proportional to the completed response before discarding it.
		created := make(map[string]any, len(response))
		for key, value := range response {
			created[key] = value
		}
		created["status"] = "in_progress"
		created["output"] = []any{}
		created["output_text"] = ""
		writeResponsesEvent(w, "response.created", map[string]any{
			"type":            "response.created",
			"sequence_number": sequence,
			"response":        created,
		})
		sequence++
	}
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
				input := item["input"]
				if err := writeResponseDeltaChunks(input, func(part any) error {
					writeResponsesEvent(w, "response.custom_tool_call_input.delta", map[string]any{
						"type":            "response.custom_tool_call_input.delta",
						"sequence_number": sequence,
						"item_id":         itemID,
						"output_index":    outputIndex,
						"delta":           part,
					})
					sequence++
					return ew.err
				}); err != nil {
					return err
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
			arguments := item["arguments"]
			name, _ := item["name"].(string)
			if err := writeResponseDeltaChunks(arguments, func(part any) error {
				writeResponsesEvent(w, "response.function_call_arguments.delta", map[string]any{
					"type":            "response.function_call_arguments.delta",
					"sequence_number": sequence,
					"item_id":         itemID,
					"output_index":    outputIndex,
					"delta":           part,
				})
				sequence++
				return ew.err
			}); err != nil {
				return err
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
	if !live {
		if err := writeResponseDeltaChunks(response["output_text"], func(part any) error {
			writeResponsesEvent(w, "response.output_text.delta", map[string]any{
				"type":            "response.output_text.delta",
				"sequence_number": sequence,
				"item_id":         messageID,
				"output_index":    messageIndex,
				"content_index":   0,
				"delta":           part,
				"logprobs":        []any{},
			})
			sequence++
			return ew.err
		}); err != nil {
			return err
		}
	}
	writeResponsesEvent(w, "response.completed", map[string]any{
		"type":            "response.completed",
		"sequence_number": sequence,
		"response":        response,
	})
	return ew.err
}

// writeResponseDeltaChunks splits decoded text at UTF-8 boundaries. Completed
// events remain intact; only delta event boundaries change.
func writeResponseDeltaChunks(value any, emit func(any) error) error {
	var reader io.Reader
	switch v := value.(type) {
	case string:
		reader = strings.NewReader(v)
	case *upstream.SpoolText:
		reader = v.Reader()
	default:
		if textPresent(value) {
			return emit(value)
		}
		return nil
	}
	const chunkSize = 16 << 10
	r := bufio.NewReaderSize(reader, chunkSize)
	chunk := make([]byte, 0, chunkSize+utf8.UTFMax)
	for {
		ch, _, err := r.ReadRune()
		if err != nil && err != io.EOF {
			return err
		}
		if err == nil {
			chunk = utf8.AppendRune(chunk, ch)
		}
		if len(chunk) >= chunkSize || (err == io.EOF && len(chunk) > 0) {
			if e := emit(string(chunk)); e != nil {
				return e
			}
			chunk = chunk[:0]
		}
		if err == io.EOF {
			return nil
		}
	}
}

func writeResponsesEvent(w http.ResponseWriter, event string, value any) {
	_, _ = fmt.Fprintf(w, "event: %s\ndata: ", event)
	_ = writeStreamingJSON(w, value)
	_, _ = io.WriteString(w, "\n\n")
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
	if cloned, ok := cloneJSONTree(value, 0); ok {
		return cloned.(map[string]any)
	}
	// Preserve encoding/json normalization for non-JSON Go values.
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

// cloneJSONTree duplicates mutable JSON containers while reusing immutable
// strings, avoiding serialization and full-size copies for large content.
func cloneJSONTree(value any, depth int) (any, bool) {
	if depth > 256 {
		return nil, false
	}
	switch v := value.(type) {
	case nil, bool:
		return v, true
	case *upstream.SpoolText:
		return v, true
	case *spoolJSONString:
		return v, true
	case string:
		return v, utf8.ValidString(v)
	case float64:
		return v, !math.IsNaN(v) && !math.IsInf(v, 0)
	case map[string]any:
		if v == nil {
			return nil, true
		}
		out := make(map[string]any, len(v))
		for key, item := range v {
			if !utf8.ValidString(key) {
				return nil, false
			}
			cloned, ok := cloneJSONTree(item, depth+1)
			if !ok {
				return nil, false
			}
			out[key] = cloned
		}
		return out, true
	case []any:
		if v == nil {
			return nil, true
		}
		out := make([]any, len(v))
		for i, item := range v {
			cloned, ok := cloneJSONTree(item, depth+1)
			if !ok {
				return nil, false
			}
			out[i] = cloned
		}
		return out, true
	default:
		return nil, false
	}
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

// DefaultMemoryBufferThreshold 内存有界缓冲阈值：256KB
const DefaultMemoryBufferThreshold int64 = 256 * 1024

// RequestPayload 封装请求体接收状态（内存切片或私有临时文件）
type RequestPayload struct {
	Memory     []byte                        // 小请求（<= threshold）保存在内存中，保持最高性能与已有兼容
	File       *os.File                      // 超过 threshold 时的私有临时文件（写句柄在写入完成时安全关闭）
	Path       string                        // 私有临时文件绝对路径（用于请求结束时安全删除）
	Size       int64                         // 请求体实际大小
	IsSpool    bool                          // 是否溢出落盘
	cleaned    bool                          // 是否已被清理
	mu         sync.Mutex                    // 并发防护互斥锁
	readers    []io.Closer                   // 追踪所有由 OpenReader 生成且需统一回收的读句柄
	openStaged func() (io.ReadCloser, error) // pressure spool owns and deletes its file
}

// ReadPayload 从 http.Request 读取请求体：有界固定缓冲 + 超过阈值溢出到私有临时文件
func ReadPayload(r *http.Request, maxBytes int64, threshold int64) (*RequestPayload, error) {
	if threshold <= 0 {
		threshold = DefaultMemoryBufferThreshold
	}
	if maxBytes > 0 && threshold > maxBytes {
		threshold = maxBytes
	}

	var reader io.Reader = r.Body
	if maxBytes > 0 {
		reader = io.LimitReader(r.Body, maxBytes+1)
	}

	// 多读一个字节区分“恰好达到阈值”和“超过阈值”，避免临界小请求被误判为落盘。
	buf := make([]byte, threshold+1)
	n, err := io.ReadFull(reader, buf)
	if err != nil && err != io.EOF && !errors.Is(err, io.ErrUnexpectedEOF) {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errRequestBodyTooLarge
		}
		return nil, err
	}

	if err == io.EOF || errors.Is(err, io.ErrUnexpectedEOF) {
		mem := buf[:n]
		if maxBytes > 0 && int64(len(mem)) > maxBytes {
			return nil, errRequestBodyTooLarge
		}
		return &RequestPayload{
			Memory:  mem,
			Size:    int64(n),
			IsSpool: false,
		}, nil
	}

	// 临界突破：请求体大小已确凿超过 threshold，创建私有临时文件落盘
	tmpFile, err := os.CreateTemp("", "wb_req_spool_*.tmp")
	if err != nil {
		return nil, fmt.Errorf("create private spool temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	// 权限严格收紧为 0600（仅属主私有读写，杜绝共享系统下敏感 prompt 泄露）
	_ = tmpFile.Chmod(0600)

	cleanupOnError := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}

	if _, err := tmpFile.Write(buf[:n]); err != nil {
		cleanupOnError()
		return nil, fmt.Errorf("write initial buffer to spool file: %w", err)
	}

	copyBuf := make([]byte, 32*1024)
	written, err := io.CopyBuffer(tmpFile, reader, copyBuf)
	if err != nil {
		cleanupOnError()
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errRequestBodyTooLarge
		}
		return nil, err
	}

	totalSize := int64(n) + written
	if maxBytes > 0 && totalSize > maxBytes {
		cleanupOnError()
		return nil, errRequestBodyTooLarge
	}

	if err := tmpFile.Sync(); err != nil {
		cleanupOnError()
		return nil, fmt.Errorf("sync spool file: %w", err)
	}
	// 写入完成后立即关闭写入句柄，防止 Windows 平台句柄共享冲突影响随后的并发只读与最终删除
	_ = tmpFile.Close()

	payload := &RequestPayload{
		Memory:  buf[:n], // 内存中保留至多 threshold+1 字节前缀供快速 Peek 探测，杜绝全量读回
		Path:    tmpPath,
		Size:    totalSize,
		IsSpool: true,
	}

	// 终身兜底：若调用方发生未捕获 panic 或泄露未 Close，由 GC 终结器强制回收物理磁盘文件
	runtime.SetFinalizer(payload, func(p *RequestPayload) {
		_ = p.Close()
	})

	return payload, nil
}

func (h *Handler) readPayload(r *http.Request) (*RequestPayload, error) {
	if job, ok := r.Context().Value(spoolKey{}).(*spool.Job); ok {
		// admission already verified and opened the staged body; reuse the same
		// file instead of copying it into a second temporary request file.
		prefix := make([]byte, DefaultMemoryBufferThreshold+1)
		n, err := io.ReadFull(r.Body, prefix)
		if err != nil && err != io.EOF && !errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, err
		}
		if job.Size() <= DefaultMemoryBufferThreshold {
			return &RequestPayload{Memory: prefix[:n], Size: job.Size()}, nil
		}
		return &RequestPayload{Memory: prefix[:n], Size: job.Size(), IsSpool: true, openStaged: job.Open}, nil
	}
	limit := h.cfg.MaxBodyBytes
	if r.Context().Value(internalResponsesKey{}) != nil {
		limit = 520 << 20
	}
	return ReadPayload(r, limit, DefaultMemoryBufferThreshold)
}

// OpenReaderAt opens the admitted payload for bounded span copies. The returned
// closer owns the underlying file descriptor; callers must close it.
func (p *RequestPayload) OpenReaderAt() (io.ReaderAt, io.Closer, error) {
	if p == nil {
		return nil, nil, errors.New("nil request payload")
	}
	p.mu.Lock()
	if p.cleaned {
		p.mu.Unlock()
		return nil, nil, errors.New("request payload already closed")
	}
	if !p.IsSpool {
		data := append([]byte(nil), p.Memory...)
		p.mu.Unlock()
		return bytes.NewReader(data), io.NopCloser(strings.NewReader("")), nil
	}
	open := p.openStaged
	path := p.Path
	p.mu.Unlock()
	var rc io.ReadCloser
	var err error
	if open != nil {
		rc, err = open()
	} else {
		rc, err = os.Open(path)
	}
	if err != nil {
		return nil, nil, err
	}
	ra, ok := rc.(io.ReaderAt)
	if !ok {
		rc.Close()
		return nil, nil, errors.New("spool reader does not support ReaderAt")
	}
	return ra, rc, nil
}

// Close 在请求生命周期结束时安全清理资源，关闭所有活跃 Reader 并彻底从磁盘物理销毁临时文件
func (p *RequestPayload) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	if p.cleaned {
		p.mu.Unlock()
		return nil
	}
	p.cleaned = true
	path := p.Path
	p.Path = ""
	p.Memory = nil

	var firstErr error
	// 1. 关闭所有由 OpenReader 分配且尚未释放的句柄（幂等安全：忽略已由调用方主动关闭的 ErrClosed）
	for _, r := range p.readers {
		if r != nil {
			if err := r.Close(); err != nil && !errors.Is(err, os.ErrClosed) && !strings.Contains(err.Error(), "already closed") && firstErr == nil {
				firstErr = err
			}
		}
	}
	p.readers = nil

	// 2. 关闭可能遗留的写句柄
	if p.File != nil {
		if err := p.File.Close(); err != nil && !errors.Is(err, os.ErrClosed) && firstErr == nil {
			firstErr = err
		}
		p.File = nil
	}
	p.mu.Unlock()

	// 3. 彻底物理销毁临时文件（带微重试防御 Windows 句柄释放延迟与共享违规）
	if path != "" {
		for attempt := 0; attempt < 8; attempt++ {
			err := os.Remove(path)
			if err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(time.Duration(10*(attempt+1)) * time.Millisecond)
			if attempt == 7 && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// OpenReader 获取一个可独立读取的 ReadCloser（支持重复读取/轮转重试）
func (p *RequestPayload) OpenReader() (io.ReadCloser, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cleaned {
		return nil, fmt.Errorf("request payload already closed")
	}
	if !p.IsSpool {
		return io.NopCloser(bytes.NewReader(p.Memory)), nil
	}
	var f io.ReadCloser
	var err error
	if p.openStaged != nil {
		f, err = p.openStaged()
	} else {
		f, err = os.Open(p.Path)
	}
	if err != nil {
		return nil, fmt.Errorf("open spool file reader: %w", err)
	}
	p.readers = append(p.readers, f)
	return f, nil
}

// Bytes 返回完整请求体字节切片（大请求在内存受控下慎用，避免 OOM）
func (p *RequestPayload) Bytes() ([]byte, error) {
	if !p.IsSpool {
		return p.Memory, nil
	}
	r, err := p.OpenReader()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

// Peek 返回请求体的前 n 个字节，供快速探测协议头，严禁将全量大文件读入内存
func (p *RequestPayload) Peek(n int) []byte {
	if len(p.Memory) == 0 {
		return nil
	}
	if n <= 0 || n > len(p.Memory) {
		return p.Memory
	}
	return p.Memory[:n]
}

// HasConversationID 检查请求体中是否包含 conversation_id 或 conversationId 标识。
// 对落盘的超大请求使用 32KB 分块流式滑动窗口扫描，零全量内存读回，绝不截断上下文。
func (p *RequestPayload) HasConversationID() bool {
	if p == nil {
		return false
	}
	targets := [][]byte{
		[]byte(`"conversation_id"`),
		[]byte(`"conversationId"`),
		[]byte(`'conversation_id'`),
		[]byte(`'conversationId'`),
	}
	if !p.IsSpool {
		for _, tgt := range targets {
			if bytes.Contains(p.Memory, tgt) {
				return true
			}
		}
		return false
	}

	// 大请求流式分块扫描
	f, err := p.OpenReader()
	if err != nil {
		return false
	}
	defer f.Close()

	buf := make([]byte, 32*1024)
	overlap := 64
	tail := 0

	for {
		n, err := f.Read(buf[tail:])
		total := tail + n
		if total > 0 {
			window := buf[:total]
			for _, tgt := range targets {
				if bytes.Contains(window, tgt) {
					return true
				}
			}
		}
		if err != nil {
			break
		}
		if total > overlap {
			copy(buf[:overlap], buf[total-overlap:total])
			tail = overlap
		} else {
			tail = total
		}
	}
	return false
}

// IsUnmodifiedStream 快速检查大请求前缀是否具备原生合规流式特征（包含 stream:true 与 stream_options 且不含 max_completion_tokens），
// 支持超大请求免整包内存读回而直接流式转发。
func (p *RequestPayload) IsUnmodifiedStream() bool {
	if p == nil {
		return false
	}
	prefix := p.Peek(64 * 1024)
	if len(prefix) == 0 {
		return false
	}
	// 检查是否包含 stream:true
	hasStreamTrue := bytes.Contains(prefix, []byte(`"stream":true`)) ||
		bytes.Contains(prefix, []byte(`"stream": true`))
	if !hasStreamTrue {
		return false
	}
	// 检查是否包含 stream_options
	hasStreamOptions := bytes.Contains(prefix, []byte(`"stream_options"`))
	if !hasStreamOptions {
		return false
	}
	// 不能包含需翻译的 max_completion_tokens
	if bytes.Contains(prefix, []byte(`"max_completion_tokens"`)) {
		return false
	}
	return true
}

// joinHistory concatenates two JSON arrays without materializing their elements.
func joinHistory(dst io.Writer, first, second io.ReadSeeker) error {
	copyArray := func(r io.ReadSeeker, prefixComma bool) (bool, error) {
		n, err := r.Seek(0, io.SeekEnd)
		if err != nil {
			return false, err
		}
		if n < 2 {
			return false, errors.New("invalid history array")
		}
		if _, err = r.Seek(0, io.SeekStart); err != nil {
			return false, err
		}
		var left [1]byte
		if _, err = io.ReadFull(r, left[:]); err != nil || left[0] != '[' {
			return false, errors.New("invalid history array")
		}
		if _, err = r.Seek(n-1, io.SeekStart); err != nil {
			return false, err
		}
		var right [1]byte
		if _, err = io.ReadFull(r, right[:]); err != nil || right[0] != ']' {
			return false, errors.New("invalid history array")
		}
		if n == 2 {
			return false, nil
		}
		if prefixComma {
			if _, err = io.WriteString(dst, ","); err != nil {
				return false, err
			}
		}
		if _, err = r.Seek(1, io.SeekStart); err != nil {
			return false, err
		}
		_, err = io.CopyN(dst, r, n-2)
		return true, err
	}
	if _, err := io.WriteString(dst, "["); err != nil {
		return err
	}
	has, err := copyArray(first, false)
	if err != nil {
		return err
	}
	if _, err = copyArray(second, has); err != nil {
		return err
	}
	_, err = io.WriteString(dst, "]")
	return err
}

type internalResponsesKey struct{}

func writeLargeToolsAt(dst io.Writer, ra io.ReaderAt, span jsonscan.Span) (map[string]bool, error) {
	items, err := jsonscan.Array(io.NewSectionReader(ra, span.Start, span.End-span.Start))
	if err != nil {
		return nil, err
	}
	out := bufio.NewWriterSize(dst, 32<<10)
	custom := map[string]bool{}
	out.WriteByte('[')
	for i, item := range items {
		item.Start += span.Start
		item.End += span.Start
		fields, err := jsonscan.Object(io.NewSectionReader(ra, item.Start, item.End-item.Start))
		if err != nil {
			return nil, errors.New("tool must be an object")
		}
		byKey := map[string]jsonscan.Span{}
		for _, f := range fields {
			f.Start += item.Start
			f.End += item.Start
			byKey[f.Key] = f
		}
		for _, key := range []string{"type", "name"} {
			f := byKey[key]
			if f.End-f.Start > 65536 {
				return nil, errors.New("tool type or name too large")
			}
		}
		typ := readStringAt(ra, byKey["type"], 0)
		name := readStringAt(ra, byKey["name"], 0)
		if typ != "function" && typ != "custom" {
			return nil, fmt.Errorf("unsupported tool type %q", typ)
		}
		if typ == "custom" && name != "" {
			custom[name] = true
		}
		if i > 0 {
			out.WriteByte(',')
		}
		out.WriteString(`{"type":"function","function":{`)
		first := true
		for _, key := range []string{"name", "description", "parameters", "strict"} {
			field, ok := byKey[key]
			if !ok {
				continue
			}
			if !first {
				out.WriteByte(',')
			}
			first = false
			k, _ := json.Marshal(key)
			out.Write(k)
			out.WriteByte(':')
			if err := jsonscan.CopySpan(out, ra, field); err != nil {
				return nil, err
			}
		}
		if _, ok := byKey["parameters"]; typ == "custom" && !ok {
			obj := map[string]any{}
			if f, ok := byKey["format"]; ok {
				if f.End-f.Start > 1<<20 {
					return nil, errors.New("custom tool format too large")
				}
				b := make([]byte, f.End-f.Start)
				if _, err = ra.ReadAt(b, f.Start); err != nil && err != io.EOF {
					return nil, err
				}
				var format any
				if err = json.Unmarshal(b, &format); err != nil {
					return nil, err
				}
				obj["format"] = format
			}
			schema, err := json.Marshal(customToolSchema(obj))
			if err != nil {
				return nil, err
			}
			if !first {
				out.WriteByte(',')
			}
			out.WriteString(`"parameters":`)
			out.Write(schema)
		}
		out.WriteString(`}}`)
	}
	out.WriteByte(']')
	if err := out.Flush(); err != nil {
		return nil, err
	}
	return custom, nil
}

// writeStreamingJSON bounds encoding allocations for large strings while retaining
// encoding/json escaping and UTF-8 replacement semantics.
func writeStreamingJSON(dst io.Writer, value any) error {
	out := bufio.NewWriterSize(dst, 32<<10)
	var write func(reflect.Value) error
	write = func(v reflect.Value) error {
		if v.IsValid() && v.CanInterface() {
			if text, ok := v.Interface().(*upstream.SpoolText); ok {
				return writeSpoolJSONString(out, text.Reader())
			}
			if text, ok := v.Interface().(*spoolJSONString); ok {
				_, err := io.Copy(out, io.NewSectionReader(text.source, text.span.Start, text.span.End-text.span.Start))
				return err
			}
		}
		if !v.IsValid() {
			_, e := out.WriteString("null")
			return e
		}
		if v.Kind() == reflect.Interface || v.Kind() == reflect.Pointer {
			if v.IsNil() {
				_, e := out.WriteString("null")
				return e
			}
			return write(v.Elem())
		}
		switch v.Kind() {
		case reflect.String:
			text := v.String()
			if err := out.WriteByte('"'); err != nil {
				return err
			}
			for len(text) > 0 {
				n := len(text)
				if n > 16384 {
					n = 16384
					for n > 0 && !utf8.RuneStart(text[n]) {
						n--
					}
				}
				if n == 0 {
					n = 1
				}
				encoded, err := json.Marshal(text[:n])
				if err != nil {
					return err
				}
				if _, err = out.Write(encoded[1 : len(encoded)-1]); err != nil {
					return err
				}
				text = text[n:]
			}
			return out.WriteByte('"')
		case reflect.Map:
			if v.IsNil() {
				_, e := out.WriteString("null")
				return e
			}
			if v.Type().Key().Kind() != reflect.String {
				break
			}
			keys := v.MapKeys()
			sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
			if err := out.WriteByte('{'); err != nil {
				return err
			}
			for i, k := range keys {
				if i > 0 {
					if err := out.WriteByte(','); err != nil {
						return err
					}
				}
				if err := write(k); err != nil {
					return err
				}
				if err := out.WriteByte(':'); err != nil {
					return err
				}
				if err := write(v.MapIndex(k)); err != nil {
					return err
				}
			}
			return out.WriteByte('}')
		case reflect.Slice, reflect.Array:
			if v.Kind() == reflect.Slice && v.IsNil() {
				_, e := out.WriteString("null")
				return e
			}
			if v.Type().Elem().Kind() == reflect.Uint8 {
				break
			}
			if err := out.WriteByte('['); err != nil {
				return err
			}
			for i := 0; i < v.Len(); i++ {
				if i > 0 {
					if err := out.WriteByte(','); err != nil {
						return err
					}
				}
				if err := write(v.Index(i)); err != nil {
					return err
				}
			}
			return out.WriteByte(']')
		}
		if !v.CanInterface() {
			return errors.New("cannot encode JSON value")
		}
		b, err := json.Marshal(v.Interface())
		if err != nil {
			return err
		}
		_, err = out.Write(b)
		return err
	}
	if err := write(reflect.ValueOf(value)); err != nil {
		return err
	}
	return out.Flush()
}

func writeSpoolJSONString(out *bufio.Writer, reader io.Reader) error {
	if err := out.WriteByte('"'); err != nil {
		return err
	}
	r := bufio.NewReaderSize(reader, 32<<10)
	buf := make([]byte, 0, 16384)
	for {
		ch, size, err := r.ReadRune()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if size == 1 && ch == utf8.RuneError {
			ch = utf8.RuneError
		}
		buf = utf8.AppendRune(buf, ch)
		if len(buf) >= 16380 {
			encoded, e := json.Marshal(string(buf))
			if e != nil {
				return e
			}
			if _, e = out.Write(encoded[1 : len(encoded)-1]); e != nil {
				return e
			}
			buf = buf[:0]
		}
	}
	if len(buf) > 0 {
		encoded, err := json.Marshal(string(buf))
		if err != nil {
			return err
		}
		if _, err = out.Write(encoded[1 : len(encoded)-1]); err != nil {
			return err
		}
	}
	return out.WriteByte('"')
}

func textPresent(v any) bool {
	switch t := v.(type) {
	case string:
		return t != ""
	case *upstream.SpoolText:
		return t.Len() > 0
	case *spoolJSONString:
		return t.span.End-t.span.Start > 2
	}
	return false
}

type spoolJSONString struct {
	source io.ReaderAt
	span   jsonscan.Span
}

func customToolInputValue(v any) any {
	if text, ok := v.(string); ok {
		return customToolInput(text)
	}
	source, ok := v.(*upstream.SpoolText)
	if !ok {
		return v
	}
	reader, ok := source.Reader().(io.ReaderAt)
	if !ok {
		return v
	}
	spans, err := jsonscan.Object(source.Reader())
	if err != nil {
		return v
	}
	var input jsonscan.Span
	for _, span := range spans {
		if span.Key == "input" {
			input = span
		}
	}
	if input.End <= input.Start {
		return v
	}
	var first [1]byte
	if _, err = reader.ReadAt(first[:], input.Start); err != nil || first[0] != '"' {
		return v
	}
	return &spoolJSONString{reader, input}
}
