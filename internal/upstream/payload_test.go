package upstream

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// TestNormalizeRoles 验证出站请求体把 developer 角色归一为 system。
// 上游 role 白名单不含 developer（OpenAI 新规范的 system 别名），
// 命中即 HTTP 400 code=11128；此处走 PrepareBodyOptWithEfforts 全链路断言。
func TestNormalizeRoles(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantRoles []string // 与输出 messages 逐条对应的期望 role；len 即消息数
	}{
		{"developer 改写为 system",
			`{"messages":[{"role":"developer","content":"x"}]}`, []string{"system"}},
		{"Developer 首字母大写改写",
			`{"messages":[{"role":"Developer","content":"x"}]}`, []string{"system"}},
		{"DEVELOPER 全大写改写",
			`{"messages":[{"role":"DEVELOPER","content":"x"}]}`, []string{"system"}},
		{"前后空白 TrimSpace 后改写",
			`{"messages":[{"role":" developer ","content":"x"}]}`, []string{"system"}},
		{"system 原样保留",
			`{"messages":[{"role":"system","content":"x"}]}`, []string{"system"}},
		{"user 原样保留",
			`{"messages":[{"role":"user","content":"x"}]}`, []string{"user"}},
		{"assistant 原样保留",
			`{"messages":[{"role":"assistant","content":"x"}]}`, []string{"assistant"}},
		{"tool 原样保留（不因未知而改写）",
			`{"messages":[{"role":"tool","content":"x"}]}`, []string{"tool"}},
		{"messages 缺失不 panic 且其余字段不变",
			`{"model":"glm-5.2"}`, []string{}},
		{"messages 为空数组不 panic",
			`{"messages":[]}`, []string{}},
		{"混合消息仅 developer 被改写",
			`{"messages":[{"role":"developer","content":"a"},{"role":"user","content":"b"},{"role":"developer","content":"c"}]}`,
			[]string{"system", "user", "system"}},
		{"sanitize=false 时仍归一（与脱敏解耦）",
			`{"messages":[{"role":"developer","content":"x"}]}`, []string{"system"}},
		{"非对象消息元素跳过、其余正常处理",
			`{"messages":["str",{"role":"developer","content":"x"},42]}`, []string{"system"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// 全程 sanitize=false：验证 role 归一与内容脱敏开关无关（D4）。
			out := PrepareBodyOptWithEfforts([]byte(c.body), false, nil)
			var obj map[string]any
			if err := json.Unmarshal(out, &obj); err != nil {
				t.Fatalf("unmarshal: %v (out=%s)", err, out)
			}

			// 提取输出 messages 里的 role（非对象元素跳过，不 panic）。
			var got []string
			if msgs, ok := obj["messages"].([]any); ok {
				for _, m := range msgs {
					msg, ok := m.(map[string]any)
					if !ok {
						continue
					}
					if role, ok := msg["role"].(string); ok {
						got = append(got, role)
					}
				}
			}

			if len(got) != len(c.wantRoles) {
				t.Fatalf("role 数量不符: got %v (%d) want %v (%d)", got, len(got), c.wantRoles, len(c.wantRoles))
			}
			for i := range got {
				if got[i] != c.wantRoles[i] {
					t.Errorf("role[%d] = %q want %q", i, got[i], c.wantRoles[i])
				}
			}
		})
	}

	// messages 缺失时，其余字段必须原样保留（除强制 stream）。
	t.Run("messages 缺失时其余字段不变", func(t *testing.T) {
		out := PrepareBodyOptWithEfforts([]byte(`{"model":"glm-5.2","temperature":0.7}`), false, nil)
		var obj map[string]any
		if err := json.Unmarshal(out, &obj); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if obj["model"] != "glm-5.2" || obj["temperature"] != 0.7 {
			t.Errorf("其余字段被改动: %v", obj)
		}
	})
}

