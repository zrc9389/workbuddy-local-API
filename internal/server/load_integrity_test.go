package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSyntheticLargeContextAndPressureSpool(t *testing.T) {
	for _, size := range []int{1 << 20, 4 << 20, 8 << 20} {
		for _, conc := range []int{1, 2, 4, 6, 8} {
			t.Run(fmt.Sprintf("bytes%d_concurrency%d", size, conc), func(t *testing.T) {
				text := strings.Repeat("a", size-25) + "TAIL_INTEGRITY_MARKER"
				sum := sha256.Sum256([]byte(text))
				var hits atomic.Int64
				up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
					var v struct {
						Messages []struct {
							Role    string `json:"role"`
							Content any    `json:"content"`
						} `json:"messages"`
					}
					if e := json.NewDecoder(r.Body).Decode(&v); e != nil {
						return nil, e
					}
					found := false
					for _, m := range v.Messages {
						if m.Role == "user" {
							b, ok := m.Content.(string)
							if !ok || sha256.Sum256([]byte(b)) != sum {
								return nil, fmt.Errorf("context integrity failed")
							}
							found = true
						}
					}
					if !found {
						return nil, fmt.Errorf("missing user content")
					}
					hits.Add(1)
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
				})}, ChatBaseCN: "http://fixture.invalid"}
				p := testPoolWith(&auth.Auth{UID: "load-fixture", AccessToken: "fixture", ExpiresAt: 9999999999})
				p.SetMaxInFlight(8)
				q, _ := spool.Open(spool.Options{Dir: filepath.Join(t.TempDir(), "spool"), MaxBytes: 128 << 20, MaxJobs: 8})
				var pressure atomic.Bool
				pressure.Store(true)
				h := NewHandler(Config{StrictContext: true, Pool: p, Upstream: up, MaxBodyBytes: 16 << 20, MaxConcurrent: 4, Spool: q, Pressure: pressure.Load})
				raw, _ := json.Marshal(map[string]any{"model": "fixture-model", "messages": []any{map[string]any{"role": "user", "content": text}}})
				started := time.Now()
				var peak atomic.Uint64
				var rssPeak atomic.Uint64
				var spoolPeak atomic.Int64
				sampleDone := make(chan struct{})
				sampleStop := make(chan struct{})
				go func() {
					defer close(sampleDone)
					ticker := time.NewTicker(5 * time.Millisecond)
					defer ticker.Stop()
					for {
						var m runtime.MemStats
						runtime.ReadMemStats(&m)
						for {
							old := peak.Load()
							if m.HeapAlloc <= old || peak.CompareAndSwap(old, m.HeapAlloc) {
								break
							}
						}
						if rss := currentRSSBytes(); rss > 0 {
							for {
								old := rssPeak.Load()
								if rss <= old || rssPeak.CompareAndSwap(old, rss) {
									break
								}
							}
						}
						if jobs := int64(q.Stats().Jobs); jobs > spoolPeak.Load() {
							spoolPeak.Store(jobs)
						}
						select {
						case <-sampleStop:
							return
						case <-ticker.C:
						}
					}
				}()
				var wg sync.WaitGroup
				errs := make(chan string, conc)
				for i := 0; i < conc; i++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(raw)))
						r = r.WithContext(context.Background())
						w := httptest.NewRecorder()
						h.ServeHTTP(w, r)
						if w.Code != 200 {
							errs <- fmt.Sprintf("%d %s", w.Code, w.Body.String())
						}
					}()
				}
				time.Sleep(100 * time.Millisecond)
				pressure.Store(false)
				wg.Wait()
				close(sampleStop)
				<-sampleDone
				close(errs)
				for e := range errs {
					t.Error(e)
				}
				if hits.Load() != int64(conc) {
					t.Fatal("missing calls", hits.Load())
				}
				var mem runtime.MemStats
				runtime.ReadMemStats(&mem)
				t.Logf("synthetic_bytes=%d concurrency=%d duration=%s heap_after=%d sys=%d sampled_heap_peak=%d sampled_rss_peak=%d spool_jobs_peak=%d spool_jobs_final=%d spool_bytes_final=%d sha256=%s no_real_tokens_claimed=true", len(raw), conc, time.Since(started), mem.HeapAlloc, mem.Sys, peak.Load(), rssPeak.Load(), spoolPeak.Load(), q.Stats().Jobs, q.Stats().Bytes, hex.EncodeToString(sum[:]))
				if q.Stats().Unknown != 0 || q.Stats().Jobs != 0 {
					t.Fatal("successful spools left unresolved", q.Stats())
				}
			})
		}
	}
}
