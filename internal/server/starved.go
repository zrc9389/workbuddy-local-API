package server

import (
	"encoding/json"
	"strings"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

const minStarvedBudget = 16

func aggregateStarved(resp map[string]any) bool {
	choices, _ := resp["choices"].([]any)
	if len(choices) == 0 {
		return false
	}
	first, _ := choices[0].(map[string]any)
	if first == nil {
		return false
	}
	fr, _ := first["finish_reason"].(string)
	msg, _ := first["message"].(map[string]any)
	if msg == nil {
		return false
	}
	if s, _ := msg["content"].(string); strings.TrimSpace(s) != "" {
		return false
	}
	if tcs, _ := msg["tool_calls"].([]any); len(tcs) > 0 {
		return false
	}
	if fr == "length" {
		return true
	}
	if fr == "stop" {
		if rc, _ := msg["reasoning_content"].(string); strings.TrimSpace(rc) != "" {
			return true
		}
		if r, _ := msg["reasoning"].(string); strings.TrimSpace(r) != "" {
			return true
		}
	}
	return false
}

func starvedRetryBodyWithFloor(body []byte, floor int64) ([]byte, bool) {
	if len(body) == 0 {
		return nil, false
	}
	var obj map[string]any
	if json.Unmarshal(body, &obj) != nil {
		return nil, false
	}
	if bt := starvedOutputBudget(obj); bt > 0 && bt < minStarvedBudget {
		return nil, false
	}
	th, ok := obj["thinking"].(map[string]any)
	if !ok {
		model, _ := obj["model"].(string)
		if !upstream.ThinkingSwitchSupported(model) {
			return nil, false
		}
		th = map[string]any{}
	}
	if t, _ := th["type"].(string); strings.EqualFold(strings.TrimSpace(t), "disabled") {
		return nil, false
	}
	th["type"] = "disabled"
	obj["thinking"] = th
	delete(obj, "reasoning_effort")
	delete(obj, "reasoningEffort")
	upstream.EnsureMinBudget(obj, floor)
	out, err := json.Marshal(obj)
	if err != nil {
		return nil, false
	}
	return out, true
}

func starvedOutputBudget(obj map[string]any) int {
	for _, key := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
		switch v := obj[key].(type) {
		case float64:
			return int(v)
		case int:
			return v
		case int64:
			return int(v)
		}
	}
	return 0
}
