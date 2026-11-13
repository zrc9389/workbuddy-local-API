package upstream

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

const (
	ccIdentity = "You are Claude Code, Anthropic's official CLI for Claude."
	ccBranch   = "Main branch (you will usually use this for PRs)"
	ccHeader   = "x-anthropic-billing-header: cc_version=1.0; cc_entrypoint=cli;"
	// Codex instructions 首段（上游逐字精确指纹，三句缺一不可）。
	codexInstructions = "You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful."
)

func TestIdentityRewritten(t *testing.T) {
	out := sanitizeText(ccIdentity)
	if !strings.Contains(out, "official CLI tool for Claude.") {
		t.Errorf("identity not rewritten: %q", out)
	}
	if strings.Contains(out, ccIdentity) {
		t.Errorf("original identity still present: %q", out)
	}
}

// 桌面版（claude-desktop-3p / Agent SDK）的身份句以逗号接后继内容，结尾不是句号。
// 回归用例：匹配串曾带结尾句号，导致该形态漏网、指纹原样发上游 → 400 code=11128。
func TestIdentityDesktopVariantRewritten(t *testing.T) {
	in := "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."
	out := sanitizeText(in)
	if strings.Contains(out, "official CLI for Claude") {
		t.Errorf("desktop identity not rewritten: %q", out)
	}
	if !strings.Contains(out, "official CLI tool for Claude, running within the Claude Agent SDK.") {
		t.Errorf("desktop identity suffix not preserved: %q", out)
	}
}

func TestBranchRewritten(t *testing.T) {
	out := sanitizeText(ccBranch)
	if !strings.Contains(out, "Default branch (you will usually use this for PRs)") {
		t.Errorf("branch not rewritten: %q", out)
	}
	if strings.Contains(out, "Main branch") {
		t.Errorf("original branch still present: %q", out)
	}
}

// 反馈句带 Anthropic 仓库链接，上游按整句拦截（实测只留链接或只留半边均不拦）。
// 回归用例：give→provide 一词之差即可绕过。
func TestFeedbackSentenceRewritten(t *testing.T) {
	in := "To give feedback, users should report the issue at https://github.com/anthropics/claude-code/issues"
	out := sanitizeText(in)
	if strings.Contains(out, "To give feedback") {
		t.Errorf("feedback sentence not rewritten: %q", out)
	}
	if !strings.Contains(out, "To provide feedback, users should report the issue at https://github.com/anthropics/claude-code/issues") {
		t.Errorf("feedback sentence not rewritten as expected: %q", out)
	}
}

// 上游反探测：请求体里出现裸数字 11128 即整单拦截（与上下文无关）。
// 回归用例：该串会被改写为 11-128 以打断精确匹配。
func TestUpstreamErrorCodeRewritten(t *testing.T) {
	in := "upstream returned code=11128 for this request"
	out := sanitizeText(in)
	if strings.Contains(out, "11128") {
		t.Errorf("error code not rewritten: %q", out)
	}
	if !strings.Contains(out, "11-128") {
		t.Errorf("error code not rewritten as expected: %q", out)
	}
}

