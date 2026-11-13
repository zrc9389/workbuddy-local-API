// payload.go 改写发往上游的 chat 请求体：
//  1. 剥离 realm 前缀并强制 stream:true（上游只认裸名且拒绝非流式）
//  2. max_completion_tokens 翻译、GPT 下限钳位、目录输出上限与预算下限兜底
//  3. tool_choice / schema / role / image_url 归一化与 tool 配对修复
//  4. DeepSeek 思维链注入与多轮回填、空 text 段兜底、reasoning 镜像及指纹脱敏
package upstream

import (
	"encoding/json"
	"log"
	"math"
	"strings"
)

// LargePayloadThreshold 超过 256KB 的大请求判定阈值（供 client/chat 流式通道判断）。
const LargePayloadThreshold = 256 * 1024

// SplitRealmPrefix 解析网关的 realm 前缀协议（"[realm:]model"）：
// 取第一个 ":"，前段恰为 "cn" 或 "global" 时剥离；否则视为裸模型名，realm 回落 "cn"。
func SplitRealmPrefix(model string) (realm, bare string) {
	if idx := strings.IndexByte(model, ':'); idx >= 0 {
		switch model[:idx] {
		case "cn", "global":
			return model[:idx], model[idx+1:]
		}
	}
	return "cn", model
}

// normalizeModelName 将出站请求体的 model 字段剥离 realm 前缀，保留裸模型名。
func normalizeModelName(obj map[string]any) {
	cur, ok := obj["model"].(string)
	if !ok {
		return
	}
	if _, bare := SplitRealmPrefix(cur); bare != cur {
		obj["model"] = bare
	}
}

// PrepareBodyOpt 单 pass 改写；sanitize=false 时不执行黑名单指纹脱敏。
func PrepareBodyOpt(src []byte, sanitize bool) []byte {
	return PrepareBodyOptWithEffortsAndDefault(src, sanitize, nil, nil)
}

// PrepareBodyOptWithEfforts 在 PrepareBodyOpt 基础上按模型 supportedEfforts 降级 reasoning_effort。
func PrepareBodyOptWithEfforts(src []byte, sanitize bool, efforts map[string][]string) []byte {
	return PrepareBodyOptWithEffortsAndDefault(src, sanitize, efforts, nil)
}

// PrepareBodyOptWithEffortsAndDefault 完整管线向后兼容入口（不传入 maxOut 目录上限）。
func PrepareBodyOptWithEffortsAndDefault(src []byte, sanitize bool, efforts map[string][]string, defaultEfforts map[string]string) []byte {
	body, _ := PrepareBodyOptWithEffortsDefaultAndCaps(src, sanitize, efforts, defaultEfforts, nil)
	return body
}

// PrepareBodyOptWithEffortsDefaultAndCaps 完整出站改写管线（含 maxOut 输出预算补齐与下限保护），
// 返回改写后的请求体字节切片与本次实际生效的思考档位字符串。
func PrepareBodyOptWithEffortsDefaultAndCaps(src []byte, sanitize bool, efforts map[string][]string, defaultEfforts map[string]string, maxOut map[string]int64) ([]byte, string) {
	return prepareBodyOpt(src, sanitize, efforts, defaultEfforts, maxOut)
}