func TestPrepareBodyOptWithEfforts(t *testing.T) {
	efforts := map[string][]string{
		"glm-5.2":      {"off", "low", "high"},
		"glm-5.2-mini": {"low", "medium"},
		"glm-5.2-max":  {"high", "xhigh"},
	}
	cases := []struct {
		name    string
		body    string
		efforts map[string][]string
		wantKey string // 输出应带有的 effort 字段名；空表示该字段应不存在
		wantVal string // 期望值
	}{
		{"downgrade to highest supported at or below request",
			`{"model":"glm-5.2-mini","reasoning_effort":"high"}`, efforts, "reasoning_effort", "medium"},
		{"floor to lowest when all supported above request",
			`{"model":"glm-5.2-max","reasoning_effort":"low"}`, efforts, "reasoning_effort", "high"},
		{"supported effort passes through unchanged",
			`{"model":"glm-5.2","reasoning_effort":"low"}`, efforts, "reasoning_effort", "low"},
		{"camelCase field name downgrades and keeps key",
			`{"model":"glm-5.2-mini","reasoningEffort":"high"}`, efforts, "reasoningEffort", "medium"},
		{"unknown model passes through",
			`{"model":"unknown","reasoning_effort":"max"}`, efforts, "reasoning_effort", "max"},
		{"unknown effort value passes through",
			`{"model":"glm-5.2","reasoning_effort":"ultra"}`, efforts, "reasoning_effort", "ultra"},
		{"empty cache passes through",
			`{"model":"glm-5.2","reasoning_effort":"max"}`, map[string][]string{}, "reasoning_effort", "max"},
		{"no effort field untouched",
			`{"model":"glm-5.2-mini","messages":[]}`, efforts, "", ""},
		{"nil efforts map passes through",
			`{"model":"glm-5.2","reasoning_effort":"max"}`, nil, "reasoning_effort", "max"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := PrepareBodyOptWithEfforts([]byte(c.body), false, c.efforts)
			var m map[string]any
			if err := json.Unmarshal(out, &m); err != nil {
				t.Fatalf("unmarshal: %v (body=%s)", err, out)
			}
			if c.wantKey == "" {
				if _, ok := m["reasoning_effort"]; ok {
					t.Errorf("reasoning_effort should be absent, got %v", m["reasoning_effort"])
				}
				if _, ok := m["reasoningEffort"]; ok {
					t.Errorf("reasoningEffort should be absent, got %v", m["reasoningEffort"])
				}
				return
			}
			got, ok := m[c.wantKey].(string)
			if !ok || got != c.wantVal {
				t.Errorf("%s: got %v (%T) want %q", c.wantKey, m[c.wantKey], m[c.wantKey], c.wantVal)
			}
		})
	}
}

// TestPrepareBodyStreamOptions body 未显式带 stream_options 时注入
// {include_usage: true}（D7，官方 CLI 流式必发）；body 已带则不覆盖。
func TestPrepareBodyStreamOptions(t *testing.T) {
	out := PrepareBodyOptWithEfforts([]byte(`{"model":"glm-5.2","messages":[]}`), false, nil)
	var obj map[string]any
	if err := json.Unmarshal(out, &obj); err != nil {
		t.Fatalf("unmarshal: %v (out=%s)", err, out)
	}
	so, ok := obj["stream_options"].(map[string]any)
	if !ok {
		t.Fatalf("stream_options not injected: %v", obj["stream_options"])
	}
	if so["include_usage"] != true {
		t.Errorf("stream_options.include_usage = %v want true", so["include_usage"])
	}

	out2 := PrepareBodyOptWithEffertsPreserve(t, `{"model":"glm-5.2","messages":[],"stream_options":{"include_usage":false}}`)
	obj2, err := decodeBody(out2)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	so2, ok := obj2["stream_options"].(map[string]any)
	if !ok {
		t.Fatalf("stream_options lost: %v", obj2["stream_options"])
	}
	if so2["include_usage"] != false {
		t.Errorf("stream_options.include_usage = %v want false (not overwritten)", so2["include_usage"])
	}
}

// PrepareBodyOptWithEffertsPreserve helper：PrepareBodyOptWithEfforts 包装。
func PrepareBodyOptWithEffertsPreserve(t *testing.T, body string) []byte {
	t.Helper()
	return PrepareBodyOptWithEfforts([]byte(body), false, nil)
}

// decodeBody helper：解析 body JSON。
func decodeBody(b []byte) (map[string]any, error) {
	var obj map[string]any
	err := json.Unmarshal(b, &obj)
	return obj, err
}

// TestPrepareBodyDeterministic 序列化稳定性：同输入跑多遍出站字节级一致
// （prompt_cache_key 前缀命中的前提——链中不得注入时间/随机/ID 类不确定源）。
func TestPrepareBodyDeterministic(t *testing.T) {
	inputs := []string{
		`{"model":"glm-5.2","messages":[{"role":"system","content":"你是助手"},{"role":"user","content":"你好"}],"reasoning_effort":"high"}`,
		`{"model":"deepseek-v4","messages":[{"role":"user","content":"写个函数"}],"tool_choice":{"type":"auto"},"tools":[{"type":"function","function":{"name":"f"}}]}`,
		`{"model":"glm-5.3","messages":[{"role":"developer","content":"sys"},{"role":"user","content":[{"type":"text","text":"hi"}]}]}`,
	}
	for i, in := range inputs {
		var first []byte
		for round := 0; round < 5; round++ {
			out := PrepareBodyOptWithEfforts([]byte(in), true, map[string][]string{"glm-5.2": {"off", "low", "high"}})
			if round == 0 {
				first = out
				continue
			}
			if string(out) != string(first) {
				t.Fatalf("input #%d round %d differs from round 0:\n%s\n%s", i, round, first, out)
			}
		}
	}
}