// 回归：工具调用消息的 content 常为 null，而旧版 sanitizeMessages 在 content 缺失时
// 直接 continue，整条消息连 tool_calls 一起被跳过 → arguments 里的被拦字符串原样漏出。
func TestToolCallArgumentsSanitized(t *testing.T) {
	msgs := []any{
		map[string]any{"role": "user", "content": "run"},
		map[string]any{"role": "assistant", "content": nil, "tool_calls": []any{
			map[string]any{"id": "c1", "type": "function", "function": map[string]any{
				"name":      "Bash",
				"arguments": `{"command":"echo 11128"}`,
			}},
		}},
	}
	if !sanitizeMessages(msgs) {
		t.Fatal("sanitizeMessages 未报告任何改动，tool_calls 被跳过")
	}
	fn := msgs[1].(map[string]any)["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)
	got := fn["arguments"].(string)
	if strings.Contains(got, "11128") {
		t.Errorf("tool_call arguments 未被净化: %q", got)
	}
}

func TestBillingHeaderStrippedValueIrrelevant(t *testing.T) {
	out := sanitizeText(ccHeader)
	if strings.Contains(out, "x-anthropic-billing-header") {
		t.Errorf("header not stripped: %q", out)
	}
}

// 附加验证：正常对话里出现 github.com/anthropics/ 链接（但不是反馈句整句）
// 时，预检特征命中（进入净化），但改写层只动精确匹配的整句——普通链接文本
// 不该被改写。同理，既不含 11128 也不含反馈整句的文本原样返回。
func TestNormalAnthropicLinkNotRewritten(t *testing.T) {
	in := "see https://github.com/anthropics/anthropic-cookbook for examples"
	if out := sanitizeText(in); out != in {
		t.Errorf("normal anthropic link should be untouched: %q -> %q", in, out)
	}
}

// Codex instructions 首段：命中预告且整句改写，逐字指纹被破坏、语义保留。
func TestCodexInstructionsRewritten(t *testing.T) {
	out := sanitizeText(codexInstructions)
	if strings.Contains(out, codexInstructions) {
		t.Errorf("codex fingerprint still present: %q", out)
	}
	if !strings.Contains(out, "You are a helpful AI assistant.") {
		t.Errorf("codex first sentence not rewritten: %q", out)
	}
	// 其余两句原样保留，语义不变。
	if !strings.Contains(out, "Codex CLI is an open source project led by OpenAI.") ||
		!strings.Contains(out, "You are expected to be precise, safe, and helpful.") {
		t.Errorf("codex remaining sentences altered: %q", out)
	}
}

// 预检必须能认出 Codex 特征（此前只含 Claude Code，导致提前放行）。
func TestCodexFingerprintDetected(t *testing.T) {
	if !hasFingerprint(codexInstructions) {
		t.Error("codex fingerprint not detected by precheck")
	}
}

// 非精确变体不应被改写：仅去掉其中一个词即视为已破坏，无需改动。
func TestCodexVariantNotTouched(t *testing.T) {
	in := "You are a coding agent running in a CLI, a terminal-based coding assistant."
	if out := sanitizeText(in); out != in {
		t.Errorf("already-broken variant should be untouched: %q -> %q", in, out)
	}
}

func TestBillingHeaderCaseInsensitive(t *testing.T) {
	alt := "X-Anthropic-Billing-Header: cc_version=1.0;"
	out := strings.ToLower(sanitizeText(alt))
	if strings.Contains(out, "billing") {
		t.Errorf("case-insensitive header not stripped: %q", out)
	}
}

func TestTrailingKVStripped(t *testing.T) {
	out := sanitizeText("...; cc_version=2.0; cc_entrypoint=cli;")
	if strings.Contains(out, "cc_version") || strings.Contains(out, "cc_entrypoint") {
		t.Errorf("trailing kv not stripped: %q", out)
	}
}

func TestExactMatchOnlyVariantNotTouched(t *testing.T) {
	in := "...official CLI for Claude!"
	if out := sanitizeText(in); out != in {
		t.Errorf("variant should be untouched: %q -> %q", in, out)
	}
}

func TestUserFreeTextNotTouched(t *testing.T) {
	in := "please use main branch for this repo"
	if out := sanitizeText(in); out != in {
		t.Errorf("free text should be untouched: %q -> %q", in, out)
	}
}

func TestNoFeatureReturnsSameString(t *testing.T) {
	in := "ordinary user message"
	if out := sanitizeText(in); out != in {
		t.Errorf("no-feature text should pass through unchanged: %q -> %q", in, out)
	}
}

func TestMultimodalTextPartOnly(t *testing.T) {
	imgPart := map[string]any{"type": "image", "source": map[string]any{"type": "base64", "data": "..."}}
	content := []any{
		map[string]any{"type": "text", "text": ccIdentity},
		imgPart,
	}
	out, changed := sanitizeContent(content)
	if !changed {
		t.Fatal("expected change")
	}
	parts := out.([]any)
	txt, _ := parts[0].(map[string]any)["text"].(string)
	if !strings.Contains(txt, "CLI tool") {
		t.Errorf("text part not sanitized: %q", txt)
	}
	img, _ := parts[1].(map[string]any)
	if img["type"] != "image" || img["source"].(map[string]any)["data"] != "..." {
		t.Error("image part modified")
	}
}

// 集成：完整请求体经 PrepareBodyOpt 净化后无残留指纹，且 stream/tool_choice 行为不受影响。
func TestPrepareBodyOptSanitizesSystem(t *testing.T) {
	body := []byte(`{"model":"glm-5.2","messages":[` +
		`{"role":"system","content":"` + ccIdentity + ` ` + ccHeader + `"},` +
		`{"role":"user","content":"hi"}]}`)
	out := PrepareBodyOpt(body, true)
	var obj map[string]any
	if err := json.Unmarshal(out, &obj); err != nil {
		t.Fatal(err)
	}
	if obj["stream"] != true {
		t.Error("stream not forced")
	}
	msgs := obj["messages"].([]any)
	sys, _ := msgs[0].(map[string]any)["content"].(string)
	if strings.Contains(sys, "x-anthropic-billing-header") || strings.Contains(sys, ccIdentity) || strings.Contains(sys, ccBranch) {
		t.Errorf("fingerprints remain: %q", sys)
	}
	if !strings.Contains(sys, "CLI tool") {
		t.Errorf("rewrite missing: %q", sys)
	}
}

func TestPrepareBodyOptDisabledPreservesFingerprints(t *testing.T) {
	body := []byte(`{"model":"glm-5.2","messages":[{"role":"system","content":"` + ccIdentity + `"}]}`)
	out := PrepareBodyOpt(body, false)
	if !strings.Contains(string(out), ccIdentity) {
		t.Error("sanitize=false should preserve fingerprints")
	}
	// 但 stream 仍强制
	var obj map[string]any
	_ = json.Unmarshal(out, &obj)
	if obj["stream"] != true {
		t.Error("stream should still be forced")
	}
}

// PrepareBody 默认行为 = 开启脱敏（保持向后兼容）。
func TestPrepareBodyDefaultSanitizes(t *testing.T) {
	body := []byte(`{"model":"glm-5.2","messages":[{"role":"system","content":"` + ccIdentity + `"}]}`)
	out := PrepareBodyOpt(body, true)
	if strings.Contains(string(out), ccIdentity) {
		t.Error("PrepareBody default should sanitize")
	}
}

// 出站边界集成：ChatStream 发往上游的 wire body 必须无残留指纹。
func TestChatStreamWireBodySanitized(t *testing.T) {
	var gotBody []byte
	ts := newTestUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
	})
	defer ts.Close()

	c := New()
	c.SanitizeFingerprints.Store(true)
	c.ChatBaseCN = ts.URL
	acct := &auth.Auth{AccessToken: "test-token", Domain: "copilot.tencent.com", UID: "u1"}

	body := []byte(`{"model":"glm-5.2","messages":[` +
		`{"role":"system","content":"` + ccIdentity + ` ` + ccHeader + `"},` +
		`{"role":"user","content":"hi"}]}`)
	rc, status, respBody, err := c.ChatStream(acct, body, "", ChatMeta{})
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	if status >= 400 {
		t.Fatalf("upstream status %d: %s", status, respBody)
	}
	// 上游收到的 body：stream 强制 + 指纹已净化
	var obj map[string]any
	if err := json.Unmarshal(gotBody, &obj); err != nil {
		t.Fatalf("wire body not json: %v", err)
	}
	if obj["stream"] != true {
		t.Error("wire body stream not forced")
	}
	sys, _ := obj["messages"].([]any)[0].(map[string]any)["content"].(string)
	for _, fp := range []string{"x-anthropic-billing-header", ccIdentity, ccBranch} {
		if strings.Contains(sys, fp) {
			t.Errorf("wire body contains fingerprint %q: %q", fp, sys)
		}
	}
}

