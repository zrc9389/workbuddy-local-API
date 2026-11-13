// output_budget.go 输出预算下限与目录上限注入：防止高思考档位下思考内容耗尽较小的 max_tokens 预算，
// 并在未显式携带 max_tokens 时从模型目录补全真实上限。
package upstream

import (
	"log"
	"strconv"
	"strings"
)

// minBudgetByEffort 各思考档位下保证正文仍可输出的最小 max_tokens 预算下限。
var minBudgetByEffort = map[string]int64{
	"minimal": 4096,
	"low":     4096,
	"medium":  6144,
	"high":    8192,
	"xhigh":   12288,
	"max":     16384,
}

// minOutputBudgetProbe 低于该阈值的额度视为探活请求，不做抬升。
const minOutputBudgetProbe = 16

// injectCatalogMaxTokens 当请求未显式指定 max_tokens 且 maxOut 中模型上限 > 0 时注入 max_tokens。
func injectCatalogMaxTokens(obj map[string]any, maxOut map[string]int64) {
	if len(maxOut) == 0 {
		return
	}
	if _, has := obj["max_tokens"]; has {
		return
	}
	model, _ := obj["model"].(string)
	if capVal, ok := lookupMaxOutputCap(maxOut, model); ok && capVal > 0 {
		obj["max_tokens"] = capVal
	}
}

// MinOutputBudget 返回指定思考档位对应的最小输出预算；未知档位返回 0。
func MinOutputBudget(effort string) int64 {
	return minBudgetByEffort[strings.ToLower(strings.TrimSpace(effort))]
}

// EnsureMinBudget 将 obj 的 max_tokens 抬升至不低于 floor（floor<=0 或探活级额度不动）。
func EnsureMinBudget(obj map[string]any, floor int64) bool {
	if floor <= 0 {
		return false
	}
	cur, ok := explicitOutputBudget(obj)
	if !ok || cur <= 0 || cur < minOutputBudgetProbe || cur >= floor {
		return false
	}
	obj["max_tokens"] = floor
	return true
}

// ensureMinOutputBudget 在客户端显式传入较小输出预算且思考处于开启状态时抬升至对应档位下限，
// 同时受目录 maxOut[model] 物理上限封顶。
func ensureMinOutputBudget(obj map[string]any, effort string, maxOut map[string]int64) {
	cur, ok := explicitOutputBudget(obj)
	if !ok || cur <= 0 || cur < minOutputBudgetProbe {
		return
	}
	floor, has := minBudgetByEffort[strings.ToLower(strings.TrimSpace(effort))]
	if !has {
		return
	}
	if thinkingDisabled(obj) {
		return
	}
	if model, _ := obj["model"].(string); len(maxOut) > 0 {
		if capVal, ok := lookupMaxOutputCap(maxOut, model); ok && capVal > 0 && floor > capVal {
			floor = capVal
		}
	}
	if cur >= floor {
		return
	}
	obj["max_tokens"] = floor
	log.Printf("INFO: [budget] max_tokens %d -> %d (effort=%s)", cur, floor, effort)
}

// ThinkingSwitchSupported 报告该模型是否支持通过 thinking.type 控制思维链开关（DeepSeek 系列）。
func ThinkingSwitchSupported(model string) bool {
	_, bare := SplitRealmPrefix(model)
	return isDeepSeekModel(bare)
}

func lookupMaxOutputCap(maxOut map[string]int64, model string) (int64, bool) {
	if model == "" || len(maxOut) == 0 {
		return 0, false
	}
	if val, ok := maxOut[model]; ok {
		return val, true
	}
	if _, bare := SplitRealmPrefix(model); bare != model {
		if val, ok := maxOut[bare]; ok {
			return val, true
		}
	}
	return 0, false
}

func explicitOutputBudget(obj map[string]any) (int64, bool) {
	for _, key := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
		switch typed := obj[key].(type) {
		case float64:
			return int64(typed), true
		case int:
			return int64(typed), true
		case int64:
			return typed, true
		case string:
			if parsed := parseInt64(typed); parsed > 0 {
				return parsed, true
			}
		}
	}
	return 0, false
}

func thinkingDisabled(obj map[string]any) bool {
	if th, ok := obj["thinking"].(map[string]any); ok {
		if typ, _ := th["type"].(string); strings.EqualFold(strings.TrimSpace(typ), "disabled") {
			return true
		}
	}
	for _, key := range []string{"reasoning_effort", "reasoningEffort"} {
		if val, ok := obj[key].(string); ok {
			switch strings.ToLower(strings.TrimSpace(val)) {
			case "off", "none", "disabled":
				return true
			}
		}
	}
	return false
}

func parseInt64(raw string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}