// TestNormalizeImageURL 覆盖 OpenAI chat 多模态内容的 image_url 兼容：
// 字符串形态必须转为上游需要的对象形态；对象形态及其中字段必须原样保留；
// 无效输入不补默认值，继续交给上游返回真实错误。
func TestNormalizeImageURL(t *testing.T) {
	tests := []struct {
		name string
		body string
		want any
	}{
		{
			name: "data url string to object",
			body: `{"messages":[{"role":"user","content":[{"type":"text","text":"look"},{"type":"image_url","image_url":"data:image/png;base64,QUJD"}]}]}`,
			want: map[string]any{"url": "data:image/png;base64,QUJD"},
		},
		{
			name: "http url string to object",
			body: `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":"https://example.test/a.png"}]}]}`,
			want: map[string]any{"url": "https://example.test/a.png"},
		},
		{
			name: "object with detail preserved",
			body: `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,QUJD","detail":"low","mime_type":"image/png"}}]}]}`,
			want: map[string]any{"url": "data:image/png;base64,QUJD", "detail": "low", "mime_type": "image/png"},
		},
		{
			name: "invalid object url type preserved",
			body: `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":123}}]}]}`,
			want: map[string]any{"url": float64(123)},
		},
		{
			name: "missing image url preserved",
			body: `{"messages":[{"role":"user","content":[{"type":"image_url"}]}]}`,
			want: nil,
		},
		{
			name: "empty string preserved",
			body: `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":""}]}]}`,
			want: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for _, sanitize := range []bool{false, true} {
				out := PrepareBodyOptWithEfforts([]byte(tc.body), sanitize, nil)
				obj, err := decodeBody(out)
				if err != nil {
					t.Fatalf("sanitize=%v unmarshal: %v (out=%s)", sanitize, err, out)
				}
				msgs := obj["messages"].([]any)
				content := msgs[0].(map[string]any)["content"].([]any)
				var part map[string]any
				for _, rawPart := range content {
					candidate, ok := rawPart.(map[string]any)
					if ok && candidate["type"] == "image_url" {
						part = candidate
						break
					}
				}
				if part == nil {
					t.Fatal("image_url part not found")
				}
				if tc.want == nil {
					if _, exists := part["image_url"]; exists {
						t.Fatalf("sanitize=%v: missing image_url should stay missing, got %#v", sanitize, part)
					}
					continue
				}
				if got := part["image_url"]; !reflect.DeepEqual(got, tc.want) {
					t.Errorf("sanitize=%v: image_url=%#v want %#v", sanitize, got, tc.want)
				}
			}
		})
	}
}

