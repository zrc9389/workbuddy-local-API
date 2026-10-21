package upstream

import (
	"encoding/json"
	"errors"
)

// ValidateStrictHistory rejects malformed tool histories instead of letting the
// compatibility cleanup silently remove a call/result or move intervening text.
func ValidateStrictHistory(body []byte) error {
	var v struct {
		Messages []struct {
			Role       string `json:"role"`
			ToolCallID string `json:"tool_call_id"`
			ToolCalls  []struct {
				ID string `json:"id"`
			} `json:"tool_calls"`
		} `json:"messages"`
	}
	if e := json.Unmarshal(body, &v); e != nil {
		return e
	}
	pending := map[string]bool{}
	seen := map[string]bool{}
	for _, m := range v.Messages {
		if m.Role == "tool" {
			if m.ToolCallID == "" || !pending[m.ToolCallID] {
				return errors.New("orphan or duplicate tool result; complete the original history")
			}
			delete(pending, m.ToolCallID)
			continue
		}
		if len(pending) > 0 {
			return errors.New("incomplete tool-result block; history retained, not silently repaired")
		}
		if len(m.ToolCalls) > 0 {
			if m.Role != "assistant" {
				return errors.New("tool calls must belong to assistant")
			}
			for _, c := range m.ToolCalls {
				if c.ID == "" || seen[c.ID] {
					return errors.New("invalid or duplicate tool call ID")
				}
				pending[c.ID] = true
				seen[c.ID] = true
			}
		}
	}
	if len(pending) > 0 {
		return errors.New("missing tool results; history retained, not silently removed")
	}
	return nil
}