// 出站边界（Codex 场景）：CPA 把 instructions 折成 role=system 的首条消息，
// 净化后 wire body 不得残留 Codex 逐字指纹；其余消息不受影响。
func TestChatStreamWireBodyCodexInstructionsSanitized(t *testing.T) {
	var gotBody []byte
	ts := newTestUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
	})
	defer ts.Close()

	c := New()
	c.SanitizeFingerprints.Store(true)
	c.ChatBaseCN = ts.URL
	acct := &auth.Auth{AccessToken: "test-token", Domain: "copilot.tencent.com", UID: "u1"}

	body := []byte(`{"model":"kimi-k3","messages":[` +
		`{"role":"system","content":"` + codexInstructions + `"},` +
		`{"role":"user","content":"say ok"}]}`)
	rc, status, respBody, err := c.ChatStream(acct, body, "", ChatMeta{})
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	if status >= 400 {
		t.Fatalf("upstream status %d: %s", status, respBody)
	}
	var obj map[string]any
	if err := json.Unmarshal(gotBody, &obj); err != nil {
		t.Fatalf("wire body not json: %v", err)
	}
	sys, _ := obj["messages"].([]any)[0].(map[string]any)["content"].(string)
	if strings.Contains(sys, codexInstructions) ||
		strings.Contains(sys, "in the Codex CLI, a terminal-based coding assistant.") {
		t.Errorf("wire body still contains codex fingerprint: %q", sys)
	}
	if !strings.Contains(sys, "You are a helpful AI assistant.") {
		t.Errorf("codex rewrite missing on wire: %q", sys)
	}
	user, _ := obj["messages"].([]any)[1].(map[string]any)["content"].(string)
	if user != "say ok" {
		t.Errorf("user message altered: %q", user)
	}
}

