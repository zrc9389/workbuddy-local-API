// empty_text_part.go 出站前修补空 text 段（防上游 400 code=11151: a message has empty content）。
//
// 上游对每个 text 段做长度校验：text 为空串、null 或缺失时整条消息会触发 400。
// 除了 parts 数组外，若字符串 content 去前导空白后以 `[` 开头且可解析为非空对象数组，
// 上游同样按 parts 嗅探并校验。此处只补占位空格 `" "`，不删除分段，保持原有结构下标不变。
package upstream

import (
	"encoding/json"
	"strings"
)

// emptyTextPartFill 空 text 段的占位值（单空格可过上游长度校验且不引入语义噪音）。
const emptyTextPartFill = " "

// guardEmptyTextParts 就地补位 messages 中所有空 text 段。
// 仅在确实发生修补时才重写 msg["content"]，普通合法请求零改动。
func guardEmptyTextParts(messages []any) {
	if len(messages) == 0 {
		return
	}
	for _, rawMsg := range messages {
		msg, ok := rawMsg.(map[string]any)
		if !ok {
			continue
		}
		content, has := msg["content"]
		if !has {
			continue
		}
		switch typed := content.(type) {
		case []any:
			parts := make([]any, len(typed))
			copied := false
			for idx, rawPart := range typed {
				part, ok := rawPart.(map[string]any)
				if !ok || partType(part) != "text" || !isEmptyText(part) {
					parts[idx] = rawPart
					continue
				}
				clone := make(map[string]any, len(part)+1)
				for key, val := range part {
					clone[key] = val
				}
				clone["text"] = emptyTextPartFill
				parts[idx] = clone
				copied = true
			}
			if copied {
				msg["content"] = parts
			}
		case string:
			parts := sniffParts(typed)
			if parts == nil {
				continue
			}
			if !fillEmptyTextParts(parts) {
				continue
			}
			if encoded, err := json.Marshal(parts); err == nil {
				msg["content"] = string(encoded)
			}
		}
	}
}

// sniffParts 复刻上游的数组嗅探口径：去前导空白后以 `[` 开头且能解析成非空对象数组时返回该切片。
func sniffParts(content string) []any {
	stripped := strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(stripped, "[") {
		return nil
	}
	var parts []any
	if err := json.Unmarshal([]byte(stripped), &parts); err != nil {
		return nil
	}
	if len(parts) == 0 {
		return nil
	}
	for _, item := range parts {
		if _, ok := item.(map[string]any); !ok {
			return nil
		}
	}
	return parts
}

// fillEmptyTextParts 就地修补对象数组中的空 text 段，返回是否发生变更。
func fillEmptyTextParts(parts []any) bool {
	changed := false
	for _, rawPart := range parts {
		part, ok := rawPart.(map[string]any)
		if !ok || partType(part) != "text" || !isEmptyText(part) {
			continue
		}
		part["text"] = emptyTextPartFill
		changed = true
	}
	return changed
}

// partType 提取段类型，不做模糊大小写或前缀归一化，避免把非 text 段拉入校验。
func partType(part map[string]any) string {
	typ, _ := part["type"].(string)
	return typ
}

// isEmptyText 判断 text 段是否为空（缺失、nil 或空字符串 ""）；非空空白串如 " " 保持不动。
func isEmptyText(part map[string]any) bool {
	val, has := part["text"]
	if !has || val == nil {
		return true
	}
	str, ok := val.(string)
	if !ok {
		return false
	}
	return str == ""
}