// TestNormalizeToolPatterns 工具 schema pattern 的 `\_` 转义归一（11129 实案：
// exa agent_run 的 `^agent\_run\_` 被 deepseek 系确定性拒收，归一后上游 200）。
// 覆盖：function.parameters 与裸 parameters 两形态、嵌套 schema、patternProperties
// 键、消息正文不碰、无 tools no-op、sanitize 开关两态一致。
func TestNormalizeToolPatterns(t *testing.T) {
	lookupPattern := func(t *testing.T, body string, path ...any) string {
		t.Helper()
		var obj map[string]any
		if err := json.Unmarshal([]byte(body), &obj); err != nil {
			t.Fatalf("out not json: %v", err)
		}
		cur := any(obj)
		for _, p := range path {
			switch k := p.(type) {
			case string:
				m, ok := cur.(map[string]any)
				if !ok {
					t.Fatalf("path %v: want object, got %T", path, cur)
				}
				cur = m[k]
			case int:
				l, ok := cur.([]any)
				if !ok || k >= len(l) {
					t.Fatalf("path %v: bad array at %T", path, cur)
				}
				cur = l[k]
			}
		}
		s, _ := cur.(string)
		return s
	}

	t.Run("exa agent_run pattern normalized", func(t *testing.T) {
		bs := string(byte(92))                                                                                                                                                                                                                                                                                                                // 反斜杠，测试体经工具链多层转义易被吞，运行时拼装保真
		body := `{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"agent_run","parameters":{"type":"object","properties":{"runId":{"type":"string","pattern":"^agent` + bs + bs + `_run` + bs + bs + `_"}` + `,"query":{"type":"string"}},"required":["query"]}}}]}` //nolint:lll // 实案 body 原样
		out := string(PrepareBodyOptWithEfforts([]byte(body), false, nil))
		if got := lookupPattern(t, out, "tools", 0, "function", "parameters", "properties", "runId", "pattern"); got != `^agent_run_` {
			t.Fatalf("pattern = %q, want %q", got, `^agent_run_`)
		}
		// 同 schema 的兄弟字段不受影响
		if got := lookupPattern(t, out, "tools", 0, "function", "parameters", "properties", "query", "type"); got != "string" {
			t.Fatalf("sibling field disturbed: %q", got)
		}
	})

	t.Run("nested anyOf items pattern normalized", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"messages":[],"tools":[{"type":"function","function":{"name":"t","parameters":{"anyOf":[{"properties":{"code":{"pattern":"x` + bs + bs + `_y"}}},{"type":"string"}]}}}]}` //nolint:lll
		out := string(PrepareBodyOptWithEfforts([]byte(body), false, nil))
		if got := lookupPattern(t, out, "tools", 0, "function", "parameters", "anyOf", 0, "properties", "code", "pattern"); got != "x_y" {
			t.Fatalf("nested pattern = %q, want %q", got, "x_y")
		}
	})

	t.Run("bare tool parameters form normalized", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"messages":[],"tools":[{"name":"t","parameters":{"properties":{"id":{"pattern":"p` + bs + bs + `_q"}}}}]}`
		out := string(PrepareBodyOptWithEfforts([]byte(body), false, nil))
		if got := lookupPattern(t, out, "tools", 0, "parameters", "properties", "id", "pattern"); got != "p_q" {
			t.Fatalf("bare parameters pattern = %q, want %q", got, "p_q")
		}
	})

	t.Run("patternProperties key normalized", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"messages":[],"tools":[{"type":"function","function":{"name":"t","parameters":{"patternProperties":{"^a` + bs + bs + `_b` + bs + bs + `_":{"type":"string"}}}}}]}` //nolint:lll
		var obj map[string]any
		out := PrepareBodyOptWithEfforts([]byte(body), false, nil)
		if err := json.Unmarshal(out, &obj); err != nil {
			t.Fatalf("out not json: %v", err)
		}
		tool := obj["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)["parameters"].(map[string]any)
		props := tool["patternProperties"].(map[string]any)
		if _, ok := props["^a_b_"]; !ok {
			t.Fatalf("normalized key missing: %v", props)
		}
		for k := range props {
			if strings.Contains(k, string(byte(92))) {
				t.Fatalf("patternProperties key not normalized: %q", k)
			}
		}
	})

	t.Run("message content backslash untouched", func(t *testing.T) {
		bs := string(byte(92))
		raw := `{"messages":[{"role":"user","content":"path C:` + bs + bs + `_dir and regex a` + bs + bs + `_b"}],"tools":[{"type":"function","function":{"name":"t","parameters":{"properties":{"p":{"pattern":"q` + bs + bs + `_r"}}}}}]}` //nolint:lll
		out := string(PrepareBodyOptWithEfforts([]byte(raw), false, nil))
		var obj map[string]any
		if err := json.Unmarshal([]byte(out), &obj); err != nil {
			t.Fatalf("out not json: %v", err)
		}
		msg := obj["messages"].([]any)[0].(map[string]any)
		if got := msg["content"]; got != `path C:\_dir and regex a\_b` {
			t.Fatalf("message content mutated: %q", got)
		}
	})

	t.Run("clean pattern untouched", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"messages":[],"tools":[{"type":"function","function":{"name":"t","parameters":{"properties":{"p":{"pattern":"^[a-z]+` + bs + bs + `d_$"}}}}}]}` //nolint:lll
		out := string(PrepareBodyOptWithEfforts([]byte(body), false, nil))
		if got := lookupPattern(t, out, "tools", 0, "function", "parameters", "properties", "p", "pattern"); got != `^[a-z]+\d_$` {
			t.Fatalf("clean pattern mutated: %q", got)
		}
	})

	t.Run("no tools is no-op", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"model":"m","messages":[{"role":"user","content":"a` + bs + bs + `_b"}]}`
		var inObj, outObj map[string]any
		if err := json.Unmarshal([]byte(body), &inObj); err != nil {
			t.Fatal(err)
		}
		out := PrepareBodyOptWithEfforts([]byte(body), false, nil)
		if err := json.Unmarshal(out, &outObj); err != nil {
			t.Fatalf("out not json: %v", err)
		}
		inMsg, _ := json.Marshal(inObj["messages"])
		outMsg, _ := json.Marshal(outObj["messages"])
		if string(inMsg) != string(outMsg) {
			t.Fatalf("messages changed without tools: %s -> %s", inMsg, outMsg)
		}
		if _, has := outObj["tools"]; has {
			t.Fatal("tools appeared out of nowhere")
		}
	})

	t.Run("sanitize on and off behave the same", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"messages":[],"tools":[{"type":"function","function":{"name":"t","parameters":{"properties":{"p":{"pattern":"a` + bs + bs + `_b"}}}}}]}` //nolint:lll
		for _, sanitize := range []bool{false, true} {
			out := string(PrepareBodyOptWithEfforts([]byte(body), sanitize, nil))
			if got := lookupPattern(t, out, "tools", 0, "function", "parameters", "properties", "p", "pattern"); got != "a_b" {
				t.Fatalf("sanitize=%v: pattern = %q, want %q", sanitize, got, "a_b")
			}
		}
	})
}

// TestClampGPTMinMaxTokens GPT 系上游要求 max_tokens ≥ 16（实测 gpt-6-sol/gpt-6-luna/
// gpt-5.6-sol：15 → 400 code=11133 model_param_invalid，16 → 200）。Claude Code 切
// 模型时的探针请求 max_tokens 极小，全号轮转同样被拒 → 客户端 503。非 GPT 模型不动。
func TestClampGPTMinMaxTokens(t *testing.T) {
	cases := []struct {
		name string
		body string
		want any // nil 表示字段不存在
	}{
		{"gpt below floor", `{"model":"gpt-6-sol","max_tokens":1,"messages":[]}`, float64(16)},
		{"gpt global prefix", `{"model":"global:gpt-5.6-sol","max_tokens":15,"messages":[]}`, float64(16)},
		{"gpt at floor", `{"model":"gpt-6-luna","max_tokens":16,"messages":[]}`, float64(16)},
		{"gpt above floor", `{"model":"gpt-6-sol","max_tokens":32000,"messages":[]}`, float64(32000)},
		{"gpt alias translated then clamped", `{"model":"gpt-6-sol","max_completion_tokens":1,"messages":[]}`, float64(16)},
		{"gpt absent untouched", `{"model":"gpt-6-sol","messages":[]}`, nil},
		{"non-gpt untouched", `{"model":"hy4-preview-f","max_tokens":1,"messages":[]}`, float64(1)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			obj, err := decodeBody(PrepareBodyOptWithEffertsPreserve(t, c.body))
			if err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			got, has := obj["max_tokens"]
			if c.want == nil {
				if has {
					t.Fatalf("max_tokens = %v, want absent", got)
				}
				return
			}
			if got != c.want {
				t.Fatalf("max_tokens = %v, want %v", got, c.want)
			}
		})
	}
}

