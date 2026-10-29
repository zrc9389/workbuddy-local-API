package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsolatedMeasurement(t *testing.T) {
	scenario := os.Getenv("WB_MEASURE_SCENARIO")
	if scenario == "" {
		t.Skip("measurement only")
	}
	count := 1
	size := 8 << 20
	path := "/v1/chat/completions"
	if scenario == "three" {
		count = 3
	}
	if scenario == "four_one" {
		count = 4
	}
	if scenario == "image" {
		path = "/v1/responses"
	}
	body := string([]byte{123, 34}) + "model" + string([]byte{34, 58, 34}) + "glm-5.2" + string([]byte{34, 44, 34}) + "stream" + string([]byte{34, 58}) + "true," + string([]byte{34}) + "stream_options" + string([]byte{34, 58, 123, 34}) + "include_usage" + string([]byte{34, 58}) + "true}," + string([]byte{34}) + "messages" + string([]byte{34, 58, 91, 123, 34}) + "role" + string([]byte{34, 58, 34}) + "user" + string([]byte{34, 44, 34}) + "content" + string([]byte{34, 58, 34}) + strings.Repeat("Q", size) + string([]byte{34, 125, 93, 125})
	if scenario == "image" {
		body = string([]byte{123, 34}) + "model" + string([]byte{34, 58, 34}) + "glm-5.2" + string([]byte{34, 44, 34}) + "input" + string([]byte{34, 58, 91, 123, 34}) + "role" + string([]byte{34, 58, 34}) + "user" + string([]byte{34, 44, 34}) + "content" + string([]byte{34, 58, 91, 123, 34}) + "type" + string([]byte{34, 58, 34}) + "input_text" + string([]byte{34, 44, 34}) + "text" + string([]byte{34, 58, 34}) + strings.Repeat("Q", size) + string([]byte{34, 125, 44, 123, 34}) + "type" + string([]byte{34, 58, 34}) + "input_image" + string([]byte{34, 44, 34}) + "image_url" + string([]byte{34, 58, 34}) + "data:image/png;base64," + strings.Repeat("A", 1<<20) + string([]byte{34, 125, 93, 125, 93, 125})
	}
	p := testPoolWith(&auth.Auth{UID: "synthetic", AccessToken: "fixture", ExpiresAt: 9999999999})
	p.EnforceHardConcurrency()
	var hits atomic.Int64
	var checks sync.Map
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		h := sha256.New()
		n, err := io.Copy(h, r.Body)
		if err != nil {
			return nil, err
		}
		hits.Add(1)
		checks.Store(hex.EncodeToString(h.Sum(nil)), n)
		time.Sleep(500 * time.Millisecond)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fixture.invalid"}
	h := NewHandler(Config{Pool: p, Upstream: up, MaxConcurrent: 4, MaxWorkingBytes: 256 << 20, PromptMode: "passthrough"})
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	var peak atomic.Uint64
	peak.Store(before.HeapAlloc)
	var tempPeak atomic.Int64
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak.Load() {
				peak.Store(m.HeapAlloc)
			}
			var total int64
			filepath.WalkDir(os.TempDir(), func(_ string, d os.DirEntry, e error) error {
				if e == nil && !d.IsDir() {
					if info, e := d.Info(); e == nil {
						total += info.Size()
					}
				}
				return nil
			})
			if total > tempPeak.Load() {
				tempPeak.Store(total)
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()
	start := make(chan struct{})
	statuses := make([]int, count)
	replies := make([]string, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			req := httptest.NewRequest("POST", path, strings.NewReader(body))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			statuses[i] = rec.Code
			replies[i] = rec.Body.String()
		}(i)
	}
	close(start)
	wg.Wait()
	close(stop)
	<-done
	var remaining, history int64
	filepath.WalkDir(os.TempDir(), func(path string, d os.DirEntry, e error) error {
		if e == nil && !d.IsDir() {
			if info, e := d.Info(); e == nil {
				if strings.Contains(path, "wb_history_") {
					history += info.Size()
				} else {
					remaining += info.Size()
				}
			}
		}
		return nil
	})
	m := map[string]any{"scenario": scenario, "pid": os.Getpid(), "body_bytes": len(body), "concurrency": count, "heap_baseline": before.HeapAlloc, "heap_peak": peak.Load(), "temp_peak": tempPeak.Load(), "temp_after": remaining, "retained_history": history, "statuses": statuses, "upstream_hits": hits.Load(), "replies": replies}
	hashes := map[string]int64{}
	checks.Range(func(k, v any) bool { hashes[k.(string)] = v.(int64); return true })
	m["upstream_sha256_and_size"] = hashes
	if scenario != "image" {
		sum := sha256.Sum256([]byte(body))
		if hashes[hex.EncodeToString(sum[:])] != int64(len(body)) {
			t.Error("upstream body hash or size mismatch")
		}
	}
	b, _ := json.Marshal(m)
	fmt.Println("MEASUREMENT", string(b))
	if scenario == "four_one" {
		successes := 0
		failures := 0
		for i, s := range statuses {
			if s == 200 {
				successes++
			} else if s >= 400 && strings.Contains(replies[i], "error") {
				failures++
			}
		}
		if successes != 3 || failures != 1 || hits.Load() != 3 {
			t.Fatal("expected 3 dispatched and one explicit error")
		}
	} else {
		for _, s := range statuses {
			if s != 200 {
				t.Fatalf("status=%d", s)
			}
		}
		if hits.Load() != int64(count) {
			t.Fatal("missing dispatch")
		}
	}
	if remaining != 0 {
		t.Fatalf("temporary files remain: %d", remaining)
	}
}
