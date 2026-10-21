package main

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestServeWaitsForActiveRequestOnShutdown(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(204)
		close(finished)
	})}
	ln, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serveHTTP(ctx, srv, ln, time.Second) }()
	reqDone := make(chan struct{})
	go func() {
		defer close(reqDone)
		r, e := http.Get("http://" + ln.Addr().String())
		if e == nil {
			r.Body.Close()
		}
	}()
	<-entered
	cancel()
	select {
	case e := <-done:
		close(release)
		t.Fatalf("server returned before draining: %v", e)
	case <-time.After(80 * time.Millisecond):
	}
	close(release)
	<-finished
	<-reqDone
	if e = <-done; e != nil {
		t.Fatal(e)
	}
}