func TestStripConversationID(t *testing.T) {
	in := []byte(`{"model":"glm-5.2","conversation_id":"conv-old-1","conversationId":"conv-old-2","metadata":{"conversation_id":"conv-meta-1","other":"val"},"messages":[{"role":"user","content":"hello"}]}`)
	out := StripConversationID(in)

	var obj map[string]any
	if err := json.Unmarshal(out, &obj); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if _, ok := obj["conversation_id"]; ok {
		t.Errorf("top-level conversation_id must be stripped")
	}
	if _, ok := obj["conversationId"]; ok {
		t.Errorf("top-level conversationId must be stripped")
	}
	if meta, ok := obj["metadata"].(map[string]any); ok {
		if _, ok := meta["conversation_id"]; ok {
			t.Errorf("metadata conversation_id must be stripped")
		}
		if meta["other"] != "val" {
			t.Errorf("metadata other field must be preserved, got %v", meta["other"])
		}
	} else {
		t.Errorf("metadata should be preserved")
	}

	// 验证空输入与无需修改的输入
	if len(StripConversationID(nil)) != 0 {
		t.Error("nil input should return empty")
	}
	clean := []byte(`{"model":"glm-5.2","messages":[]}`)
	if string(StripConversationID(clean)) != string(clean) {
		t.Errorf("clean input should remain identical")
	}
}

// TestGuardEmptyTextParts 验证空 text 段防护（含 []any parts 与字符串化 JSON 数组）。
func TestGuardEmptyTextParts(t *testing.T) {
	t.Run("slice parts variants", func(t *testing.T) {
		msgs := []any{
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": ""},
					map[string]any{"type": "text", "text": nil},
					map[string]any{"type": "text"},
					map[string]any{"type": "text", "text": " "},
					map[string]any{"type": "text", "text": "keep"},
					map[string]any{"type": "textarea", "text": ""},
					map[string]any{"type": "text", "text": 123},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.test/a.png"}},
				},
			},
		}
		guardEmptyTextParts(msgs)
		parts := msgs[0].(map[string]any)["content"].([]any)
		for idx := 0; idx < 4; idx++ {
			if got := parts[idx].(map[string]any)["text"]; got != " " {
				t.Errorf("part[%d].text = %#v, want %q", idx, got, " ")
			}
		}
		if got := parts[4].(map[string]any)["text"]; got != "keep" {
			t.Errorf("part[4].text = %#v, want keep", got)
		}
		if got := parts[5].(map[string]any)["text"]; got != "" {
			t.Errorf("non-text type should stay empty, got %#v", got)
		}
		if got := parts[6].(map[string]any)["text"]; got != 123 {
			t.Errorf("non-string text should stay untouched, got %#v", got)
		}
	})

	t.Run("stringified JSON array sniffed and filled", func(t *testing.T) {
		raw := "  \n\t[{\"type\":\"text\",\"text\":\"\"},{\"type\":\"text\",\"text\":\"ok\"}]"
		msgs := []any{
			map[string]any{"role": "tool", "content": raw},
		}
		guardEmptyTextParts(msgs)
		gotStr := msgs[0].(map[string]any)["content"].(string)
		var decoded []map[string]any
		if err := json.Unmarshal([]byte(gotStr), &decoded); err != nil {
			t.Fatalf("unmarshal guarded content: %v", err)
		}
		if decoded[0]["text"] != " " || decoded[1]["text"] != "ok" {
			t.Fatalf("unexpected decoded parts: %#v", decoded)
		}
	})

	t.Run("non-array or clean strings untouched", func(t *testing.T) {
		unchangedInputs := []string{
			`{"type":"text","text":""}`,
			`[invalid json`,
			`[]`,
			`[1,2,3]`,
			`[{"type":"text","text":"ok"}]`,
			`plain text`,
		}
		for _, raw := range unchangedInputs {
			msgs := []any{map[string]any{"role": "user", "content": raw}}
			guardEmptyTextParts(msgs)
			if got := msgs[0].(map[string]any)["content"]; got != raw {
				t.Errorf("input %q mutated to %q", raw, got)
			}
		}
	})

	t.Run("pipeline end-to-end including post-sanitize empty text", func(t *testing.T) {
		body := []byte(`{"model":"kimi-k3","messages":[{"role":"user","content":[{"type":"text","text":""},{"type":"text","text":"x-anthropic-billing-header: cc_version=1;"}]}]}`)
		out := PrepareBodyOpt(body, true)
		obj, err := decodeBody(out)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		parts := obj["messages"].([]any)[0].(map[string]any)["content"].([]any)
		for idx, rawPart := range parts {
			if got := rawPart.(map[string]any)["text"]; got != " " {
				t.Errorf("part[%d].text = %#v, want %q", idx, got, " ")
			}
		}
	})
}

