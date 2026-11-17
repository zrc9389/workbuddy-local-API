package session

import (
	"encoding/json"
	"strings"
	"testing"
)

func buildChatBody(t *testing.T, systemRole, systemContent, firstUser string, extra ...map[string]any) []byte {
	t.Helper()
	msgs := []map[string]any{
		{"role": systemRole, "content": systemContent},
		{"role": "user", "content": firstUser},
	}
	msgs = append(msgs, extra...)
	raw, err := json.Marshal(map[string]any{
		"model":    "glm-5.3",
		"messages": msgs,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return raw
}

func TestDeriveKeyIgnoresDynamicSystemContext(t *testing.T) {
	t.Parallel()

	sysTurn1 := strings.Join([]string{
		"You are a helpful coding assistant.",
		"Current date: 2026-11-17",
		"Current time: 23:59:58+08:00",
		"Today's date is 2026-11-17.",
		"Timestamp: 2026-11-17T23:59:58Z",
		"Current working directory: /root/project-alpha",
		"Workspace: /root/project-alpha",
		"gitStatus: This is the git status at the start of the conversation.",
		"Current branch: feat/auth-fingerprint",
		"Main branch (you will usually use this for PRs): main",
		"Status:",
		" M internal/auth/auth.go",
		"?? internal/auth/device_profile.go",
		"Recent commits:",
		"3eed47b fix: egress and tasks ring status",
		"24d1536 fix(panel,usage): align usage and error model timeline",
		"",
		"Always write idiomatic, race-free Go code.",
	}, "\n")

	sysTurn2 := strings.Join([]string{
		"You are a helpful coding assistant.",
		"Current date: 2026-11-18",
		"Current time: 00:05:12+08:00",
		"Today's date is 2026-11-18.",
		"Timestamp: 2026-11-18T00:05:12Z",
		"Current working directory: /root/project-beta/subdir",
		"Workspace: /root/project-beta",
		"gitStatus: This is the git status at the start of the conversation.",
		"Current branch: main",
		"Main branch (you will usually use this for PRs): main",
		"Status:",
		"(clean)",
		"Recent commits:",
		"abcdef12 chore: release v2",
		"",
		"Always write idiomatic, race-free Go code.",
	}, "\n")

	k1 := ExtractKey(buildChatBody(t, "system", sysTurn1, "帮我排查这个竞态问题"))
	k2 := ExtractKey(buildChatBody(t, "system", sysTurn2, "帮我排查这个竞态问题",
		map[string]any{"role": "assistant", "content": "好的，让我先看代码"},
		map[string]any{"role": "user", "content": "再看看锁顺序"},
	))

	if k1 == "" || !strings.HasPrefix(k1, derivedKeyPrefix) {
		t.Fatalf("expected derived key, got %q", k1)
	}
	if k1 != k2 {
		t.Fatalf("deriveKey drifted on dynamic system context: k1=%q k2=%q", k1, k2)
	}
}

func TestDeriveKeyIgnoresChineseDynamicLinesAndInlineTimestamps(t *testing.T) {
	t.Parallel()

	sys1 := strings.Join([]string{
		"你是一名资深后端架构师。",
		"- 当前日期：2026-11-17",
		"- 当前时间: 14:22:01",
		"- 当前目录：/home/dev/repo-a",
		"- 工作目录: /home/dev/repo-a",
		"- 当前分支：feat/v1",
		"会话初始化于 2026-11-17T14:22:01+08:00，请保持回答简洁。",
		"<gitStatus>\n M main.go\n</gitStatus>",
	}, "\n")

	sys2 := strings.Join([]string{
		"你是一名资深后端架构师。",
		"- 当前日期：2026-11-18",
		"- 当前时间: 09:05:44",
		"- 当前目录：/home/dev/repo-b",
		"- 工作目录: /home/dev/repo-b",
		"- 当前分支：main",
		"会话初始化于 2026-11-18 09:05:44，请保持回答简洁。",
		"<gitStatus>\n?? scratch.txt\n</gitStatus>",
	}, "\n")

	k1 := ExtractKey(buildChatBody(t, "developer", sys1, "设计一个持久化设备画像方案"))
	k2 := ExtractKey(buildChatBody(t, "developer", sys2, "设计一个持久化设备画像方案"))
	if k1 == "" || k1 != k2 {
		t.Fatalf("Chinese dynamic context / inline timestamp caused drift: k1=%q k2=%q", k1, k2)
	}
}

func TestDeriveKeyDistinguishesCoreSystemAndFirstUserChanges(t *testing.T) {
	t.Parallel()

	base := ExtractKey(buildChatBody(t, "system",
		"You are a helpful coding assistant.\nCurrent date: 2026-11-18\nAlways return HTTP status 200.",
		"Explain mutexes in Go",
	))
	diffSys := ExtractKey(buildChatBody(t, "system",
		"You are a strict SQL reviewer.\nCurrent date: 2026-11-18\nAlways return HTTP status 200.",
		"Explain mutexes in Go",
	))
	diffProseStatus := ExtractKey(buildChatBody(t, "system",
		"You are a helpful coding assistant.\nCurrent date: 2026-11-18\nAlways return HTTP status 404.",
		"Explain mutexes in Go",
	))
	diffUser := ExtractKey(buildChatBody(t, "system",
		"You are a helpful coding assistant.\nCurrent date: 2026-11-18\nAlways return HTTP status 200.",
		"Explain channels in Go",
	))

	if base == "" {
		t.Fatal("base key should not be empty")
	}
	if base == diffSys {
		t.Fatalf("different core system prompt must yield different key: %q", base)
	}
	if base == diffProseStatus {
		t.Fatalf("static prose containing 'status' must not be stripped: %q", base)
	}
	if base == diffUser {
		t.Fatalf("different first user message must yield different key: %q", base)
	}
}
