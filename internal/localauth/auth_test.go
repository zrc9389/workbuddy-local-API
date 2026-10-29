package localauth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func localRequest(method, path, body string) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:7863"+path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:50000"
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}
func TestListenOnlyLoopback(t *testing.T) {
	for _, s := range []string{":7863", "0.0.0.0:7863", "[::]:7863", "192.168.1.1:7863", "localhost:7863"} {
		if ValidateListen(s) == nil {
			t.Errorf("accepted %s", s)
		}
	}
	for _, s := range []string{"127.0.0.1:7863", "[::1]:7863"} {
		if err := ValidateListen(s); err != nil {
			t.Fatal(err)
		}
	}
}
func TestLocalPasswordLifecycle(t *testing.T) {
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
	if w := call(localRequest("POST", "/v1/chat/completions", `{}`)); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	r := localRequest("GET", "/panel/api/overview", "")
	r.Header.Set("Authorization", "Bearer 123456")
	if w := call(r); w.Code != 401 {
		t.Fatal("key granted admin", w.Code)
	}
	// 严禁空密码登录：空密码必须报错 400
	r = localRequest("POST", "/auth/login", `{"password":""}`)
	if w := call(r); w.Code != 400 {
		t.Fatalf("expected 400 for empty password, got %d", w.Code)
	}
	// 首次输入任意非空密码并持久化。
	w := call(localRequest("POST", "/auth/login", `{"password":"initial-pass"}`))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	// 设定后再次使用错误密码登录必须被拒绝 401
	r = localRequest("POST", "/auth/login", `{"password":"wrong"}`)
	if w := call(r); w.Code != 401 {
		t.Fatalf("expected 401 for wrong password after initial setup, got %d", w.Code)
	}
	cookie := w.Result().Cookies()[0]
	if cookie.MaxAge != int(sessionLifetime.Seconds()) {
		t.Fatalf("cookie MaxAge=%d want %d", cookie.MaxAge, int(sessionLifetime.Seconds()))
	}
	a.mu.Lock()
	var sessionExpires time.Time
	for _, current := range a.sessions {
		sessionExpires = current.Expires
	}
	a.mu.Unlock()
	if remaining := time.Until(sessionExpires); remaining < 23*time.Hour || remaining > 24*time.Hour {
		t.Fatalf("server session lifetime=%s, want about 24h", remaining)
	}
	var s struct {
		CSRF string `json:"csrf_token"`
	}
	json.Unmarshal(w.Body.Bytes(), &s)
	if s.CSRF == "" {
		t.Fatal("missing csrf")
	}
	r = localRequest("GET", "/panel/api/overview", "")
	r.AddCookie(cookie)
	if w = call(r); w.Code != 204 {
		t.Fatal(w.Code)
	}
	r = localRequest("POST", "/panel/api/config", `{}`)
	r.AddCookie(cookie)
	if w = call(r); w.Code != 403 {
		t.Fatal("missing CSRF allowed", w.Code)
	}
	r = localRequest("POST", "/auth/password", `{"old_password":"initial-pass","new_password":"test-password-2","confirm_password":"test-password-2"}`)
	r.AddCookie(cookie)
	r.Header.Set("X-CSRF-Token", s.CSRF)
	if w = call(r); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	r = localRequest("GET", "/panel/api/overview", "")
	r.AddCookie(cookie)
	if w = call(r); w.Code != 401 {
		t.Fatal("old session survived")
	}
	b, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	b.Wrap(http.NotFoundHandler()).ServeHTTP(rr, localRequest("POST", "/auth/login", `{"password":"test-password-2"}`))
	if rr.Code != 200 {
		t.Fatal("password not persistent", rr.Body.String())
	}
}

func TestUnconfiguredLoginRejectsOverlongPassword(t *testing.T) {
	a, err := New(filepath.Join(t.TempDir(), "password.json"))
	if err != nil {
		t.Fatal(err)
	}
	h := a.Wrap(http.NotFoundHandler())
	w := httptest.NewRecorder()
	h.ServeHTTP(w, localRequest("POST", "/auth/login", `{"password":"`+strings.Repeat("x", 1025)+`"}`))
	if w.Code != http.StatusBadRequest || len(w.Result().Cookies()) != 0 {
		t.Fatalf("status %d", w.Code)
	}
}
func TestBoundaryRejectsRemoteAndBrowserCSRF(t *testing.T) {
	a, _ := New(filepath.Join(t.TempDir(), "pass.json"))
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, kind := range []string{"remote", "host", "origin", "fetch", "form"} {
		r := localRequest("POST", "/v1/chat/completions", `{}`)
		switch kind {
		case "remote":
			r.RemoteAddr = "192.168.1.10:1234"
		case "host":
			r.Host = "evil.example:7863"
		case "origin":
			r.Header.Set("Origin", "https://evil.example")
		case "fetch":
			r.Header.Set("Sec-Fetch-Site", "cross-site")
		case "form":
			r.Header.Set("Content-Type", "text/plain")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code < 400 {
			t.Errorf("allowed %s", kind)
		}
	}
}

type blockingBody struct {
	entered chan struct{}
	release chan struct{}
}

func (b *blockingBody) Read([]byte) (int, error) { close(b.entered); <-b.release; return 0, io.EOF }
func (b *blockingBody) Close() error             { return nil }
func TestSlowLoginDoesNotLockOtherSessions(t *testing.T) {
	a, _ := New(filepath.Join(t.TempDir(), "p.json"))
	h := a.Wrap(http.NotFoundHandler())
	b := &blockingBody{make(chan struct{}), make(chan struct{})}
	r := localRequest("POST", "/auth/login", `{}`)
	r.Body = b
	done := make(chan struct{})
	go func() { defer close(done); h.ServeHTTP(httptest.NewRecorder(), r) }()
	<-b.entered
	defer func() { close(b.release); <-done }()
	done2 := make(chan struct{})
	go func() {
		defer close(done2)
		h.ServeHTTP(httptest.NewRecorder(), localRequest("GET", "/auth/session", ""))
	}()
	select {
	case <-done2:
	case <-time.After(150 * time.Millisecond):
		t.Error("slow body holds auth lock")
	}
}

func TestRejectedLiveUploadsReturnStatusInsteadOfReset(t *testing.T) {
	a, _ := New(filepath.Join(t.TempDir(), "p.json"))
	srv := httptest.NewServer(a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("denied request reached business handler") })))
	defer srv.Close()
	for i := 0; i < 100; i++ {
		r, _ := http.NewRequest("POST", srv.URL+"/v1/chat/completions", strings.NewReader(`{"model":"fixture","messages":[]}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "https://evil.example")
		r.Close = true
		resp, e := srv.Client().Do(r)
		if e != nil {
			t.Fatal(i, e)
		}
		b, e := io.ReadAll(resp.Body)
		resp.Body.Close()
		if e != nil || resp.StatusCode != 403 || !strings.Contains(string(b), "cross-origin") {
			t.Fatal(i, resp.StatusCode, string(b), e)
		}
	}
}