func prepareBodyOpt(src []byte, sanitize bool, efforts map[string][]string, defaultEfforts map[string]string, maxOut map[string]int64) ([]byte, string) {
	if len(src) == 0 {
		return src, ""
	}
	var obj map[string]any
	if err := json.Unmarshal(src, &obj); err != nil {
		return src, ""
	}
	normalizeModelName(obj)
	obj["stream"] = true
	translateMaxCompletionTokens(obj)
	clampGPTMinMaxTokens(obj)
	if maxOut != nil {
		injectCatalogMaxTokens(obj, maxOut)
	}
	// stream_options 仅当 body 未显式带时补 {include_usage: true}（D7）：
	// 官方 CLI 流式必发该字段，上游据此在末帧返回 usage 用量；显式带则不覆盖。
	if _, has := obj["stream_options"]; !has {
		obj["stream_options"] = map[string]any{"include_usage": true}
	}
	normalizeToolChoice(obj)
	normalizeToolPatterns(obj)
	normalizeRoles(obj)
	normalizeImageURL(obj)
	// tool 配对三步（见 tool_pairing.go）：先合并再重排再清理。
	if msgs, ok := obj["messages"].([]any); ok {
		msgs, _ = mergeAdjacentToolCalls(msgs)
		msgs, _ = repackToolResultBlocks(msgs)
		msgs, _ = cleanupOrphanToolCalls(msgs)
		obj["messages"] = msgs
	}
	modelName, _ := obj["model"].(string)
	injectThinking(obj, lookupDefaultEffort(defaultEfforts, modelName))
	effort := normalizeReasoningEffort(obj, efforts)
	if maxOut != nil {
		ensureMinOutputBudget(obj, effort, maxOut)
	}
	// DeepSeek 多轮一致性：assistant 消息带 reasoning 痕迹时回填 reasoning_content。
	backfillReasoningContent(obj)
	if sanitize {
		if msgs, ok := obj["messages"].([]any); ok {
			sanitizeMessages(msgs)
		}
		sanitizeTools(obj["tools"])
	}
	if msgs, ok := obj["messages"].([]any); ok {
		guardEmptyTextParts(msgs)
	}
	mirrorUpstreamReasoning(obj)
	out, err := json.Marshal(obj)
	if err != nil {
		return src, effort
	}
	return out, effort
}

// translateMaxCompletionTokens 把 OpenAI 别名 max_completion_tokens 翻译为上游认的 max_tokens。
func translateMaxCompletionTokens(obj map[string]any) {
	alias, has := obj["max_completion_tokens"]
	delete(obj, "max_completion_tokens")
	if !has {
		return
	}
	if _, explicit := obj["max_tokens"]; explicit {
		return
	}
	switch val := alias.(type) {
	case float64:
		if val > 0 && val == float64(int64(val)) {
			obj["max_tokens"] = int64(val)
		}
	case int64:
		if val > 0 {
			obj["max_tokens"] = val
		}
	case int:
		if val > 0 {
			obj["max_tokens"] = int64(val)
		}
	}
}

// gptMinMaxTokens GPT 系上游接受的 max_tokens 下限。
const gptMinMaxTokens = 16

// clampGPTMinMaxTokens 把 GPT 系模型过小的 max_tokens 抬到下限。
func clampGPTMinMaxTokens(obj map[string]any) {
	model, _ := obj["model"].(string)
	if !strings.Contains(strings.ToLower(model), "gpt-") {
		return
	}
	var val int64
	switch num := obj["max_tokens"].(type) {
	case float64:
		val = int64(num)
	case int64:
		val = num
	case int:
		val = int64(num)
	default:
		return
	}
	if val < gptMinMaxTokens {
		obj["max_tokens"] = int64(gptMinMaxTokens)
		log.Printf("max_tokens clamped model=%s %d -> %d", model, val, gptMinMaxTokens)
	}
}

// effortRank 档位从低到高。
var effortRank = map[string]int{"off": 0, "minimal": 1, "low": 2, "medium": 3, "high": 4, "xhigh": 5, "max": 6}

// normalizeReasoningEffort 按模型 supportedEfforts 降级 reasoning_effort（snake/camel 双字段兼容），
// 并返回本次最终生效的档位字符串（未携带或非已知档位时返回空串）。
func normalizeReasoningEffort(obj map[string]any, efforts map[string][]string) string {
	key := ""
	if _, present := obj["reasoning_effort"]; present {
		key = "reasoning_effort"
	} else if _, present := obj["reasoningEffort"]; present {
		key = "reasoningEffort"
	} else {
		return ""
	}
	reqRaw, ok := obj[key].(string)
	if !ok {
		return ""
	}
	reqStr := strings.TrimSpace(strings.ToLower(reqRaw))
	reqIdx, known := effortRank[reqStr]
	if !known {
		return ""
	}
	if len(efforts) == 0 {
		return reqStr
	}
	model, _ := obj["model"].(string)
	if model == "" {
		return reqStr
	}
	supported, ok := efforts[model]
	if !ok || len(supported) == 0 {
		return reqStr
	}
	// 在 ≤请求档位的支持档里选最高档；命中且与请求不同才改写。
	best, bestIdx := "", -1
	for _, candidate := range supported {
		idx, candidateKnown := effortRank[strings.TrimSpace(strings.ToLower(candidate))]
		if candidateKnown && idx <= reqIdx && idx > bestIdx {
			best, bestIdx = candidate, idx
		}
	}
	if best != "" {
		if !strings.EqualFold(best, reqStr) {
			obj[key] = best
			log.Printf("reasoning_effort downgraded model=%s %s -> %s", model, reqStr, best)
		}
		return strings.TrimSpace(strings.ToLower(best))
	}
	// 支持档全部高于请求档：取最低支持档。
	lowest, lowestIdx := "", 1<<30
	for _, candidate := range supported {
		idx, candidateKnown := effortRank[strings.TrimSpace(strings.ToLower(candidate))]
		if candidateKnown && idx < lowestIdx {
			lowest, lowestIdx = candidate, idx
		}
	}
	if lowest != "" {
		obj[key] = lowest
		log.Printf("reasoning_effort floored model=%s %s -> %s", model, reqStr, lowest)
		return strings.TrimSpace(strings.ToLower(lowest))
	}
	return reqStr
}