// TestReasoningMirror 验证特定家族模型从 reasoning_content 镜像到 reasoning 的逻辑与单消息入口。
func TestReasoningMirror(t *testing.T) {
	t.Run("readsUpstreamReasoning prefixes with realm", func(t *testing.T) {
		yesModels := []string{
			"kimi-k3.1-pro", "cn:kimi-k3.1-pro", "global:KIMI-K2.5",
			"glm-5.3", "cn:glm-5.2", "minimax-m3", "mimo-v1", "step-2", "space-bunny-1",
		}
		for _, model := range yesModels {
			if !readsUpstreamReasoning(model) {
				t.Errorf("readsUpstreamReasoning(%q) = false, want true", model)
			}
		}
		noModels := []string{"deepseek-v4.1-flash", "cn:gpt-6-sol", "hy4-preview", "", "cn:"}
		for _, model := range noModels {
			if readsUpstreamReasoning(model) {
				t.Errorf("readsUpstreamReasoning(%q) = true, want false", model)
			}
		}
	})

	t.Run("mirrorUpstreamReasoning selective copy", func(t *testing.T) {
		obj := map[string]any{
			"model": "cn:kimi-k3.1-pro",
			"messages": []any{
				map[string]any{"role": "user", "content": "hi", "reasoning_content": "ignore user"},
				map[string]any{"role": "assistant", "content": "a1", "reasoning_content": "thought 1"},
				map[string]any{"role": "assistant", "content": "a2", "reasoning_content": "thought 2", "reasoning": "   "},
				map[string]any{"role": "assistant", "content": "a3", "reasoning_content": "thought 3", "reasoning": "authoritative"},
				map[string]any{"role": "assistant", "content": "a4", "reasoning_content": "   "},
			},
		}
		mirrorUpstreamReasoning(obj)
		msgs := obj["messages"].([]any)
		if _, exists := msgs[0].(map[string]any)["reasoning"]; exists {
			t.Error("user message must not get reasoning")
		}
		if got := msgs[1].(map[string]any)["reasoning"]; got != "thought 1" {
			t.Errorf("assistant[1].reasoning = %#v, want thought 1", got)
		}
		if got := msgs[2].(map[string]any)["reasoning"]; got != "thought 2" {
			t.Errorf("assistant[2].reasoning = %#v, want thought 2", got)
		}
		if got := msgs[3].(map[string]any)["reasoning"]; got != "authoritative" {
			t.Errorf("assistant[3].reasoning overwritten: %#v", got)
		}
		if _, exists := msgs[4].(map[string]any)["reasoning"]; exists {
			t.Error("whitespace-only reasoning_content must not create reasoning")
		}
	})

	t.Run("single message streaming helper", func(t *testing.T) {
		msg := map[string]any{"role": "assistant", "content": "ok", "reasoning_content": "chain"}
		mirrorAssistantMessageReasoning(msg, "cn:glm-5.3")
		if msg["reasoning"] != "chain" {
			t.Fatalf("reasoning = %#v, want chain", msg["reasoning"])
		}
		other := map[string]any{"role": "assistant", "content": "ok", "reasoning_content": "chain"}
		MirrorAssistantMessageReasoning(other, "hy4-preview")
		if _, exists := other["reasoning"]; exists {
			t.Fatal("non-matching model should not mirror reasoning")
		}
		MirrorAssistantMessageReasoning(nil, "kimi-k3")
	})

	t.Run("end-to-end prefixed kimi mirrors reasoning", func(t *testing.T) {
		body := []byte(`{"model":"cn:kimi-k3.1-pro","messages":[{"role":"user","content":"q"},{"role":"assistant","content":"a","reasoning_content":"step 1"}]}`)
		out := PrepareBodyOpt(body, false)
		obj, err := decodeBody(out)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		if obj["model"] != "kimi-k3.1-pro" {
			t.Fatalf("model = %v, want kimi-k3.1-pro", obj["model"])
		}
		assistant := obj["messages"].([]any)[1].(map[string]any)
		if assistant["reasoning"] != "step 1" {
			t.Fatalf("assistant.reasoning = %#v, want step 1", assistant["reasoning"])
		}
	})
}