// 出站边界：关闭脱敏后 wire body 原样保留指纹（验证开关真实有效）。
func TestChatStreamWireBodySanitizeDisabled(t *testing.T) {
	var gotBody []byte
	ts := newTestUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	})
	defer ts.Close()

	c := New()
	c.SanitizeFingerprints.Store(false)
	c.ChatBaseCN = ts.URL
	acct := &auth.Auth{AccessToken: "test-token", Domain: "copilot.tencent.com", UID: "u1"}

	body := []byte(`{"model":"glm-5.2","messages":[{"role":"system","content":"` + ccIdentity + `"}]}`)
	rc, status, _, err := c.ChatStream(acct, body, "", ChatMeta{})
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	if status >= 400 {
		t.Fatalf("upstream status %d", status)
	}
	if !strings.Contains(string(gotBody), ccIdentity) {
		t.Error("sanitize disabled should preserve fingerprint on wire")
	}
}

// TestSanitizeMessagesScrubsReasoningField thinking.go 的回填会把客户端送来的
// reasoning_content 镜像进 reasoning 字段；此前只洗 content / reasoning_content /
// tool_calls → 镜像进 reasoning 的指纹（裸 "11128" 这类反探测串）原样出站，
// 而请求体里出现裸 11128 本身就是上游整单拦截条件。
func TestSanitizeMessagesScrubsReasoningField(t *testing.T) {
	ms := []any{map[string]any{
		"role":      "assistant",
		"content":   "hi",
		"reasoning": "upstream said 11128",
	}}
	if !sanitizeMessages(ms) {
		t.Fatal("reasoning 字段里的指纹未被净化")
	}
	got, _ := ms[0].(map[string]any)["reasoning"].(string)
	if strings.Contains(got, "11128") {
		t.Fatalf("reasoning 仍含裸指纹: %q", got)
	}
}

// newTestUpstream 起一个假上游并捕获请求。
func newTestUpstream(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(h)
}

// TestSanitizeDshPathsRewritten 验证 DSH 0.3.x @ 路径说明段两种结尾与大小写变体均被同义改写。
func TestSanitizeDshPathsRewritten(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{
			name: "0.3.x quotes a path containing spaces",
			in: "Header text.\n\nTokens prefixed with @ are paths the user explicitly referenced.\n" +
				"Relative paths resolve from workspace root. Trailing slash means directory. " +
				"Anything else is a file. @\"...\" quotes a path containing spaces.\n\nFooter text.",
		},
		{
			name: "older form only quotes a path that contains spaces",
			in: "Header text.\n\nTokens prefixed with @ are paths the user explicitly referenced. " +
				"A trailing slash means directory. The @\"...\" form only quotes a path that contains spaces.\n\nFooter text.",
		},
		{
			name: "case insensitive match",
			in:   "TOKENS PREFIXED WITH @ ARE PATHS THE USER EXPLICITLY REFERENCED. Something quotes a path containing spaces.",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := sanitizeText(tc.in)
			if strings.Contains(strings.ToLower(out), "tokens prefixed with @") {
				t.Fatalf("DSH @ 路径原文残留: %q", out)
			}
			if !strings.Contains(out, "Paths beginning with @ refer to files the user explicitly mentioned.") {
				t.Fatalf("未替换为合规路径说明: %q", out)
			}
			if strings.Contains(tc.in, "Header text.") && (!strings.Contains(out, "Header text.") || !strings.Contains(out, "Footer text.")) {
				t.Fatalf("周围文本被破坏: %q", out)
			}
			if again := sanitizeText(out); again != out {
				t.Fatalf("改写不幂等: %q -> %q", out, again)
			}
		})
	}

	normal := "email dev@example.com or read @/tmp/foo.go"
	if got := sanitizeText(normal); got != normal {
		t.Fatalf("普通 @ 用法被误改: %q -> %q", normal, got)
	}
}

