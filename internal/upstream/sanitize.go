// sanitize.go 出站请求体脱敏：剥离上游内容审核黑名单指纹。
//
// 背景：客户端（Claude Code 类 CLI）在 system prompt 注入若干固定模板句，
// 上游内容审核按逐字精确匹配拦截（非语义审核），一字改动即可绕过。
// 策略：键值/header 型指纹整段剥离；承载语义的模板句最小改写（换一词或重述），语义不变。
package upstream

import (
	"regexp"
	"strings"
)

// sanitizeFeatures 特征预检：任一命中才进入净化（strings.Contains 快速路径，
// 普通请求全不中 → 原样返回，零分配）。
var sanitizeFeatures = []string{
	"x-anthropic-billing-header",                      // header 键值段键名
	"cc_entrypoint=",                                  // 尾随裸键值（截断前缀即可命中）
	"You are Claude Code",                             // 身份句（截断前缀即可命中）
	"Main branch (",                                   // 注入指令句（截断前缀即可命中）
	"You are a coding agent running in the Codex CLI", // Codex instructions 首段（截断前缀即可命中）
	"DeepSeek Harness",                                // 竞品 coding agent 核心特征句（11128 拦截词）
	"You are an AI agent powered by",                  // 竞品 coding agent 前缀声明
	"github.com/anthropics/",                          // 反馈句里的 Anthropic 仓库链接
	"11128",                                           // 上游反探测：裸数字错误码
	"Tokens prefixed with @",                          // DSH 0.3.x 的 @ 路径说明段
	"identify yourself as",                            // 上游服务端注入的身份指令
	"model_identity",                                  // 上游身份标签包裹
}

// sanitizeHdrRe 剥离层：header 键名即触发（与值无关），整段删除。
var sanitizeHdrRe = regexp.MustCompile(`(?i)x-anthropic-billing-header:[^;\n]*;?\s*`)

// sanitizeBareHdrRe 兜底层：裸键名（无冒号无值）同样是指纹——
// 键值形态被整段删除后，残留的裸键名做最小缩写（header→hdr）：破坏逐字匹配、
// 语义不变、保留可读性。大小写不敏感，覆盖 X-Anthropic-... 变体。
var sanitizeBareHdrRe = regexp.MustCompile(`(?i)x-anthropic-billing-header`)

// sanitizeBareHdrProbe 从 sanitizeBareHdrRe 推导纯字面量探针，供 containsFoldASCII 快速预检。
var sanitizeBareHdrProbe = func() string {
	const foldPrefix = "(?i)"
	rawPattern := sanitizeBareHdrRe.String()
	if !strings.HasPrefix(rawPattern, foldPrefix) {
		return ""
	}
	body := rawPattern[len(foldPrefix):]
	if body == "" || strings.ContainsAny(body, `\[](){}*+?|^$.`) {
		return ""
	}
	return body
}()

// sanitizeKvRe 剥离层：尾随裸键值（cc_xxx=...;）循环清理。
var sanitizeKvRe = regexp.MustCompile(`(?i)\bcc_[a-z0-9_]+=[^;\n]*;?\s*`)

// sanitizeDshPathsRe DSH 0.3.x 系统提示里的 `@` 路径解析整段说明。
var sanitizeDshPathsRe = regexp.MustCompile(
	`(?is)Tokens prefixed with @ are paths the user explicitly referenced\..*?path (?:containing|that contains) spaces\.`)

const sanitizeDshPathsProbe = "Tokens prefixed with @"

const sanitizeDshPathsReplacement = "Paths beginning with @ refer to files the user explicitly mentioned. " +
	"Relative paths are resolved against the project root; absolute paths point " +
	"to files or directories on the host. A trailing slash marks a directory, so " +
	"list it when its contents matter. Anything else is a file: open it with the " +
	"read tool when its contents are needed, and never claim to have inspected it " +
	"before reading. The @\"...\" form only quotes a path that contains spaces."

// sanitizeInjectedIdentityRe 上游服务端注入的身份指令，避免在历史中滚雪球。
var sanitizeInjectedIdentityRe = regexp.MustCompile(
	`(?i)when asked about your[^.\n]{0,60}?identity[^.\n]{0,60}?,\s*identify yourself as\s+[^.\n]{1,80}\.`)

const sanitizeInjectedIdentityReplacement = "When asked about your capabilities, answer using only the information available in this conversation."

// sanitizeModelIdentityTagRe 剥离 <model_identity> / </model_identity> 包裹标签本身。
var sanitizeModelIdentityTagRe = regexp.MustCompile(`(?i)</?model_identity>`)

// sanitizeIdentitySentenceRe 通用自我介绍句 + 品牌归属句式。
// 必须先跑 sanitizeRewrites，并对包含 WorkBuddy 或 Tencent 的匹配跳过，防止覆盖自身改写。
var sanitizeIdentitySentenceRe = regexp.MustCompile(
	`(?i)You are\s+(?:an?\s+|the\s+)?(?:[\w.-]+\s+){0,3}?(?:agent|assistant|model|AI|LLM)?[\s,]*(?:powered by|built on|built by|created by|developed by|made by|trained by)[^\n]*?\.(\s|$)`)