// TestOutputBudgetAndThinkingSwitch 验证目录上限注入、输出预算下限抬升与开关能力判定。
func TestOutputBudgetAndThinkingSwitch(t *testing.T) {
	if !ThinkingSwitchSupported("deepseek-v4.1-flash") ||
		!ThinkingSwitchSupported("cn:deepseek-v4-pro") ||
		!ThinkingSwitchSupported("global:DeepSeek-R1") {
		t.Fatal("DeepSeek models should support thinking switch")
	}
	if ThinkingSwitchSupported("glm-5.2") || ThinkingSwitchSupported("cn:kimi-k3") || ThinkingSwitchSupported("") {
		t.Fatal("non-DeepSeek models should not report thinking switch supported")
	}

	budgetCases := []struct {
		effort string
		want   int64
	}{
		{"minimal", 4096},
		{"low", 4096},
		{"medium", 6144},
		{"HIGH", 8192},
		{"xhigh", 12288},
		{"max", 16384},
		{"unknown", 0},
		{"", 0},
	}
	for _, tc := range budgetCases {
		if got := MinOutputBudget(tc.effort); got != tc.want {
			t.Errorf("MinOutputBudget(%q) = %d, want %d", tc.effort, got, tc.want)
		}
	}

	t.Run("EnsureMinBudget", func(t *testing.T) {
		obj := map[string]any{"model": "m", "max_tokens": float64(1024)}
		if !EnsureMinBudget(obj, 8192) || obj["max_tokens"] != int64(8192) {
			t.Fatalf("EnsureMinBudget did not raise: %#v", obj)
		}
		probe := map[string]any{"model": "m", "max_tokens": float64(1)}
		if EnsureMinBudget(probe, 8192) || probe["max_tokens"] != float64(1) {
			t.Fatalf("probe max_tokens=1 should not be raised: %#v", probe)
		}
		noTokens := map[string]any{"model": "m"}
		if EnsureMinBudget(noTokens, 8192) {
			t.Fatal("missing max_tokens should not be modified")
		}
		if EnsureMinBudget(map[string]any{"max_tokens": float64(1024)}, 0) {
			t.Fatal("floor<=0 should not modify")
		}
	})

	t.Run("ensureMinOutputBudget raises, respects disabled and catalog cap", func(t *testing.T) {
		obj := map[string]any{"model": "deepseek-v4.1-flash", "max_tokens": "2048"}
		ensureMinOutputBudget(obj, "high", nil)
		if obj["max_tokens"] != int64(8192) {
			t.Fatalf("string max_tokens not raised: %#v", obj["max_tokens"])
		}

		disabled := map[string]any{
			"model":      "deepseek-v4.1-flash",
			"max_tokens": float64(512),
			"thinking":   map[string]any{"type": "disabled"},
		}
		ensureMinOutputBudget(disabled, "high", nil)
		if disabled["max_tokens"] != float64(512) {
			t.Fatalf("disabled thinking budget modified: %#v", disabled["max_tokens"])
		}

		capped := map[string]any{"model": "small", "max_tokens": float64(1024)}
		ensureMinOutputBudget(capped, "max", map[string]int64{"small": 6000})
		if capped["max_tokens"] != int64(6000) {
			t.Fatalf("capped budget = %#v, want 6000", capped["max_tokens"])
		}
	})

	t.Run("PrepareBodyOptWithEffortsDefaultAndCaps nil vs non-nil maxOut", func(t *testing.T) {
		src := []byte(`{"model":"cn:deepseek-v4.1-flash","reasoning_effort":"max","max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}`)
		outNil, effNil := PrepareBodyOptWithEffortsDefaultAndCaps(src, false,
			map[string][]string{"deepseek-v4.1-flash": {"low", "high", "max"}},
			map[string]string{"deepseek-v4.1-flash": "high"},
			nil,
		)
		objNil, err := decodeBody(outNil)
		if err != nil {
			t.Fatalf("decode outNil: %v", err)
		}
		if objNil["max_tokens"] != float64(1024) {
			t.Fatalf("maxOut=nil should not raise max_tokens, got %v", objNil["max_tokens"])
		}
		if effNil != "max" {
			t.Fatalf("effNil = %q, want max", effNil)
		}

		outCap, effCap := PrepareBodyOptWithEffortsDefaultAndCaps(src, false,
			map[string][]string{"deepseek-v4.1-flash": {"low", "high", "max"}},
			map[string]string{"deepseek-v4.1-flash": "high"},
			map[string]int64{"deepseek-v4.1-flash": 131072},
		)
		objCap, err := decodeBody(outCap)
		if err != nil {
			t.Fatalf("decode outCap: %v", err)
		}
		if objCap["max_tokens"] != float64(16384) || effCap != "max" {
			t.Fatalf("max_tokens=%v eff=%q, want 16384/max", objCap["max_tokens"], effCap)
		}

		noBudget := []byte(`{"model":"cn:hy3","reasoning_effort":"max","messages":[]}`)
		outInjected, effInjected := PrepareBodyOptWithEffortsDefaultAndCaps(noBudget, false,
			map[string][]string{"hy3": {"low", "high"}},
			map[string]string{"hy3": "high"},
			map[string]int64{"hy3": 64000},
		)
		objInj, err := decodeBody(outInjected)
		if err != nil {
			t.Fatalf("decode outInjected: %v", err)
		}
		if objInj["model"] != "hy3" || objInj["max_tokens"] != float64(64000) || effInjected != "high" {
			t.Fatalf("unexpected injected result: model=%v max_tokens=%v eff=%q", objInj["model"], objInj["max_tokens"], effInjected)
		}
	})
}

