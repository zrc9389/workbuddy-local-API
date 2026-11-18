package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

func TestBatchBNoStaticSchoolMachineIDOrWb2apiLiteralsAndWebUAAligned(t *testing.T) {
	a1 := &auth.Auth{UID: "u-school-1", AccessToken: "at1", Nickname: "n1"}
	a2 := &auth.Auth{UID: "u-school-2", AccessToken: "at2", Nickname: "n2"}

	b1 := mpEventBase(a1)
	b2 := mpEventBase(a2)
	m1, _ := b1["machineId"].(string)
	m2, _ := b2["machineId"].(string)
	if m1 == "" || m2 == "" || m1 == "0655736a-607f-4d9d-b430-58176ee9a090" || m2 == "0655736a-607f-4d9d-b430-58176ee9a090" {
		t.Fatalf("hardcoded school machineId leaked: m1=%q m2=%q", m1, m2)
	}
	if m1 == m2 {
		t.Fatalf("distinct accounts should have independent DeviceProfile machineIds: %q", m1)
	}
	if m1 != a1.EnsureDeviceProfile().MachineID {
		t.Fatalf("school machineId=%q != DeviceProfile.MachineID=%q", m1, a1.EnsureDeviceProfile().MachineID)
	}

	ev := SchoolChatTimesEvents("conv-abc")
	for _, field := range []string{"traceId", "rootRequestId", "codebuddy.conversation_request_id"} {
		v, _ := ev[field].(string)
		if v == "" || strings.Contains(strings.ToLower(v), "wb2api") {
			t.Fatalf("field %s leaked gateway literal: %q", field, v)
		}
	}

	// 验证所有 Web 端点统一使用 Chrome 133 Web UA（与 uTLS HelloChrome_Auto 一致），无 CLI UA 冲突
	var gotUAs []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUAs = append(gotUAs, r.Header.Get("User-Agent"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"code":0,"data":{"uid":"u-school-1","nickname":"n1","credit":10,"energy":0}}`)
	}))
	defer ts.Close()

	c := &Client{HTTP: ts.Client(), WebBaseCN: ts.URL, BillingBaseGlobal: ts.URL}
	if err := c.ReportWebEvent(a1, "library_doc_intro_click", "https://www.workbuddy.cn/library", "el", "doc"); err != nil {
		t.Fatalf("ReportWebEvent: %v", err)
	}
	if _, _, err := c.ClaimReward(a1, "task_x"); err != nil {
		t.Fatalf("ClaimReward: %v", err)
	}
	if _, err := c.FetchAccountProfile(a1); err != nil {
		t.Fatalf("FetchAccountProfile: %v", err)
	}
	if len(gotUAs) != 3 {
		t.Fatalf("expected 3 web calls, got %d", len(gotUAs))
	}
	for i, ua := range gotUAs {
		if ua != chromeAutoWebUA || !strings.Contains(ua, "Chrome/133.0.0.0") {
			t.Fatalf("web call #%d UA=%q want %q", i, ua, chromeAutoWebUA)
		}
	}
	if globalWebUA != chromeAutoWebUA {
		t.Fatalf("globalWebUA=%q want %q", globalWebUA, chromeAutoWebUA)
	}
}

func TestBatchBEgressGuardSameAccountConcurrentStagger(t *testing.T) {
	g := NewEgressGuard(EgressGuardOptions{
		AcquireTimeout:       2 * time.Second,
		MinSwitchGap:         -1,
		SameAccountMinGap:    40 * time.Millisecond,
		SameAccountGapJitter: 20 * time.Millisecond,
	})
	const key = "ip:198.51.100.42"
	rel1, err := g.Acquire(context.Background(), key, "acct-same")
	if err != nil {
		t.Fatal(err)
	}
	defer rel1()

	start := time.Now()
	rel2, err := g.Acquire(context.Background(), key, "acct-same")
	if err != nil {
		t.Fatal(err)
	}
	defer rel2()
	elapsed := time.Since(start)
	if elapsed < 35*time.Millisecond {
		t.Fatalf("expected same-account concurrent launch stagger >= 35ms, got %v", elapsed)
	}

	// 验证测试快速关闭开关 SameAccountMinGap: -1 生效
	fast := NewEgressGuard(EgressGuardOptions{
		AcquireTimeout:    time.Second,
		MinSwitchGap:      -1,
		SameAccountMinGap: -1,
	})
	f1, err := fast.Acquire(context.Background(), key, "acct-fast")
	if err != nil {
		t.Fatal(err)
	}
	defer f1()
	t0 := time.Now()
	f2, err := fast.Acquire(context.Background(), key, "acct-fast")
	if err != nil {
		t.Fatal(err)
	}
	defer f2()
	if time.Since(t0) > 25*time.Millisecond {
		t.Fatalf("expected disabled same-account stagger to be instant, took %v", time.Since(t0))
	}
}

func TestBatchBSSEFirstByteWaitPing(t *testing.T) {
	pr, pw := io.Pipe()
	go func() {
		time.Sleep(80 * time.Millisecond)
		_, _ = io.WriteString(pw, "data: {\"id\":\"cmpl-1\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n")
		_, _ = io.WriteString(pw, "data: [DONE]\n\n")
		_ = pw.Close()
	}()

	rec := httptest.NewRecorder()
	if err := StreamHint(rec, pr, nil, WithFirstBytePing(30*time.Millisecond)); err != nil {
		t.Fatalf("StreamHint: %v", err)
	}
	out := rec.Body.String()
	pingIdx := strings.Index(out, ": ping\n\n")
	dataIdx := strings.Index(out, "data: {")
	if pingIdx < 0 {
		t.Fatalf("expected ': ping\\n\\n' heartbeat before first frame, got:\n%s", out)
	}
	if dataIdx < 0 || pingIdx > dataIdx {
		t.Fatalf("expected ': ping\\n\\n' before first data frame, pingIdx=%d dataIdx=%d out=%s", pingIdx, dataIdx, out)
	}
}

func TestBatchBLargePayloadSanitizeNoBypassValidJSON11128AndMetadataUserID(t *testing.T) {
	// 1. 验证 rewriteLargePayload 绝不破坏 JSON 裸数字 11128，但仍脱敏字符串内的 11128 与黑名单句子
	srcJSON := `{"model":"gpt-4o","max_tokens":11128,"stream":true,"messages":[{"role":"user","content":"error code 11128 and You are a coding agent running in the Codex CLI, a terminal-based coding assistant."}]}`
	rc, _, cleanup, err := rewriteLargePayload(strings.NewReader(srcJSON), true)
	if err != nil {
		t.Fatalf("rewriteLargePayload: %v", err)
	}
	outBytes, err := io.ReadAll(rc)
	cleanup()
	if err != nil {
		t.Fatalf("read rewritten: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(outBytes, &parsed); err != nil {
		t.Fatalf("rewriteLargePayload produced invalid JSON: %v\nbody=%s", err, string(outBytes))
	}
	if mt, ok := parsed["max_tokens"].(float64); !ok || int(mt) != 11128 {
		t.Fatalf("JSON number max_tokens corrupted: got=%v want 11128", parsed["max_tokens"])
	}
	msgs := parsed["messages"].([]any)
	content := msgs[0].(map[string]any)["content"].(string)
	if strings.Contains(content, "11128") || !strings.Contains(content, "11-128") {
		t.Fatalf("string literal 11128 not sanitized: %q", content)
	}

	// 2. 验证 ChatStreamContext 大包（>256KB + IsPayloadUnmodified=true）在 SanitizeFingerprints=true 时绝不绕过脱敏，且脱敏 metadata.user_id
	var mu sync.Mutex
	var captured []byte
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		captured = raw
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer ts.Close()

	c := New()
	c.ChatBaseCN = ts.URL
	c.SanitizeFingerprints.Store(true)
	largeBody, _ := json.Marshal(map[string]any{
		"model":          "gpt-4o",
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
		"max_tokens":     11128,
		"metadata":       map[string]any{"user_id": "user_secret_fingerprint_12345", "keep": "yes"},
		"messages": []any{
			map[string]any{"role": "system", "content": "You are a coding agent running in the Codex CLI, a terminal-based coding assistant."},
			map[string]any{"role": "user", "content": strings.Repeat("a", LargePayloadThreshold+4096)},
		},
	})
	if !IsPayloadUnmodified(largeBody) {
		t.Fatal("test fixture must satisfy IsPayloadUnmodified")
	}
	acct := &auth.Auth{UID: "u-large-san", AccessToken: "tok"}
	respRC, status, _, err := c.ChatStreamContext(context.Background(), acct, largeBody, "", ChatMeta{})
	if err != nil || status != 200 {
		t.Fatalf("ChatStreamContext status=%d err=%v", status, err)
	}
	_, _ = io.Copy(io.Discard, respRC)
	respRC.Close()

	mu.Lock()
	wire := append([]byte(nil), captured...)
	mu.Unlock()
	if strings.Contains(string(wire), "Codex CLI") {
		t.Fatal("IsPayloadUnmodified bypassed SanitizeFingerprints!")
	}
	if strings.Contains(string(wire), "user_secret_fingerprint_12345") {
		t.Fatal("metadata.user_id was not sanitized!")
	}
	var wireObj map[string]any
	if err := json.Unmarshal(wire, &wireObj); err != nil {
		t.Fatalf("captured wire is not valid JSON: %v", err)
	}
	if meta, ok := wireObj["metadata"].(map[string]any); !ok || meta["keep"] != "yes" || meta["user_id"] != nil {
		t.Fatalf("unexpected sanitized metadata: %+v", wireObj["metadata"])
	}

	// 3. 验证 Spool 大包通道同样脱敏 metadata.user_id
	tmpF, err := os.CreateTemp(t.TempDir(), "spool-meta-*.json")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = tmpF.Write(largeBody)
	_, _ = tmpF.Seek(0, io.SeekStart)
	prepR, _, cleanupSpool, err := PrepareSpoolFile(tmpF, int64(len(largeBody)), SpoolPrepareOptions{
		Sanitize:       true,
		InjectCacheKey: true,
		CacheUID:       "u-spool-meta",
	})
	if err != nil {
		t.Fatalf("PrepareSpoolFile: %v", err)
	}
	spoolOut, _ := io.ReadAll(prepR)
	cleanupSpool()
	tmpF.Close()
	if strings.Contains(string(spoolOut), "user_secret_fingerprint_12345") {
		t.Fatal("PrepareSpoolFile leaked metadata.user_id!")
	}
	if bytes.Contains(spoolOut, []byte("wb2a-")) {
		t.Fatal("PrepareSpoolFile leaked wb2a- cache key prefix!")
	}
}
