package server

import (
	"github.com/linguo2625469/workbuddy2api-panel/internal/modelpolicy"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalResourceAndModelBoundaries(t *testing.T) {
	m, _ := modelpolicy.Open("")
	m.Set("blocked", modelpolicy.Rule{Disabled: true})
	h := NewHandler(Config{Pool: pool.New(""), ModelPolicy: m, MaxBodyBytes: 100, MaxConcurrent: 1, RequestLog: telemetry.Noop{}})
	for _, v := range []struct {
		body   string
		status int
	}{{strings.Repeat("x", 101), 413}, {`{"model":"blocked"}`, 403}} {
		r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(v.body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != v.status {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	h.slots <- struct{}{}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/responses", strings.NewReader(`{}`)))
	if w.Code != 429 {
		t.Fatal(w.Code)
	}
}