// normalizeRoles 把 messages 里的 developer 角色归一为 system。
func normalizeRoles(obj map[string]any) {
	msgs, ok := obj["messages"].([]any)
	if !ok {
		return
	}
	for idx, rawMsg := range msgs {
		msg, ok := rawMsg.(map[string]any)
		if !ok {
			continue
		}
		role, ok := msg["role"].(string)
		if !ok {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(role), "developer") {
			msg["role"] = "system"
			log.Printf("role normalized developer->system idx=%d", idx)
		}
	}
}

// normalizeImageURL 兼容 OpenAI chat 多模态内容的字符串与对象两种 image_url 写法。
func normalizeImageURL(obj map[string]any) {
	msgs, ok := obj["messages"].([]any)
	if !ok {
		return
	}
	for _, rawMsg := range msgs {
		msg, ok := rawMsg.(map[string]any)
		if !ok {
			continue
		}
		parts, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		for _, rawPart := range parts {
			part, ok := rawPart.(map[string]any)
			if !ok || part["type"] != "image_url" {
				continue
			}
			imageURL, ok := part["image_url"].(string)
			if !ok || imageURL == "" {
				continue
			}
			part["image_url"] = map[string]any{"url": imageURL}
		}
	}
}

// ensureConsoleSystem global realm 兜底 system 注入（防 console 域上游 code 11-128）。
func ensureConsoleSystem(body []byte) []byte {
	if len(body) == 0 {
		return body
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		return body
	}
	msgs, ok := obj["messages"].([]any)
	if !ok || len(msgs) == 0 {
		return body
	}
	first, ok := msgs[0].(map[string]any)
	if ok {
		if role, _ := first["role"].(string); strings.EqualFold(strings.TrimSpace(role), "system") {
			return body
		}
	}
	obj["messages"] = append([]any{map[string]any{"role": "system", "content": "You are a helpful assistant."}}, msgs...)
	out, err := json.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}

// normalizeToolChoice 按上游 Go struct（string 类型）改写 OpenAI tool_choice。
func normalizeToolChoice(obj map[string]any) {
	suppress := func() {
		delete(obj, "tools")
		delete(obj, "functions")
	}
	tc, present := obj["tool_choice"]
	if !present {
		return
	}
	switch typed := tc.(type) {
	case string:
		if strings.EqualFold(strings.TrimSpace(typed), "none") {
			delete(obj, "tool_choice")
			suppress()
		}
	case map[string]any:
		typ, _ := typed["type"].(string)
		typ = strings.ToLower(strings.TrimSpace(typ))
		switch typ {
		case "none":
			delete(obj, "tool_choice")
			suppress()
		case "auto", "required":
			obj["tool_choice"] = typ
		case "function":
			name := ""
			if fn, ok := typed["function"].(map[string]any); ok {
				name, _ = fn["name"].(string)
			}
			if name == "" {
				name, _ = typed["name"].(string)
			}
			if name = strings.TrimSpace(name); name != "" {
				obj["tool_choice"] = name
			} else {
				obj["tool_choice"] = "auto"
			}
		default:
			delete(obj, "tool_choice")
		}
	default:
		delete(obj, "tool_choice")
	}
}

