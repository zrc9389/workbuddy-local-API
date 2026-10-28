package server

import (
	"net/http/httptest"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestSecurityHeadersOnGatewayAPIResponses(t *testing.T) {
	p := pool.New("")
	h := NewHandler(Config{
		Pool: p,
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/healthz", nil)
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("expected X-Content-Type-Options: nosniff, got: %s", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected Cache-Control: no-store on API response, got: %s", got)
	}
}

func TestSecurityHeadersOnSSEPreservesStreamCachePolicy(t *testing.T) {
	p := pool.New("")
	h := NewHandler(Config{
		Pool: p,
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/status", nil)
	req.Header.Set("Accept", "text/event-stream")
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("expected X-Content-Type-Options: nosniff, got: %s", got)
	}
	if got := rec.Header().Get("Cache-Control"); got == "no-store" {
		t.Fatalf("did not expect Cache-Control: no-store on SSE request")
	}
}
