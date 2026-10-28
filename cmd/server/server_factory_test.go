package main

import (
	"net/http"
	"testing"
	"time"
)

func TestNewHardenedServerDefaults(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	srv := NewHardenedServer(":8080", handler, 60*time.Second)

	if srv.Addr != ":8080" {
		t.Fatalf("expected Addr :8080, got %s", srv.Addr)
	}
	if srv.ReadHeaderTimeout != 15*time.Second {
		t.Fatalf("expected ReadHeaderTimeout 15s, got %v", srv.ReadHeaderTimeout)
	}
	if srv.IdleTimeout != 120*time.Second {
		t.Fatalf("expected IdleTimeout 120s, got %v", srv.IdleTimeout)
	}
	if srv.MaxHeaderBytes != 1<<20 {
		t.Fatalf("expected MaxHeaderBytes 1MB, got %d", srv.MaxHeaderBytes)
	}
	if srv.ReadTimeout != 60*time.Second {
		t.Fatalf("expected ReadTimeout 60s, got %v", srv.ReadTimeout)
	}
}

func TestNewHardenedServerClampsHeaderTimeoutToReadTimeout(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	srv := NewHardenedServer(":8080", handler, 5*time.Second)

	if srv.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("expected ReadHeaderTimeout clamped to 5s, got %v", srv.ReadHeaderTimeout)
	}
}
