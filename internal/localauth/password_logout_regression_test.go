package localauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestPasswordConfirmationAndLogout(t *testing.T) {
	a, err := New(filepath.Join(t.TempDir(), "password.json"))
	if err != nil {
		t.Fatal(err)
	}
	h := a.Wrap(http.NotFoundHandler())
	call := func(path, body string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
		r := localRequest("POST", path, body)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		if csrf != "" {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	login := call("/auth/login", `{"password":"old"}`, nil, "")
	var data struct {
		CSRF string `json:"csrf_token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &data); err != nil || login.Code != 200 {
		t.Fatalf("login %d %v", login.Code, err)
	}
	cookie := login.Result().Cookies()[0]
	for _, body := range []string{`{"old_password":"old","new_password":"x","confirm_password":"y"}`, `{"old_password":"old","new_password":"","confirm_password":""}`} {
		if w := call("/auth/password", body, cookie, data.CSRF); w.Code != 400 {
			t.Fatalf("expected rejection: %d", w.Code)
		}
	}
	if w := call("/auth/password", `{"old_password":"old","new_password":"x","confirm_password":"x"}`, cookie, data.CSRF); w.Code != 200 {
		t.Fatalf("short password: %d %s", w.Code, w.Body.String())
	}
	if w := call("/auth/login", `{"password":"x"}`, nil, ""); w.Code != 200 {
		t.Fatalf("short login: %d", w.Code)
	} else {
		var fresh struct {
			CSRF string `json:"csrf_token"`
		}
		json.Unmarshal(w.Body.Bytes(), &fresh)
		c := w.Result().Cookies()[0]
		if out := call("/auth/logout", "{}", c, fresh.CSRF); out.Code != 200 {
			t.Fatalf("logout: %d", out.Code)
		}
		req := localRequest("GET", "/auth/session", "")
		req.AddCookie(c)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if !strings.Contains(rec.Body.String(), `"authenticated":false`) {
			t.Fatalf("session survived: %s", rec.Body.String())
		}
	}
}