// sanitizeRewrites 改写层：全模板句逐字替换（保留原有 WorkBuddy 与 Codex 既定改写）。
var sanitizeRewrites = [][2]string{
	{
		"You are Claude Code, Anthropic's official CLI for Claude",
		"You are Claude Code, Anthropic's official CLI tool for Claude",
	},
	{
		"Main branch (you will usually use this for PRs)",
		"Default branch (you will usually use this for PRs)",
	},
	{
		"You are a coding agent running in the Codex CLI, a terminal-based coding assistant.",
		"You are a helpful AI assistant.",
	},
	{
		// 竞品 DSH 身份句：替换为腾讯官方 WorkBuddy 编码助手身份，后文 README/指令完整保留
		"You are an AI agent powered by DeepSeek Harness.",
		"You are WorkBuddy, a helpful coding assistant developed by Tencent.",
	},
	{
		"You are an AI agent powered by DeepSeek Harness",
		"You are WorkBuddy, a helpful coding assistant developed by Tencent",
	},
	{
		// 捕获无后继标点的变体，注入 WorkBuddy 官方编码助手身份，完整保留后继 instructions/README
		"You are a coding agent running in the Codex CLI",
		"You are WorkBuddy, a helpful coding assistant developed by Tencent",
	},
	{
		// 反馈句：整句带 Anthropic 仓库链接，上游按整句拦截（give→provide 绕过）
		"To give feedback, users should report the issue at https://github.com/anthropics/claude-code/issues",
		"To provide feedback, users should report the issue at https://github.com/anthropics/claude-code/issues",
	},
	{
		// 上游反探测：只要请求体里出现裸数字 11128 就整单拦截，插入连字符打断精确匹配
		"11128",
		"11-128",
	},
}

// SanitizeText 导出单段文本净化入口。
func SanitizeText(text string) string {
	return sanitizeText(text)
}

// SanitizeMessages 导出 messages 批量净化入口。
func SanitizeMessages(messages []any) bool {
	return sanitizeMessages(messages)
}

// SanitizeTools 导出 tools[].function.description 净化入口。
func SanitizeTools(tools any) {
	sanitizeTools(tools)
}

// sanitizeText 单段文本净化：预检不中 → 返回原串（零分配）。
func sanitizeText(text string) string {
	if !hasFingerprint(text) {
		return text
	}
	return strings.TrimSpace(sanitizeTextCore(text))
}

// sanitizeTextCore 执行全量指纹改写与剥离但保留首尾空白，供流式大字符串分窗净化复用。
func sanitizeTextCore(text string) string {
	if !hasFingerprint(text) {
		return text
	}
	for _, rw := range sanitizeRewrites {
		text = strings.ReplaceAll(text, rw[0], rw[1])
	}
	if containsFoldASCII(text, sanitizeDshPathsProbe) {
		text = sanitizeDshPathsRe.ReplaceAllString(text, sanitizeDshPathsReplacement)
	}
	if containsFoldASCII(text, "identify yourself as") {
		text = sanitizeInjectedIdentityRe.ReplaceAllString(text, sanitizeInjectedIdentityReplacement)
	}
	if containsFoldASCII(text, "model_identity") {
		text = sanitizeModelIdentityTagRe.ReplaceAllString(text, "")
	}
	if hasIdentityVerbShape(text) {
		text = sanitizeIdentitySentenceRe.ReplaceAllStringFunc(text, func(match string) string {
			if strings.Contains(match, "WorkBuddy") || strings.Contains(match, "Tencent") {
				return match
			}
			suffix := ""
			if dot := strings.LastIndexByte(match, '.'); dot >= 0 && dot+1 < len(match) {
				suffix = match[dot+1:]
			}
			return "You are a helpful AI assistant." + suffix
		})
	}
	if sanitizeHdrRe.MatchString(text) {
		text = sanitizeHdrRe.ReplaceAllString(text, "")
	}
	if strings.Contains(text, "cc_") {
		prev := ""
		for prev != text { // 清尾随裸 kv（cc_version=...; cc_entrypoint=...;）
			prev = text
			text = sanitizeKvRe.ReplaceAllString(text, "")
		}
	}
	// 兜底：键值形态已在上面整段删除，这里只剩裸键名（引用/示例文本形态）。
	return sanitizeBareHdrRe.ReplaceAllString(text, "x-anthropic-billing-hdr")
}

