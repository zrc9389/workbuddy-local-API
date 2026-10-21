package panel

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestMetaUnavailableAndPayloadGuards(t *testing.T) {
	p := ioTestPanel(t)
	w := httptest.NewRecorder()
	p.MetaStatus(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"available":false`) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	p.MetaNodes(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}

func TestMetaSubscriptionsReadCacheAndFilterNodesAtPanelBoundary(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m

	w := httptest.NewRecorder()
	p.MetaSubscriptions(w, httptest.NewRequest(http.MethodGet, "/panel/api/meta/subscriptions", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"subscriptions"`) {
		t.Fatalf("subscription cache response: %d %s", w.Code, w.Body.String())
	}
	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("demo manager returned no nodes")
	}
	w = httptest.NewRecorder()
	p.MetaNodes(w, httptest.NewRequest(http.MethodGet, "/panel/api/meta/nodes?subscription_id=missing", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"total":0`) {
		t.Fatalf("filtered nodes response: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	p.MetaNodes(w, httptest.NewRequest(http.MethodGet, "/panel/api/meta/nodes?subscription_id="+nodes[0].Provider, nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"total":`) {
		t.Fatalf("provider nodes response: %d %s", w.Code, w.Body.String())
	}
}
func TestMetaDemoAdapterDoesNotOverwriteAccountProxy(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m
	a := &auth.Auth{UID: "fixture", ProxyURL: "http://127.0.0.1:18765", FilePath: filepath.Join(t.TempDir(), "fixture.json")}
	p.cfg.Pool.Add(a)
	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("no demo nodes")
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"node":"`+nodes[0].ID+`"}`))
	r.SetPathValue("uid", a.UID)
	p.MetaBind(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"demo":true`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if a.ProxyURLValue() != "http://127.0.0.1:18765" {
		t.Fatal("demo changed actual proxy")
	}
	if len(m.Nodes().Bindings) != 1 {
		t.Fatal("demo binding not updated")
	}
	w = httptest.NewRecorder()
	p.MetaSubscriptions(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"url":"https://example.com/token-private"}`)))
	if w.Code != 400 || strings.Contains(w.Body.String(), "token-private") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	p.MetaAsset(w, httptest.NewRequest("GET", "/", nil))
	if !strings.Contains(w.Body.String(), "computeLatencyTrend") || !strings.Contains(w.Body.String(), "8bbc8f58") {
		t.Fatal("missing real vendored helper")
	}
}

func TestMetaBindUnavailableNeverClearsProxy(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Binary: filepath.Join(t.TempDir(), "missing.exe")})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m
	a := &auth.Auth{UID: "fixture", ProxyURL: "http://127.0.0.1:18765", FilePath: filepath.Join(t.TempDir(), "fixture.json")}
	p.cfg.Pool.Add(a)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"node":"unknown"}`))
	r.SetPathValue("uid", a.UID)
	p.MetaBind(w, r)
	if w.Code != 503 || a.ProxyURLValue() != "http://127.0.0.1:18765" {
		t.Fatal("unavailable core changed proxy", w.Code, w.Body.String())
	}
}

func TestMetaSubscriptionActionBoundary(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m
	list := httptest.NewRecorder()
	p.MetaSubscriptions(list, httptest.NewRequest(http.MethodGet, "/panel/api/meta/subscriptions", nil))
	if list.Code != 200 || !strings.Contains(list.Body.String(), `"subscriptions"`) {
		t.Fatalf("list leaked URL: %d %s", list.Code, list.Body.String())
	}
	for _, body := range []string{
		`{}`,
		`{"action":"toggle","id":"demo"}`,
		`{"action":"rename","id":"demo"}`,
		`{"action":"refresh"}`,
		`{"action":"delete"}`,
		`{"action":"unknown","id":"demo"}`,
		`not-json`,
	} {
		w := httptest.NewRecorder()
		p.MetaSubscriptions(w, httptest.NewRequest(http.MethodPost, "/panel/api/meta/subscriptions", strings.NewReader(body)))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid body %q => %d %s", body, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	p.MetaSubscriptions(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"action":"refresh","id":"demo"}`)))
	if w.Code != http.StatusBadRequest || strings.Contains(w.Body.String(), "token") {
		t.Fatalf("demo refresh = %d %s", w.Code, w.Body.String())
	}
	reveal := httptest.NewRecorder()
	p.MetaSubscriptions(reveal, httptest.NewRequest(http.MethodGet, "/panel/api/meta/subscriptions?id=demo&reveal=1", nil))
	if reveal.Code != http.StatusBadRequest && reveal.Code != http.StatusNotFound {
		t.Fatalf("demo reveal = %d %s", reveal.Code, reveal.Body.String())
	}
}

func TestMetaSubscriptionIdentityBoundaries(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m
	for _, body := range []string{
		`{"action":"toggle","id":"  ","enabled":false}`,
		`{"action":"rename","id":"demo","name":"   "}`,
		`{"action":"delete","id":"demo/../x"}`,
	} {
		w := httptest.NewRecorder()
		p.MetaSubscriptions(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("identity boundary %q => %d %s", body, w.Code, w.Body.String())
		}
	}
	reveal := httptest.NewRecorder()
	p.MetaSubscriptions(reveal, httptest.NewRequest(http.MethodGet, "/panel/api/meta/subscriptions?id=missing", nil))
	if reveal.Code != http.StatusOK || strings.Contains(reveal.Body.String(), `"url"`) {
		t.Fatalf("unrevealed id must not return a url: %d %s", reveal.Code, reveal.Body.String())
	}
}