// TestSplitRealmPrefixAndModelNormalization 验证域前缀解析、出站剥离、enum 类型推断及 >256KB 大请求全管线。
func TestSplitRealmPrefixAndModelNormalization(t *testing.T) {
	splitCases := []struct {
		in, realm, bare string
	}{
		{"cn:hy3", "cn", "hy3"},
		{"global:gpt-x", "global", "gpt-x"},
		{"hy3", "cn", "hy3"},
		{"weird:model", "cn", "weird:model"},
		{"cn:", "cn", ""},
		{":", "cn", ":"},
		{"", "cn", ""},
	}
	for _, tc := range splitCases {
		realm, bare := SplitRealmPrefix(tc.in)
		if realm != tc.realm || bare != tc.bare {
			t.Errorf("SplitRealmPrefix(%q) = (%q,%q), want (%q,%q)", tc.in, realm, bare, tc.realm, tc.bare)
		}
	}

	t.Run("inferEnumType in tool schema", func(t *testing.T) {
		bs := string(byte(92))
		body := `{"model":"cn:kimi-k3","messages":[],"tools":[{"type":"function","function":{"name":"search","parameters":{"type":"object","properties":{"mode":{"enum":["fast","deep"]},"flag":{"enum":[true,false]},"count":{"enum":[1,2,3]},"ratio":{"enum":[1,1.5]},"mixed":{"enum":["a",1]},"typed":{"type":"string","enum":["x"]},"id":{"type":"string","pattern":"^id` + bs + bs + `_"}}}}}]}`
		out := PrepareBodyOpt([]byte(body), false)
		obj, err := decodeBody(out)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		if obj["model"] != "kimi-k3" {
			t.Fatalf("model = %v, want kimi-k3", obj["model"])
		}
		props := obj["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)["parameters"].(map[string]any)["properties"].(map[string]any)
		if got := props["mode"].(map[string]any)["type"]; got != "string" {
			t.Errorf("mode.type = %#v, want string", got)
		}
		if got := props["flag"].(map[string]any)["type"]; got != "boolean" {
			t.Errorf("flag.type = %#v, want boolean", got)
		}
		if got := props["count"].(map[string]any)["type"]; got != "integer" {
			t.Errorf("count.type = %#v, want integer", got)
		}
		if got := props["ratio"].(map[string]any)["type"]; got != "number" {
			t.Errorf("ratio.type = %#v, want number", got)
		}
		if _, has := props["mixed"].(map[string]any)["type"]; has {
			t.Errorf("mixed enum should not infer type: %#v", props["mixed"])
		}
		if got := props["typed"].(map[string]any)["type"]; got != "string" {
			t.Errorf("existing type disturbed: %#v", got)
		}
		if got := props["id"].(map[string]any)["pattern"]; got != "^id_" {
			t.Errorf("pattern = %#v, want ^id_", got)
		}
	})

	t.Run("large payload above 256KB runs full pipeline", func(t *testing.T) {
		padding := strings.Repeat("a", LargePayloadThreshold+2048)
		body := []byte(`{"model":"cn:kimi-k3.1-pro","messages":[{"role":"developer","content":"You are an AI agent powered by AcmeCorp. ` + padding + `"},{"role":"assistant","content":[{"type":"text","text":""}],"reasoning_content":"trace"}],"tools":[{"type":"function","function":{"name":"t","description":"11128","parameters":{"properties":{"kind":{"enum":["a","b"]}}}}}]}`)
		out, _ := PrepareBodyOptWithEffortsDefaultAndCaps(body, true, nil, nil, map[string]int64{"kimi-k3.1-pro": 65536})
		obj, err := decodeBody(out)
		if err != nil {
			t.Fatalf("decode large out: %v", err)
		}
		if obj["model"] != "kimi-k3.1-pro" {
			t.Errorf("large model = %v, want kimi-k3.1-pro", obj["model"])
		}
		if obj["max_tokens"] != float64(65536) {
			t.Errorf("large max_tokens = %v, want 65536", obj["max_tokens"])
		}
		msgs := obj["messages"].([]any)
		devMsg := msgs[0].(map[string]any)
		if devMsg["role"] != "system" {
			t.Errorf("large developer role not normalized: %v", devMsg["role"])
		}
		if strings.Contains(devMsg["content"].(string), "AcmeCorp") {
			t.Error("large message not sanitized")
		}
		assistantMsg := msgs[1].(map[string]any)
		if assistantMsg["reasoning"] != "trace" {
			t.Errorf("large assistant reasoning not mirrored: %#v", assistantMsg["reasoning"])
		}
		partText := assistantMsg["content"].([]any)[0].(map[string]any)["text"]
		if partText != " " {
			t.Errorf("large empty text part = %#v, want space", partText)
		}
		tool := obj["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)
		if tool["description"] != "11-128" {
			t.Errorf("large tool description = %#v, want 11-128", tool["description"])
		}
		enumType := tool["parameters"].(map[string]any)["properties"].(map[string]any)["kind"].(map[string]any)["type"]
		if enumType != "string" {
			t.Errorf("large enum inferred type = %#v, want string", enumType)
		}
	})
}
