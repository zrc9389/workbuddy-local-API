package localauth

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestMusicUploadRequiresAuthAndAllowsLargeBody(t *testing.T) {
	a, e := New(filepath.Join(t.TempDir(), "password.json"))
	if e != nil {
		t.Fatal(e)
	}
	h := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n, e := io.Copy(io.Discard, r.Body)
		if e != nil || n != 20<<20 {
			t.Errorf("body %d: %v", n, e)
			w.WriteHeader(500)
			return
		}
		w.WriteHeader(204)
	}))
	login := httptest.NewRecorder()
	h.ServeHTTP(login, localRequest("POST", "/auth/login", `{"password":"fixture-password"}`))
	if login.Code != 200 {
		t.Fatal(login.Code)
	}
	var s struct {
		CSRF string `json:"csrf_token"`
	}
	if e = json.Unmarshal(login.Body.Bytes(), &s); e != nil {
		t.Fatal(e)
	}
	mk := func() *http.Request {
		r := localRequest("POST", "/panel/api/music/upload", "")
		r.Body = io.NopCloser(bytes.NewReader(make([]byte, 20<<20)))
		r.Header.Set("Content-Type", "audio/mpeg")
		return r
	}
	r := mk()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("unauthenticated=%d", w.Code)
	}
	r = mk()
	r.AddCookie(login.Result().Cookies()[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("missing csrf=%d", w.Code)
	}
	r = mk()
	r.AddCookie(login.Result().Cookies()[0])
	r.Header.Set("X-CSRF-Token", s.CSRF)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Fatalf("authenticated=%d", w.Code)
	}
}