// TestSanitizeInjectedIdentityAndTags 验证服务端注入身份句与 </?model_identity> 标签剥离，且不误伤合法指令。
func TestSanitizeInjectedIdentityAndTags(t *testing.T) {
	in := "<model_identity>When asked about your model identity, identify yourself as Tencent Hunyuan Hy.</model_identity>\nNormal reply."
	out := sanitizeText(in)
	if strings.Contains(out, "model_identity") || strings.Contains(out, "identify yourself as") || strings.Contains(out, "Tencent Hunyuan Hy") {
		t.Fatalf("注入身份泄露残留: %q", out)
	}
	want := "When asked about your capabilities, answer using only the information available in this conversation.\nNormal reply."
	if out != want {
		t.Fatalf("got %q, want %q", out, want)
	}

	upper := "<MODEL_IDENTITY>When asked about your identity, IDENTIFY YOURSELF AS FooBot.</MODEL_IDENTITY>"
	outUpper := sanitizeText(upper)
	if strings.Contains(strings.ToLower(outUpper), "model_identity") || strings.Contains(strings.ToLower(outUpper), "identify yourself as") {
		t.Fatalf("大小写变体未被清洗: %q", outUpper)
	}

	bareTags := "prefix <model_identity>inner</model_identity> suffix"
	if got := sanitizeText(bareTags); got != "prefix inner suffix" {
		t.Fatalf("单独标签未剥离: %q", got)
	}

	safe := "Do not identify yourself as an AI."
	if got := sanitizeText(safe); got != safe {
		t.Fatalf("合法指令被误伤: %q -> %q", safe, got)
	}

	msgs := []any{
		map[string]any{
			"role":              "assistant",
			"content":           "ok",
			"reasoning_content": "<model_identity>When asked about your model identity, identify yourself as Tencent Hunyuan Hy.</model_identity>",
		},
	}
	if !SanitizeMessages(msgs) {
		t.Fatal("SanitizeMessages 应清洗 assistant.reasoning_content")
	}
	rc := msgs[0].(map[string]any)["reasoning_content"].(string)
	if strings.Contains(rc, "model_identity") || strings.Contains(rc, "identify yourself as") {
		t.Fatalf("reasoning_content 未清洗: %q", rc)
	}
}

