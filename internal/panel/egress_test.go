package panel

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

type egressRoundTrip func(*http.Request) (*http.Response, error)

func (f egressRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestAccountProxyAndReadOnlyMatrix(t *testing.T) {
	p := ioTestPanel(t)
	a := &auth.Auth{UID: "safe", AccessToken: "fake", FilePath: filepath.Join(p.cfg.AuthDir, "workbuddy-safe.json")}
	p.cfg.Pool.Add(a)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"proxy":"http://user:password@localhost:8080"}`))
	r.SetPathValue("uid", a.UID)
	p.AccountSetProxy(w, r)
	if w.Code != 200 || a.ProxyURLValue() == "" {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "password") {
		t.Fatal("secret echoed")
	}
	w = httptest.NewRecorder()
	p.EgressMatrix(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || strings.Contains(w.Body.String(), "password") || !strings.Contains(w.Body.String(), "not_probed") {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, body := range []string{`{}`, `{"proxy":null}`, `{"proxy":"ftp://host"}`, `{"proxy":""} {}`} {
		w = httptest.NewRecorder()
		r = httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.SetPathValue("uid", a.UID)
		p.AccountSetProxy(w, r)
		if w.Code != 400 {
			t.Fatal("invalid proxy payload", w.Code)
		}
	}
}
func TestAccountEgressMocked(t *testing.T) {
	p := ioTestPanel(t)
	a := &auth.Auth{UID: "safe", AccessToken: "never-send"}
	p.cfg.Pool.Add(a)
	c := upstream.New()
	c.HTTP.Transport = egressRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "" {
			t.Fatal("credential leaked")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ip":"203.0.113.9"}`))}, nil
	})
	p.cfg.Upstream = c
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", nil)
	r.SetPathValue("uid", a.UID)
	p.AccountEgress(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "203.0.113.9") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r = httptest.NewRequest("POST", "/", nil)
	r.SetPathValue("uid", "missing")
	p.AccountEgress(w, r)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func TestAccountProxyMutationBlockedWhileMetaBound(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m
	a := &auth.Auth{UID: "bound", FilePath: filepath.Join(p.cfg.AuthDir, "bound.json")}
	p.cfg.Pool.Add(a)
	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("demo nodes missing")
	}
	if _, err := m.Bind(context.Background(), a.UID, nodes[0].ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"proxy":"http://localhost:8080"}`))
	r.SetPathValue("uid", a.UID)
	p.AccountSetProxy(w, r)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
