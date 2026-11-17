package upstream

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

var (
	reHex32 = regexp.MustCompile(`^[0-9a-f]{32}$`)
	reHex36 = regexp.MustCompile(`^[0-9a-f]{36}$`)
)

func TestHeadersUsePersistedDeviceProfileAndRandomRequestID(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	a1 := &auth.Auth{AccessToken: "at1", UID: "u-same", FilePath: filepath.Join(dir, "workbuddy-a1.json")}
	a2 := &auth.Auth{AccessToken: "at2", UID: "u-same", FilePath: filepath.Join(dir, "workbuddy-a2.json")}
	c := &Client{}

	req1, _ := http.NewRequest(http.MethodPost, "https://chat.example/v2/chat/completions", nil)
	c.ChatHeaders(req1, a1, "", ChatMeta{})

	req1b, _ := http.NewRequest(http.MethodPost, "https://chat.example/v2/chat/completions", nil)
	c.ChatHeaders(req1b, a1, "", ChatMeta{})

	req2, _ := http.NewRequest(http.MethodPost, "https://chat.example/v2/chat/completions", nil)
	c.ChatHeaders(req2, a2, "", ChatMeta{})

	m1 := req1.Header.Get("X-Machine-ID")
	s1 := req1.Header.Get("X-Session-ID")
	m1b := req1b.Header.Get("X-Machine-ID")
	s1b := req1b.Header.Get("X-Session-ID")
	m2 := req2.Header.Get("X-Machine-ID")
	s2 := req2.Header.Get("X-Session-ID")

	if !reHex36.MatchString(m1) || !reHex36.MatchString(s1) {
		t.Fatalf("invalid X-Machine-ID/X-Session-ID format: %q / %q", m1, s1)
	}
	if m1 != m1b || s1 != s1b {
		t.Fatalf("same account headers drifted across requests: (%q,%q) vs (%q,%q)", m1, s1, m1b, s1b)
	}
	dp1 := a1.DeviceProfileValue()
	if m1 != dp1.MachineID || s1 != dp1.SessionID {
		t.Fatalf("headers do not match persisted DeviceProfile: hdr=(%q,%q) dp=(%q,%q)", m1, s1, dp1.MachineID, dp1.SessionID)
	}
	// 同 UID 两个独立账号对象必须互异，且不能等于旧 UID 派生哈希。
	if m1 == m2 || s1 == s2 {
		t.Fatalf("distinct accounts must not share machine/session IDs: (%q,%q) vs (%q,%q)", m1, s1, m2, s2)
	}
	legacySum := sha256.Sum256([]byte("wb2a:machine:u-same"))
	if m1 == hex.EncodeToString(legacySum[:18]) || m2 == hex.EncodeToString(legacySum[:18]) {
		t.Fatalf("X-Machine-ID must not be UID-derived")
	}

	// X-Request-ID 每次纯随机 32 hex 且不重复。
	rid1 := req1.Header.Get("X-Request-ID")
	rid1b := req1b.Header.Get("X-Request-ID")
	if !reHex32.MatchString(rid1) || !reHex32.MatchString(rid1b) {
		t.Fatalf("X-Request-ID must be 32 hex: %q / %q", rid1, rid1b)
	}
	if rid1 == rid1b {
		t.Fatalf("X-Request-ID repeated across requests: %q", rid1)
	}

	// X-Device-Token 空时不伪造。
	if got := req1.Header.Get("X-Device-Token"); got != "" {
		t.Fatalf("X-Device-Token must stay empty when unset, got %q", got)
	}

	// nil 或空 UID 不注入设备头。
	reqAnon, _ := http.NewRequest(http.MethodPost, "https://chat.example/v2/chat/completions", nil)
	c.CommonHeaders(reqAnon, &auth.Auth{AccessToken: "at"})
	if reqAnon.Header.Get("X-Machine-ID") != "" || reqAnon.Header.Get("X-Session-ID") != "" {
		t.Fatalf("empty UID must not inject machine/session headers")
	}
}

