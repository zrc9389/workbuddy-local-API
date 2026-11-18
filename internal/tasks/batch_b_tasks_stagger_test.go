package tasks

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestBatchBTasksScanAccountStagger(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"tasks":[]}}`))
	}))
	defer ts.Close()

	p := pool.New("")
	p.Add(&auth.Auth{UID: "t-u1", AccessToken: "a1"})
	p.Add(&auth.Auth{UID: "t-u2", AccessToken: "a2"})
	p.Add(&auth.Auth{UID: "t-u3", AccessToken: "a3"})

	up := &upstream.Client{HTTP: ts.Client(), ChatBaseCN: ts.URL, BillingBaseCN: ts.URL}
	svc := New(Config{
		Pool:              p,
		Upstream:          up,
		AccountStaggerMin: 25 * time.Millisecond,
		AccountStaggerMax: 40 * time.Millisecond,
	})

	start := time.Now()
	res, err := svc.Scan(context.Background())
	elapsed := time.Since(start)
	if err != nil || !res.OK {
		t.Fatalf("Scan failed: res=%+v err=%v", res, err)
	}
	// 3 accounts -> 2 inter-account gaps of >= 25ms each = >= 50ms
	if elapsed < 45*time.Millisecond {
		t.Fatalf("expected Scan account stagger >= 45ms, got %v", elapsed)
	}
}
