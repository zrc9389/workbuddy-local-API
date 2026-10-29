package panel

import (
	"github.com/linguo2625469/workbuddy2api-panel/internal/localauth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func newTestPanel() *Panel {
	// 启用鉴权：未带 key 的请求一律 401，不进入依赖 Pool/Upstream 的 handler。
	return New(Config{Version: "test", Pool: pool.New("")})
}

// 面板安全响应头必须覆盖：页面、静态脚本、鉴权失败响应。
func TestSecurityHeadersOnAllPanelResponses(t *testing.T) {
	p := newTestPanel()
	paths := []struct{ method, path string }{
		{"GET", "/panel/"},
		{"GET", "/panel/app.js"},
		{"GET", "/panel/api/overview"}, // 401（未提供 key）
		{"POST", "/panel/api/config"},  // 401
		{"GET", "/panel/api/nonexistent"},
	}
	for _, c := range paths {
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		h := rec.Header()
		if got := h.Get("Content-Security-Policy"); got == "" {
			t.Errorf("%s %s: missing CSP", c.method, c.path)
		}
		if h.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s %s: X-Content-Type-Options=%q", c.method, c.path, h.Get("X-Content-Type-Options"))
		}
		if h.Get("X-Frame-Options") != "DENY" {
			t.Errorf("%s %s: X-Frame-Options=%q", c.method, c.path, h.Get("X-Frame-Options"))
		}
		if h.Get("Referrer-Policy") != "no-referrer" {
			t.Errorf("%s %s: Referrer-Policy=%q", c.method, c.path, h.Get("Referrer-Policy"))
		}
	}
}

// CSP 安全响应头约束校验：禁止 iframe 点击劫持与基础注入
func TestCSPDisallowsInlineScriptAndFraming(t *testing.T) {
	p := newTestPanel()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/", nil))
	csp := rec.Header().Get("Content-Security-Policy")

	for _, must := range []string{
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"default-src 'none'",
	} {
		if !strings.Contains(csp, must) {
			t.Errorf("CSP missing %q; got: %s", must, csp)
		}
	}
	for _, forbidden := range []string{
		"script-src 'self' 'unsafe-inline'",
		"https://cdn.tailwindcss.com",
		"https://fonts.googleapis.com",
		"https://fonts.gstatic.com",
	} {
		if strings.Contains(csp, forbidden) {
			t.Errorf("CSP unexpectedly allows external origin %q; got: %s", forbidden, csp)
		}
	}
	if strings.Contains(csp, "script-src 'self' 'unsafe-inline'") {
		t.Fatalf("script CSP still allows unsafe-inline: %s", csp)
	}
	if !strings.Contains(csp, "script-src-attr 'none'") {
		t.Fatalf("script-src-attr is missing: %s", csp)
	}
}

func TestIndexUsesPerResponseScriptNonce(t *testing.T) {
	p := newTestPanel()
	first := httptest.NewRecorder()
	p.ServeHTTP(first, httptest.NewRequest("GET", "/panel/", nil))
	second := httptest.NewRecorder()
	p.ServeHTTP(second, httptest.NewRequest("GET", "/panel/", nil))
	if strings.Contains(first.Header().Get("Content-Security-Policy"), "script-src 'self' 'unsafe-inline'") {
		t.Fatal("index CSP allows unsafe-inline")
	}
	if first.Header().Get("Content-Security-Policy") == second.Header().Get("Content-Security-Policy") {
		t.Fatal("index CSP nonce did not rotate")
	}
	if !strings.Contains(first.Body.String(), "nonce=") {
		t.Fatal("index script tags do not carry nonce")
	}
}

// 页面骨架响应校验
func TestIndexReferencesLocalAssets(t *testing.T) {
	p := newTestPanel()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/", nil))
	body := rec.Body.String()

	if !strings.Contains(body, "<html") {
		t.Error("index.html body looks invalid")
	}
	if strings.Contains(body, "https://cdn.tailwindcss.com") || strings.Contains(body, "https://fonts.googleapis.com") {
		t.Error("index.html references external runtime assets")
	}
	if !strings.Contains(body, "/panel/assets/tailwind.css") {
		t.Error("index.html does not reference local stylesheet")
	}
}

// app.js 必须能作为同源脚本取到且类型正确（否则页面白屏）。
func TestAppScriptServed(t *testing.T) {
	p := newTestPanel()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/app.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type=%q want javascript", ct)
	}
	if !strings.Contains(rec.Body.String(), "./assets/geometric.js") {
		t.Error("app.js body looks wrong")
	}
}

// UID 白名单：拒绝路径穿越与异常字符，放行真实 UUID 形态。
func TestValidUID(t *testing.T) {
	ok := []string{
		"248890d9-bb26-4131-87a7-4ec74d472344",
		"abc_123-XYZ",
		"a",
	}
	bad := []string{
		"",
		"../../evil",
		"x/../../y",
		`..\..\evil`,
		"a/b",
		"a\\b",
		"uid with space",
		"uid\nnewline",
		"uid\x00null",
		"café",
		strings.Repeat("a", 65), // 超长
	}
	for _, u := range ok {
		if !validUID(u) {
			t.Errorf("validUID(%q) = false, want true", u)
		}
	}
	for _, u := range bad {
		if validUID(u) {
			t.Errorf("validUID(%q) = true, want false", u)
		}
	}
}

// 未带密钥的 API 请求必须 401；携带正确密钥则通过鉴权层（不再是 401）。
func TestManagementBoundaryRejectsLegacyKey(t *testing.T) {
	a, err := localauth.New(filepath.Join(t.TempDir(), "password.json"))
	if err != nil {
		t.Fatal(err)
	}
	h := a.Wrap(newTestPanel())
	r := httptest.NewRequest("GET", "http://127.0.0.1:7863/panel/api/overview", nil)
	r.RemoteAddr = "127.0.0.1:5000"
	r.Header.Set("Authorization", "Bearer test-key")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("legacy key granted access: %d", w.Code)
	}
}