func TestDesktopAndWebReportUseDeviceProfileAndRandomRequestID(t *testing.T) {
	t.Parallel()

	var (
		desktopReqIDs []string
		desktopEvents []map[string]any
		webEvents     []map[string]any
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if r.Header.Get("x-client-platform") == "web" {
			var arr []map[string]any
			if err := json.Unmarshal(raw, &arr); err != nil {
				t.Errorf("web report invalid json: %v", err)
			}
			webEvents = append(webEvents, arr...)
		} else {
			desktopReqIDs = append(desktopReqIDs, r.Header.Get("X-Request-ID"))
			var arr []map[string]any
			if err := json.Unmarshal(raw, &arr); err != nil {
				t.Errorf("desktop report invalid json: %v", err)
			}
			desktopEvents = append(desktopEvents, arr...)
		}
		_, _ = w.Write([]byte(`{"code":0,"msg":"OK"}`))
	}))
	defer srv.Close()

	c := &Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, WebBaseCN: srv.URL}
	a := &auth.Auth{AccessToken: "at", UID: "u-fp", Nickname: "Tester"}

	if err := c.ReportDesktopEvent(a, DesktopEvent{"eventCode": "ev1"}); err != nil {
		t.Fatalf("ReportDesktopEvent 1: %v", err)
	}
	if err := c.ReportDesktopEvent(a, DesktopEvent{"eventCode": "ev2"}); err != nil {
		t.Fatalf("ReportDesktopEvent 2: %v", err)
	}
	if err := c.ReportWebEvent(a, "library_doc_intro_click", "https://www.workbuddy.cn/lib", "el1", "name1"); err != nil {
		t.Fatalf("ReportWebEvent: %v", err)
	}

	dp := a.DeviceProfileValue()
	if len(desktopEvents) != 2 || len(desktopReqIDs) != 2 || len(webEvents) != 1 {
		t.Fatalf("unexpected captured counts: desktop=%d reqIDs=%d web=%d", len(desktopEvents), len(desktopReqIDs), len(webEvents))
	}

	for i, ev := range desktopEvents {
		if ev["machineId"] != dp.MachineID || ev["sessionId"] != dp.SessionID {
			t.Fatalf("event %d IDs mismatch: got=(%v,%v) want=(%q,%q)", i, ev["machineId"], ev["sessionId"], dp.MachineID, dp.SessionID)
		}
		if ev["os"] != dp.OS || ev["arch"] != dp.Arch || ev["osVersion"] != dp.OSVersion {
			t.Fatalf("event %d OS mismatch: got=(%v,%v,%v) want=(%q,%q,%q)", i, ev["os"], ev["arch"], ev["osVersion"], dp.OS, dp.Arch, dp.OSVersion)
		}
		if int(ev["cpuCores"].(float64)) != dp.CPUCores || int(ev["memorySize"].(float64)) != dp.MemorySize {
			t.Fatalf("event %d hw mismatch: got=(%v,%v) want=(%d,%d)", i, ev["cpuCores"], ev["memorySize"], dp.CPUCores, dp.MemorySize)
		}
	}

	// ReportDesktopEvent 的 X-Request-ID 必须是纯 32 hex 随机值且两次不同。
	if !reHex32.MatchString(desktopReqIDs[0]) || !reHex32.MatchString(desktopReqIDs[1]) {
		t.Fatalf("desktop X-Request-ID must be pure 32 hex: %q / %q", desktopReqIDs[0], desktopReqIDs[1])
	}
	if desktopReqIDs[0] == desktopReqIDs[1] {
		t.Fatalf("desktop X-Request-ID must not repeat: %q", desktopReqIDs[0])
	}

	// ReportWebEvent 使用独立随机持久化的 WebMachineID（36 hex，与 desktop MachineID 不同）。
	webMID, _ := webEvents[0]["machineId"].(string)
	if webMID != dp.WebMachineID || !reHex36.MatchString(webMID) {
		t.Fatalf("web machineId = %q want %q", webMID, dp.WebMachineID)
	}
	if webMID == dp.MachineID {
		t.Fatalf("web machineId must be distinct from desktop machineId: %q", webMID)
	}

	// 不同账号池硬件与设备 ID 应呈现异构分布（不再全池硬编码 20 核 / 24GB / 10.0.26220）。
	type hwKey struct {
		os, arch, ver string
		cores, mem    int
	}
	seenHW := map[hwKey]bool{}
	seenMID := map[string]bool{}
	for i := 0; i < 30; i++ {
		acc := &auth.Auth{AccessToken: "at", UID: "pool-acc"}
		fp := desktopFingerprint(acc)
		mid := fp["machineId"].(string)
		if seenMID[mid] {
			t.Fatalf("duplicate machineId across distinct accounts: %q", mid)
		}
		seenMID[mid] = true
		seenHW[hwKey{
			os:    fp["os"].(string),
			arch:  fp["arch"].(string),
			ver:   fp["osVersion"].(string),
			cores: fp["cpuCores"].(int),
			mem:   fp["memorySize"].(int),
		}] = true
	}
	if len(seenHW) < 3 {
		t.Fatalf("desktopFingerprint hardware should be heterogeneous across pool, got %d unique presets", len(seenHW))
	}
}

func TestDesktopChatWithExpertUsesRandomRequestID(t *testing.T) {
	t.Parallel()

	var gotReqIDs []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReqIDs = append(gotReqIDs, r.Header.Get("X-Request-ID"))
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"id\":\"cmb-0123456789abcdef0123456789abcdef\"}\n\n"))
	}))
	defer srv.Close()

	c := &Client{HTTP: srv.Client(), ChatBaseCN: srv.URL}
	a := &auth.Auth{AccessToken: "at", UID: "u-exp"}

	if _, rid, err := c.DesktopChatWithExpert(a, "exp-1"); err != nil || rid != "cmb-0123456789abcdef0123456789abcdef" {
		t.Fatalf("call 1: rid=%q err=%v", rid, err)
	}
	if _, rid, err := c.DesktopChatWithExpert(a, "exp-1"); err != nil || rid != "cmb-0123456789abcdef0123456789abcdef" {
		t.Fatalf("call 2: rid=%q err=%v", rid, err)
	}
	if len(gotReqIDs) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(gotReqIDs))
	}
	if !reHex32.MatchString(gotReqIDs[0]) || !reHex32.MatchString(gotReqIDs[1]) {
		t.Fatalf("DesktopChatWithExpert X-Request-ID must be pure 32 hex (not UnixNano): %q / %q", gotReqIDs[0], gotReqIDs[1])
	}
	if gotReqIDs[0] == gotReqIDs[1] {
		t.Fatalf("DesktopChatWithExpert X-Request-ID repeated: %q", gotReqIDs[0])
	}
}
