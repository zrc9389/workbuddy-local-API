package panel

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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
