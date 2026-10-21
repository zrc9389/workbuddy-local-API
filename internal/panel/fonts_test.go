package panel

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 字体文件必须能被静态资源 handler 原样提供（否则 @font-face 静默失败、页面回退系统字体）。
func TestFontAssetsServed(t *testing.T) {
	p := newTestPanel()
	fonts := []string{
		"source-sans-3-400.woff2",
		"source-sans-3-500.woff2",
		"source-sans-3-600.woff2",
		"noto-sans-sc-400.woff2",
		"noto-sans-sc-500.woff2",
		"source-serif-4-400.woff2",
		"source-serif-4-600.woff2",
		"source-serif-4-400-italic.woff2",
		"noto-serif-sc-400.woff2",
		"noto-serif-sc-500.woff2",
	}
	for _, name := range fonts {
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/assets/fonts/"+name, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s: code=%d want 200", name, rec.Code)
			continue
		}
		ct := rec.Header().Get("Content-Type")
		if ct != "font/woff2" && ct != "application/font-woff2" {
			t.Errorf("%s: Content-Type=%q want font/woff2", name, ct)
		}
		want, err := fs.ReadFile(assetFS, "assets/fonts/"+name)
		if err != nil {
			t.Fatalf("%s: embedded font missing: %v", name, err)
		}
		if got := rec.Body.Bytes(); len(got) != len(want) || len(got) == 0 {
			t.Errorf("%s: served %d bytes want %d", name, len(got), len(want))
		}
	}
}

// 字体目录不得成为路径穿越入口：含 ".." 段的请求一律 400（在 ServeMux 重定向之前拒绝）。
func TestFontAssetsRejectTraversal(t *testing.T) {
	p := newTestPanel()
	for _, path := range []string{
		"/panel/assets/fonts/../../index.html",
		"/panel/assets/fonts/../../app.js",
		"/panel/assets/fonts/../../../go.mod",
		"/panel/assets/fonts/..%2f..%2fapp.js",
		"/panel/assets/fonts/..%2f..%2f..%2findex.html",
		"/panel/assets/%2e%2e/%2e%2e/index.html",
	} {
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
			t.Errorf("%s: code=%d want 400/404", path, rec.Code)
		}
	}
}

// handler 层（绕过 ServeMux 的路径清洗）同样不能逃出 assets 根。
func TestFontAssetsHandlerStaysInsideAssets(t *testing.T) {
	p := newTestPanel()
	for _, path := range []string{
		"/panel/assets/fonts/../styles.css",
		"/panel/assets/fonts/../../app.js",
		"/panel/assets/fonts/../../../../go.mod",
	} {
		req := httptest.NewRequest("GET", "/panel/assets/x", nil)
		req.URL.Path = path
		rec := httptest.NewRecorder()
		p.assets(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: code=%d want 400", path, rec.Code)
		}
	}
}

func firstBytes(b []byte, n int) string {
	if len(b) > n {
		b = b[:n]
	}
	return string(b)
}