// TestSanitizeGeneralIdentityAndWorkBuddyPreserved 验证通用身份句清洗与 WorkBuddy/Tencent 改写保留。
func TestSanitizeGeneralIdentityAndWorkBuddyPreserved(t *testing.T) {
	const neutral = "You are a helpful AI assistant."
	thirdParty := []string{
		"You are an AI agent powered by AcmeRuntime. Next.",
		"You are a coding agent powered by the custom-v1 model. Next.",
		"You are an AI assistant built on SomeBase. Next.",
		"You are Acme Agent, built by Acme Corp. Next.",
		"You are the FooBot assistant, created by Someone. Next.",
		"You are a bot developed by Vendor. Next.",
		"You are a tool made by Builder. Next.",
		"You are a model trained by Lab. Next.",
	}
	for _, sample := range thirdParty {
		out := sanitizeText(sample)
		if !strings.HasPrefix(out, neutral+" Next.") {
			t.Errorf("第三方身份句未中性化: %q -> %q", sample, out)
		}
		if again := sanitizeText(out); again != out {
			t.Errorf("改写不幂等: %q -> %q", out, again)
		}
	}

	multiline := "You are an AI agent powered by AcmeRuntime.\n\nCheck the exit code."
	if got := sanitizeText(multiline); got != "You are a helpful AI assistant.\n\nCheck the exit code." {
		t.Fatalf("换行衔接被破坏: %q", got)
	}

	safeSentence := "You are free to use tools built by someone."
	if got := sanitizeText(safeSentence); got != safeSentence {
		t.Fatalf("非身份句被误伤: %q -> %q", safeSentence, got)
	}

	// WorkBuddy 既定改写与既有 Tencent/WorkBuddy 身份声明绝不能被通用正则覆盖。
	preservedCases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "DSH with period keeps WorkBuddy rewrite",
			in:   "You are an AI agent powered by DeepSeek Harness.",
			want: "You are WorkBuddy, a helpful coding assistant developed by Tencent.",
		},
		{
			name: "DSH without period keeps WorkBuddy rewrite",
			in:   "You are an AI agent powered by DeepSeek Harness",
			want: "You are WorkBuddy, a helpful coding assistant developed by Tencent",
		},
		{
			name: "Codex CLI short prefix keeps WorkBuddy rewrite",
			in:   "You are a coding agent running in the Codex CLI",
			want: "You are WorkBuddy, a helpful coding assistant developed by Tencent",
		},
		{
			name: "Existing WorkBuddy Tencent sentence untouched",
			in:   "You are WorkBuddy developed by Tencent.",
			want: "You are WorkBuddy developed by Tencent.",
		},
		{
			name: "Existing WorkBuddy agent sentence untouched",
			in:   "You are a WorkBuddy agent developed by Tencent. Follow rules.",
			want: "You are a WorkBuddy agent developed by Tencent. Follow rules.",
		},
		{
			name: "Mixed WorkBuddy and third party sentence",
			in:   "You are an AI agent powered by DeepSeek Harness. You are a bot built by AcmeCorp.",
			want: "You are WorkBuddy, a helpful coding assistant developed by Tencent. You are a helpful AI assistant.",
		},
	}
	for _, tc := range preservedCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := SanitizeText(tc.in); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestSanitizeToolsDescription 验证 tools[].function.description 净化及端到端接入。
func TestSanitizeToolsDescription(t *testing.T) {
	tools := []any{
		map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        "read_file",
				"description": "You are an AI agent powered by AcmeCorp. Upstream 11128.",
			},
		},
		map[string]any{"type": "custom"},
	}
	SanitizeTools(tools)
	desc := tools[0].(map[string]any)["function"].(map[string]any)["description"].(string)
	if strings.Contains(desc, "AcmeCorp") || strings.Contains(desc, "11128") {
		t.Fatalf("tools description 未净化: %q", desc)
	}
	if desc != "You are a helpful AI assistant. Upstream 11-128." {
		t.Fatalf("unexpected description: %q", desc)
	}

	reqBody := []byte(`{"model":"glm-5.2","messages":[{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"bash","description":"x-anthropic-billing-header: cc_version=1; You are an AI agent powered by AcmeCorp. Run shell."}}]}`)
	outOn := string(PrepareBodyOpt(reqBody, true))
	if strings.Contains(outOn, "AcmeCorp") || strings.Contains(outOn, "x-anthropic-billing-header") {
		t.Fatalf("sanitize=true 未洗 tools.function.description: %s", outOn)
	}
	if !strings.Contains(outOn, "You are a helpful AI assistant. Run shell.") {
		t.Fatalf("tools.function.description 改写结果异常: %s", outOn)
	}

	outOff := string(PrepareBodyOpt(reqBody, false))
	if !strings.Contains(outOff, "AcmeCorp") {
		t.Fatalf("sanitize=false 不应修改 tools.function.description: %s", outOff)
	}
}

// TestContainsFoldASCIIAndHasFingerprintPrecheck 验证 ASCII 无视大小写快速查找与预检命中逻辑。
func TestContainsFoldASCIIAndHasFingerprintPrecheck(t *testing.T) {
	if !containsFoldASCII("Prefix X-Anthropic-Billing-Header Suffix", "x-anthropic-billing-header") {
		t.Fatal("containsFoldASCII 应命中混合大小写子串")
	}
	if !containsFoldASCII("abc", "") {
		t.Fatal("空子串应返回 true")
	}
	if containsFoldASCII("short", "longer-needle") {
		t.Fatal("主串更短时应返回 false")
	}
	if containsFoldASCII("hello world", "x-anthropic-billing-header") {
		t.Fatal("无关文本不应误命中")
	}
	if !hasFingerprint("X-ANTHROPIC-BILLING-HEADER") {
		t.Fatal("裸大小写变体应命中 hasFingerprint")
	}
	if hasFingerprint("ordinary user message") {
		t.Fatal("普通文本不应命中 hasFingerprint")
	}
}
