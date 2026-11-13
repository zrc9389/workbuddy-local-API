// reasoning_mirror.go 为按 `reasoning` 字段读取历史思考内容的模型家族镜像 reasoning_content。
//
// Kimi / GLM / MiniMax / MiMo / Step / Space-Bunny 上游按 `reasoning` 读取 assistant 历史思考段；
// 当客户端只传 `reasoning_content` 且 `reasoning` 缺失或为空白时，将非空 `reasoning_content`
// 镜像写入 `reasoning`。不凭空创建占位符，不覆盖已有非空 `reasoning`。
package upstream

import "strings"

// upstreamReasoningModelPrefixes 上游按 `reasoning` 字段读取历史的模型前缀。
var upstreamReasoningModelPrefixes = []string{
	"kimi", "glm", "minimax", "mimo", "step", "space-bunny",
}

// readsUpstreamReasoning 判断模型是否按 `reasoning` 字段读取历史（支持 cn:/global: 前缀）。
func readsUpstreamReasoning(model string) bool {
	_, bare := SplitRealmPrefix(model)
	lower := strings.ToLower(strings.TrimSpace(bare))
	if lower == "" {
		return false
	}
	for _, prefix := range upstreamReasoningModelPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

// mirrorUpstreamReasoning 把特定家族模型 assistant 消息里的非空 reasoning_content
// 镜像到空或缺失的 reasoning 字段。
func mirrorUpstreamReasoning(obj map[string]any) {
	model, _ := obj["model"].(string)
	if !readsUpstreamReasoning(model) {
		return
	}
	msgs, ok := obj["messages"].([]any)
	if !ok || len(msgs) == 0 {
		return
	}
	for _, rawMsg := range msgs {
		msg, ok := rawMsg.(map[string]any)
		if !ok {
			continue
		}
		mirrorAssistantReasoningFields(msg)
	}
}

// mirrorAssistantMessageReasoning 为单条消息（如流式响应聚合场景）执行 reasoning 镜像。
func mirrorAssistantMessageReasoning(msg map[string]any, model string) {
	if msg == nil || !readsUpstreamReasoning(model) {
		return
	}
	mirrorAssistantReasoningFields(msg)
}

// MirrorAssistantMessageReasoning 跨包导出的单条消息 reasoning 镜像入口。
func MirrorAssistantMessageReasoning(msg map[string]any, model string) {
	mirrorAssistantMessageReasoning(msg, model)
}

func mirrorAssistantReasoningFields(msg map[string]any) {
	role, _ := msg["role"].(string)
	if role != "assistant" {
		return
	}
	rc, _ := msg["reasoning_content"].(string)
	if strings.TrimSpace(rc) == "" {
		return
	}
	if existing, ok := msg["reasoning"].(string); ok && strings.TrimSpace(existing) != "" {
		return
	}
	msg["reasoning"] = rc
}
