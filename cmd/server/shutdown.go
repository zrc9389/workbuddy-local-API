package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

// serveHTTP joins graceful shutdown before callers flush shared runtime state.
func serveHTTP(ctx context.Context, srv *http.Server, ln net.Listener, grace time.Duration) error {
	finished := make(chan struct{})
	stop := make(chan struct{})
	go func() {
		defer close(finished)
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), grace)
			defer cancel()
			if err := srv.Shutdown(shutdownCtx); err != nil {
				_ = srv.Close()
			}
		case <-stop:
		}
	}()
	err := srv.Serve(ln)
	close(stop)
	<-finished
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