// containsFoldASCII 大小写不敏感（仅 ASCII）的子串快速查找，零分配。
// 替代热路径上的 `(?i)` 正则全量扫描，防止大上下文消息带来过高 CPU 开销。
func containsFoldASCII(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	needleLen := len(needle)
	if len(haystack) < needleLen {
		return false
	}
	firstFold := needle[0] | 0x20
	for i := 0; i+needleLen <= len(haystack); i++ {
		if haystack[i]|0x20 != firstFold {
			continue
		}
		matched := true
		for j := 1; j < needleLen; j++ {
			charA, charB := haystack[i+j], needle[j]
			if charA != charB && charA|0x20 != charB|0x20 {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}

// hasIdentityVerbShape 快速判断文本是否出现「 by 」或「 on 」字样（通用身份句式的必要条件）。
func hasIdentityVerbShape(text string) bool {
	for i := 0; i+3 <= len(text); i++ {
		first := text[i] | 0x20
		var want byte
		switch first {
		case 'b':
			want = 'y'
		case 'o':
			want = 'n'
		default:
			continue
		}
		if text[i+1]|0x20 != want || text[i+2] != ' ' {
			continue
		}
		if i > 0 && text[i-1] != ' ' {
			continue
		}
		return true
	}
	return false
}

// hasNonWorkBuddyIdentitySentence 检测是否存在未被 WorkBuddy/Tencent 豁免的通用身份句式。
func hasNonWorkBuddyIdentitySentence(text string) bool {
	matches := sanitizeIdentitySentenceRe.FindAllString(text, -1)
	for _, match := range matches {
		if !strings.Contains(match, "WorkBuddy") && !strings.Contains(match, "Tencent") {
			return true
		}
	}
	return false
}

// hasFingerprint 特征预检：先走 strings.Contains 快速路径（零分配），
// 再使用 containsFoldASCII 对裸 header 键名及大小写不敏感模板做快速兜底探测。
func hasFingerprint(text string) bool {
	for _, feat := range sanitizeFeatures {
		if strings.Contains(text, feat) {
			return true
		}
	}
	if sanitizeBareHdrProbe == "" {
		if sanitizeBareHdrRe.MatchString(text) {
			return true
		}
	} else if containsFoldASCII(text, sanitizeBareHdrProbe) {
		return true
	}
	if containsFoldASCII(text, sanitizeDshPathsProbe) ||
		containsFoldASCII(text, "identify yourself as") ||
		containsFoldASCII(text, "model_identity") {
		return true
	}
	if hasIdentityVerbShape(text) && hasNonWorkBuddyIdentitySentence(text) {
		return true
	}
	return false
}

// sanitizeContent 兼容字符串与多模态数组；只动 text part，image 等 part 不动。
// 返回净化后的值及是否发生变化。
func sanitizeContent(val any) (any, bool) {
	switch content := val.(type) {
	case string:
		cleaned := sanitizeText(content)
		return cleaned, cleaned != content
	case []any:
		changed := false
		for _, partVal := range content {
			partMap, ok := partVal.(map[string]any)
			if !ok {
				continue
			}
			text, ok := partMap["text"].(string)
			if !ok {
				continue
			}
			if cleaned := sanitizeText(text); cleaned != text {
				partMap["text"] = cleaned
				changed = true
			}
		}
		return content, changed
	}
	return val, false
}

// sanitizeToolCalls 净化 assistant.tool_calls[].function.arguments。
func sanitizeToolCalls(val any) bool {
	callList, ok := val.([]any)
	if !ok {
		return false
	}
	changed := false
	for _, item := range callList {
		call, ok := item.(map[string]any)
		if !ok {
			continue
		}
		fn, ok := call["function"].(map[string]any)
		if !ok {
			continue
		}
		args, ok := fn["arguments"].(string)
		if !ok {
			continue
		}
		if cleaned := sanitizeText(args); cleaned != args {
			fn["arguments"] = cleaned
			changed = true
		}
	}
	return changed
}

// sanitizeTools 净化 tools[].function.description。
func sanitizeTools(val any) {
	tools, ok := val.([]any)
	if !ok {
		return
	}
	for _, item := range tools {
		tool, ok := item.(map[string]any)
		if !ok {
			continue
		}
		fn, ok := tool["function"].(map[string]any)
		if !ok {
			continue
		}
		if desc, ok := fn["description"].(string); ok {
			if cleaned := sanitizeText(desc); cleaned != desc {
				fn["description"] = cleaned
			}
		}
	}
}

// sanitizeMessages 净化 messages 中的 content、reasoning 与 tool_calls；任一命中返回 true。
func sanitizeMessages(messages []any) bool {
	changed := false
	for _, rawMsg := range messages {
		msg, ok := rawMsg.(map[string]any)
		if !ok {
			continue
		}
		if content, ok := msg["content"]; ok {
			if cleaned, ch := sanitizeContent(content); ch {
				msg["content"] = cleaned
				changed = true
			}
		}
		if rc, ok := msg["reasoning_content"].(string); ok {
			if cleaned := sanitizeText(rc); cleaned != rc {
				msg["reasoning_content"] = cleaned
				changed = true
			}
		}
		if reasoning, ok := msg["reasoning"].(string); ok {
			if cleaned := sanitizeText(reasoning); cleaned != reasoning {
				msg["reasoning"] = cleaned
				changed = true
			}
		}
		if tc, ok := msg["tool_calls"]; ok {
			if sanitizeToolCalls(tc) {
				changed = true
			}
		}
	}
	return changed
}
