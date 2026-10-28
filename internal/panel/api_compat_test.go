package panel

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestCompatRoutesAndPersonalization(t *testing.T) {
	p := New(Config{
		Version: "v2.0.0-test",
		Pool:    pool.New(""),
	})

	// 1. GET /panel/api/accounts
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/accounts", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /panel/api/accounts returned %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"accounts"`) {
			t.Fatalf("GET /panel/api/accounts missing accounts field: %s", rec.Body.String())
		}
	}

	// 2. POST /panel/api/accounts
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/accounts", strings.NewReader(`{}`)))
		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("POST /panel/api/accounts must reject missing multipart import, returned %d", rec.Code)
		}
	}

	// 3. POST /panel/api/accounts/refresh
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/accounts/refresh", strings.NewReader(`{}`)))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("POST /panel/api/accounts/refresh must report scheduler unavailable, returned %d", rec.Code)
		}
	}

	// 4. GET /panel/api/tasks
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/tasks", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /panel/api/tasks returned %d: %s", rec.Code, rec.Body.String())
		}
	}

	// 5. POST /panel/api/tasks
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/tasks", strings.NewReader(`{}`)))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("POST /panel/api/tasks must report unavailable service, returned %d", rec.Code)
		}
	}

	// 6. GET /panel/api/capabilities
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/capabilities", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /panel/api/capabilities returned %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"logs"`) {
			t.Fatalf("GET /panel/api/capabilities missing logs field: %s", rec.Body.String())
		}
	}

	// 7. GET & POST /panel/api/model_policy
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/model_policy", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /panel/api/model_policy returned %d", rec.Code)
		}
		rec = httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/model_policy", strings.NewReader(`{"id":"gpt-4","disabled":true}`)))
		if rec.Code != http.StatusOK {
			t.Fatalf("POST /panel/api/model_policy returned %d", rec.Code)
		}
	}

	// 8. GET & POST /panel/api/customization
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/customization", strings.NewReader(`{"slogan":"极简空间感知与硬件共鸣","theme":"dark","musicMode":"ambient"}`)))
		if rec.Code != http.StatusOK {
			t.Fatalf("POST /panel/api/customization returned %d: %s", rec.Code, rec.Body.String())
		}

		rec = httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/customization", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /panel/api/customization returned %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "极简空间感知与硬件共鸣") {
			t.Fatalf("customization value not persisted: %s", rec.Body.String())
		}
	}

	// 9. POST /panel/api/preferences 扩展存储
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/preferences", strings.NewReader(`{"theme":"dark","custom_text":"测试扩展文案"}`)))
		if rec.Code != http.StatusOK {
			t.Fatalf("POST /panel/api/preferences with custom text returned %d: %s", rec.Code, rec.Body.String())
		}

		rec = httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/preferences", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /panel/api/preferences returned %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "测试扩展文案") {
			t.Fatalf("custom_text not present in preferences: %s", rec.Body.String())
		}
	}

	// 10. POST /panel/api/refresh & POST /panel/api/sync
	{
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/refresh", strings.NewReader(`{}`)))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("POST /panel/api/refresh must report scheduler unavailable, returned %d", rec.Code)
		}

		rec = httptest.NewRecorder()
		p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/sync", strings.NewReader(`{}`)))
		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("POST /panel/api/sync must report unavailable sync, returned %d", rec.Code)
		}
	}
}