// normalizeToolPatterns 归一化 tools schema 树（pattern 非标转义 `\_` 及缺失 type 的 enum）。
func normalizeToolPatterns(obj map[string]any) {
	rawTools, ok := obj["tools"].([]any)
	if !ok {
		return
	}
	for _, rawTool := range rawTools {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			continue
		}
		if fn, ok := tool["function"].(map[string]any); ok {
			normalizeSchemaTree(fn["parameters"])
		}
		normalizeSchemaTree(tool["parameters"])
	}
}

// normalizeSchemaTree 递归归一化工具参数 schema 树：
//   - pattern 值与 patternProperties 键中的 `\_` -> `_`
//   - 只有 enum 而缺失 type 的 schema 节点补上可无损推断的基础类型
func normalizeSchemaTree(node any) {
	switch typed := node.(type) {
	case map[string]any:
		if pattern, ok := typed["pattern"].(string); ok && strings.Contains(pattern, `\_`) {
			typed["pattern"] = strings.ReplaceAll(pattern, `\_`, `_`)
		}
		if props, ok := typed["patternProperties"].(map[string]any); ok {
			rebuilt := false
			fixed := make(map[string]any, len(props))
			for key, val := range props {
				if strings.Contains(key, `\_`) {
					key = strings.ReplaceAll(key, `\_`, `_`)
					rebuilt = true
				}
				fixed[key] = val
			}
			if rebuilt {
				typed["patternProperties"] = fixed
			}
		}
		if _, hasType := typed["type"]; !hasType {
			if enumVals, ok := typed["enum"].([]any); ok && len(enumVals) > 0 {
				if inferred := inferEnumType(enumVals); inferred != "" {
					typed["type"] = inferred
				}
			}
		}
		for _, val := range typed {
			normalizeSchemaTree(val)
		}
	case []any:
		for _, item := range typed {
			normalizeSchemaTree(item)
		}
	}
}

// inferEnumType 从 enum 取值列表无损推断 JSON Schema 类型；混合或含复合类型时返回空串。
func inferEnumType(values []any) string {
	var strs, nums, ints, bools int
	for _, item := range values {
		switch typed := item.(type) {
		case string:
			strs++
		case bool:
			bools++
		case float64:
			nums++
			if typed == math.Trunc(typed) {
				ints++
			}
		default:
			return ""
		}
	}
	total := len(values)
	switch {
	case strs == total:
		return "string"
	case bools == total:
		return "boolean"
	case nums == total && ints == total:
		return "integer"
	case nums == total:
		return "number"
	}
	return ""
}

// IsPayloadUnmodified 快速检查请求体是否已经完全合规而无需任何修改（支持未改写零拷贝流式发送）。
func IsPayloadUnmodified(src []byte) bool {
	if len(src) == 0 {
		return false
	}
	var peek struct {
		Stream              bool            `json:"stream"`
		StreamOptions       json.RawMessage `json:"stream_options"`
		MaxCompletionTokens json.RawMessage `json:"max_completion_tokens"`
		PromptCacheKey      string          `json:"prompt_cache_key"`
	}
	if err := json.Unmarshal(src, &peek); err == nil {
		if !peek.Stream || len(peek.StreamOptions) == 0 || len(peek.MaxCompletionTokens) > 0 {
			return false
		}
		return true
	}
	return false
}

// StripConversationID 剥除请求体中的顶层 conversation_id、conversationId 以及 metadata 中的会话标识，
// 防止跨账号重试时发生会话串号污染。
func StripConversationID(src []byte) []byte {
	if len(src) == 0 {
		return src
	}
	var obj map[string]any
	if err := json.Unmarshal(src, &obj); err != nil {
		return src
	}
	modified := false
	if _, ok := obj["conversation_id"]; ok {
		delete(obj, "conversation_id")
		modified = true
	}
	if _, ok := obj["conversationId"]; ok {
		delete(obj, "conversationId")
		modified = true
	}
	if meta, ok := obj["metadata"].(map[string]any); ok {
		metaModified := false
		if _, ok := meta["conversation_id"]; ok {
			delete(meta, "conversation_id")
			metaModified = true
		}
		if _, ok := meta["conversationId"]; ok {
			delete(meta, "conversationId")
			metaModified = true
		}
		if metaModified {
			obj["metadata"] = meta
			modified = true
		}
	}
	if !modified {
		return src
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return src
	}
	return out
}
