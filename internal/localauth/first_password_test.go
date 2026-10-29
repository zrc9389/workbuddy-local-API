package localauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// TestFirstPasswordSetupAndDefaultPasswordBypass 验证首次免密与首次输入即设定密码逻辑 (Comment 2)
func TestFirstPasswordSetupAndDefaultPasswordBypass(t *testing.T) {
	// 场景 1: 首次免密直通 (输入空密码)
	t.Run("DefaultPassword_EmptyPassword_Bypasses", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "password.json")
		a, err := New(path)
		if err != nil {
			t.Fatal(err)
		}
		h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
		call := func(r *http.Request) *httptest.ResponseRecorder {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			return w
		}

		// 默认密码状态下，严禁空密码登录，空密码必须报错 400
		w := call(localRequest("POST", "/auth/login", `{"password":""}`))
		if w.Code != 400 {
			t.Fatalf("expected 400 for empty password in default mode, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 场景 2: 首次输入自定义密码，直接设定并持久化为正式密码
	t.Run("DefaultPassword_FirstInput_SetsAndPersists", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "password.json")
		a, err := New(path)
		if err != nil {
			t.Fatal(err)
		}
		h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
		call := func(r *http.Request) *httptest.ResponseRecorder {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			return w
		}

		// 输入自定义新密码 (例如 "my-initial-pass")
		w := call(localRequest("POST", "/auth/login", `{"password":"my-initial-pass"}`))
		if w.Code != 200 {
			t.Fatalf("expected 200 for first input setting password, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			Authenticated   bool   `json:"authenticated"`
			CSRFToken       string `json:"csrf_token"`
			DefaultPassword bool   `json:"default_password"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if !resp.Authenticated || resp.DefaultPassword {
			t.Fatalf("expected default_password=false after custom password setup, got: %+v", resp)
		}

		// 验证 password.json 文件落盘，default_password 为 false
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var rec passwordRecord
		if err := json.Unmarshal(data, &rec); err != nil {
			t.Fatal(err)
		}
		if rec.Default {
			t.Fatalf("expected disk record default_password=false, got true")
		}

		// 验证旧的默认密码 "123456" 无法登录
		w2 := call(localRequest("POST", "/auth/login", `{"password":"123456"}`))
		if w2.Code != 401 {
			t.Fatalf("expected 401 for old 123456 password, got %d", w2.Code)
		}

		// 验证新设定的密码能够正常登录
		w3 := call(localRequest("POST", "/auth/login", `{"password":"my-initial-pass"}`))
		if w3.Code != 200 {
			t.Fatalf("expected 200 for new custom password, got %d", w3.Code)
		}
	})

	// 场景 3: 默认密码模式下，直接调用 /auth/password 保存新密码
	t.Run("DefaultPassword_SaveEndpoint_WithoutLogin", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "password.json")
		a, err := New(path)
		if err != nil {
			t.Fatal(err)
		}
		h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
		call := func(r *http.Request) *httptest.ResponseRecorder {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			return w
		}

		// 未登录且未提供 old_password，直接调用 /auth/password
		w := call(localRequest("POST", "/auth/password", `{"new_password":"direct-save-pwd","confirm_password":"direct-save-pwd"}`))
		if w.Code != 200 {
			t.Fatalf("expected 200 for direct password save in default mode, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			OK              bool   `json:"ok"`
			Authenticated   bool   `json:"authenticated"`
			DefaultPassword bool   `json:"default_password"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if !resp.OK || !resp.Authenticated || resp.DefaultPassword {
			t.Fatalf("unexpected save response: %+v", resp)
		}

		// 验证新密码生效
		w2 := call(localRequest("POST", "/auth/login", `{"password":"direct-save-pwd"}`))
		if w2.Code != 200 {
			t.Fatalf("expected 200 for newly saved password, got %d", w2.Code)
		}
	})
}
