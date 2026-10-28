package upstream

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/linguo2625469/workbuddy2api-panel/internal/jsonscan"
)

// ValidateStrictHistoryAt checks tool-call continuity without decoding message content.
func ValidateStrictHistoryAt(source io.ReaderAt, size int64) error {
	fields, err := jsonscan.Object(io.NewSectionReader(source, 0, size))
	if err != nil {
		return err
	}
	var messages jsonscan.Span
	for _, field := range fields {
		if field.Key == "messages" {
			messages = field
		}
	}
	if messages.End == messages.Start {
		return nil
	}
	first := []byte{0}
	if _, err = source.ReadAt(first, messages.Start); err != nil {
		return err
	}
	if first[0] == 'n' {
		return nil
	}
	if first[0] != '[' {
		return errors.New("messages must be an array")
	}
	items, err := jsonscan.Array(io.NewSectionReader(source, messages.Start, messages.End-messages.Start))
	if err != nil {
		return err
	}
	pending, seen := map[string]bool{}, map[string]bool{}
	for _, item := range items {
		item.Start += messages.Start
		item.End += messages.Start
		if _, err := source.ReadAt(first, item.Start); err != nil {
			return err
		}
		if first[0] == 'n' {
			if len(pending) > 0 {
				return errors.New("incomplete tool-result block; history retained, not silently repaired")
			}
			continue
		}
		object, err := jsonscan.Object(io.NewSectionReader(source, item.Start, item.End-item.Start))
		if err != nil {
			return err
		}
		var role, resultID string
		var calls jsonscan.Span
		for _, field := range object {
			field.Start += item.Start
			field.End += item.Start
			switch field.Key {
			case "role":
				role, err = strictString(source, field, role)
			case "tool_call_id":
				resultID, err = strictString(source, field, resultID)
			case "tool_calls":
				calls = field
			}
			if err != nil {
				return err
			}
		}
		if role == "tool" {
			if resultID == "" || !pending[resultID] {
				return errors.New("orphan or duplicate tool result; complete the original history")
			}
			delete(pending, resultID)
			continue
		}
		if len(pending) > 0 {
			return errors.New("incomplete tool-result block; history retained, not silently repaired")
		}
		if calls.End == calls.Start {
			continue
		}
		if _, err = source.ReadAt(first, calls.Start); err != nil {
			return err
		}
		if first[0] == 'n' {
			continue
		}
		if first[0] != '[' {
			return errors.New("tool_calls must be an array")
		}
		callItems, err := jsonscan.Array(io.NewSectionReader(source, calls.Start, calls.End-calls.Start))
		if err != nil {
			return err
		}
		if len(callItems) > 0 && role != "assistant" {
			return errors.New("tool calls must belong to assistant")
		}
		for _, call := range callItems {
			call.Start += calls.Start
			call.End += calls.Start
			if _, err := source.ReadAt(first, call.Start); err != nil {
				return err
			}
			if first[0] == 'n' {
				return errors.New("invalid or duplicate tool call ID")
			}
			fields, err := jsonscan.Object(io.NewSectionReader(source, call.Start, call.End-call.Start))
			if err != nil {
				return err
			}
			var id string
			for _, field := range fields {
				if field.Key == "id" {
					field.Start += call.Start
					field.End += call.Start
					id, err = strictString(source, field, id)
					if err != nil {
						return err
					}
				}
			}
			if id == "" || seen[id] {
				return errors.New("invalid or duplicate tool call ID")
			}
			pending[id] = true
			seen[id] = true
		}
	}
	if len(pending) > 0 {
		return errors.New("missing tool results; history retained, not silently removed")
	}
	return nil
}
func strictString(source io.ReaderAt, span jsonscan.Span, previous string) (string, error) {
	if span.End-span.Start > 65536 {
		return "", fmt.Errorf("history identifier exceeds 65536 bytes")
	}
	raw := make([]byte, span.End-span.Start)
	if _, err := source.ReadAt(raw, span.Start); err != nil && err != io.EOF {
		return "", err
	}
	value := previous
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}
