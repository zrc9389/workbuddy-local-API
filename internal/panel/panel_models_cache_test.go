package panel

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

const panelModelsTestPayload = `{"code":0,"data":{"models":[{"id":"glm-5.2","name":"GLM","maxInputTokens":131072,"maxOutputTokens":8192,"disabled":false}],"agents":[{"name":"cli","models":["glm-5.2"]}]}}`

// newModelsCacheTestPanel 构造只含一个 CN 账号的面板，上游全部指向本地桩。
// 上游桩统计每次模型目录探测的请求数（FetchModels 会并发打两路）。
func newModelsCacheTestPanel(t *testing.T, handler http.HandlerFunc) *Panel {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	accounts := pool.New("")
	accounts.Add(&auth.Auth{
		UID:          "models-cache-cn",
		Nickname:     "models-cache-cn",
		AccessToken:  "at",
		RefreshToken: "rt",
		ExpiresAt:    9999999999,
	})
	up := &upstream.Client{
		HTTP:          srv.Client(),
		ChatBaseCN:    srv.URL,
		BillingBaseCN: srv.URL,
		WebBaseCN:     srv.URL,
		GlobalEnabled: true,
	}
	return New(Config{Pool: accounts, Upstream: up})
}

// modelsTestUpstream 统计所有模型目录端点请求；ok=false 时两路都返回 500。
func modelsTestUpstream(hits *atomic.Int32, ok bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/v3/config"),
			strings.HasSuffix(r.URL.Path, "/console/enterprises/personal/models"):
			hits.Add(1)
			if !ok {
				http.Error(w, "upstream down", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(panelModelsTestPayload))
		default:
			http.NotFound(w, r)
		}
	}
}

// modelsTestUpstreamToggle 同 modelsTestUpstream，但可用原子开关在用例中途切换成败。
func modelsTestUpstreamToggle(hits *atomic.Int32, ok *atomic.Bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/v3/config"),
			strings.HasSuffix(r.URL.Path, "/console/enterprises/personal/models"):
			hits.Add(1)
			if !ok.Load() {
				http.Error(w, "upstream down", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(panelModelsTestPayload))
		default:
			http.NotFound(w, r)
		}
	}
}

type panelModelsResponse struct {
	OK              bool             `json:"ok"`
	Models          []map[string]any `json:"models"`
	Cached          bool             `json:"cached"`
	CacheAgeSeconds int              `json:"cache_age_seconds"`
	CooldownSeconds int              `json:"cooldown_seconds"`
	Stale           bool             `json:"stale"`
	Error           string           `json:"error"`
}

func doModelsRequest(t *testing.T, p *Panel, method, path string) (*httptest.ResponseRecorder, panelModelsResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	var body panelModelsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("%s %s: decode body: %v (raw=%s)", method, path, err, rec.Body.String())
	}
	return rec, body
}

// a. 连续两次 GET 只触发 1 次上游拉取，第二次返回 cached:true。
func TestPanelModelsCacheServesSecondRequestFromCache(t *testing.T) {
	hits := new(atomic.Int32)
	p := newModelsCacheTestPanel(t, modelsTestUpstream(hits, true))

	rec, first := doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusOK || !first.OK || len(first.Models) == 0 {
		t.Fatalf("first GET: status=%d ok=%v models=%d body=%s", rec.Code, first.OK, len(first.Models), rec.Body.String())
	}
	if first.Cached {
		t.Fatalf("first GET cached=true, want false")
	}
	afterFirst := hits.Load()
	if afterFirst == 0 {
		t.Fatal("first GET did not reach upstream")
	}

	rec, second := doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusOK || !second.OK || len(second.Models) != len(first.Models) {
		t.Fatalf("second GET: status=%d ok=%v models=%d body=%s", rec.Code, second.OK, len(second.Models), rec.Body.String())
	}
	if !second.Cached {
		t.Fatalf("second GET cached=false, want true")
	}
	if second.CacheAgeSeconds < 0 {
		t.Fatalf("cache_age_seconds=%d, want >=0", second.CacheAgeSeconds)
	}
	if got := hits.Load(); got != afterFirst {
		t.Fatalf("upstream hits after second GET=%d, want unchanged %d", got, afterFirst)
	}
}

// b. 上游失败进入 60 秒负缓存：第二次 GET 仍失败但不再打上游。
func TestPanelModelsFailureUsesNegativeCache(t *testing.T) {
	hits := new(atomic.Int32)
	p := newModelsCacheTestPanel(t, modelsTestUpstream(hits, false))

	rec, _ := doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("first failed GET status=%d, want 502 (body=%s)", rec.Code, rec.Body.String())
	}
	afterFirst := hits.Load()
	if afterFirst == 0 {
		t.Fatal("first failed GET did not reach upstream")
	}

	rec, body := doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("second failed GET status=%d, want 502 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(body.Error, "fetch models") {
		t.Fatalf("second failed GET error=%q, want fetch models", body.Error)
	}
	if got := hits.Load(); got != afterFirst {
		t.Fatalf("upstream hits inside negative cache=%d, want unchanged %d", got, afterFirst)
	}

	// 负缓存过期（60s）后应重新允许探测：把 lastFail 拨到窗口外，上游恢复即可成功。
	p.modelsMu.Lock()
	p.modelsCache["cn"].lastFail = time.Now().Add(-panelModelsFailCooldown - time.Second)
	p.modelsMu.Unlock()
	rec, _ = doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("post-cooldown failed GET status=%d, want 502", rec.Code)
	}
	if got := hits.Load(); got <= afterFirst {
		t.Fatalf("upstream hits after negative cooldown=%d, want > %d", got, afterFirst)
	}
}

// 刷新失败保留旧列表并标 stale，不清空模型。
func TestPanelModelsStaleKeepsOldListOnFailure(t *testing.T) {
	hits := new(atomic.Int32)
	ok := new(atomic.Bool)
	ok.Store(true)
	p := newModelsCacheTestPanel(t, modelsTestUpstreamToggle(hits, ok))

	rec, first := doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusOK || len(first.Models) == 0 {
		t.Fatalf("warm-up GET: status=%d models=%d body=%s", rec.Code, len(first.Models), rec.Body.String())
	}

	// 让成功快照过期，再让上游失败：应继续返回旧列表并标 stale/cached。
	p.modelsMu.Lock()
	p.modelsCache["cn"].fetched = time.Now().Add(-panelModelsTTL - time.Second)
	p.modelsMu.Unlock()
	ok.Store(false)

	rec, stale := doModelsRequest(t, p, http.MethodGet, "/panel/api/models")
	if rec.Code != http.StatusOK || !stale.OK || len(stale.Models) != len(first.Models) {
		t.Fatalf("stale GET: status=%d ok=%v models=%d body=%s", rec.Code, stale.OK, len(stale.Models), rec.Body.String())
	}
	if !stale.Cached || !stale.Stale {
		t.Fatalf("stale GET cached=%v stale=%v, want true/true", stale.Cached, stale.Stale)
	}
}

// c/d. 手动刷新：首次允许并打上游；冷却内 ok:false 且不打上游；冷却外再次允许。
func TestPanelModelsManualRefreshCooldown(t *testing.T) {
	hits := new(atomic.Int32)
	p := newModelsCacheTestPanel(t, modelsTestUpstream(hits, true))

	rec, first := doModelsRequest(t, p, http.MethodPost, "/panel/api/models/refresh")
	if rec.Code != http.StatusOK || !first.OK || len(first.Models) == 0 {
		t.Fatalf("first refresh: status=%d ok=%v models=%d body=%s", rec.Code, first.OK, len(first.Models), rec.Body.String())
	}
	afterFirst := hits.Load()
	if afterFirst == 0 {
		t.Fatal("first refresh did not reach upstream")
	}

	rec, second := doModelsRequest(t, p, http.MethodPost, "/panel/api/models/refresh")
	if rec.Code != http.StatusOK || second.OK {
		t.Fatalf("cooldown refresh: status=%d ok=%v body=%s, want 200 ok=false", rec.Code, second.OK, rec.Body.String())
	}
	if second.CooldownSeconds <= 0 || second.CooldownSeconds > int(panelModelsRefreshCool/time.Second) {
		t.Fatalf("cooldown_seconds=%d, want 1..%d", second.CooldownSeconds, int(panelModelsRefreshCool/time.Second))
	}
	if got := hits.Load(); got != afterFirst {
		t.Fatalf("upstream hits inside refresh cooldown=%d, want unchanged %d", got, afterFirst)
	}

	p.modelsMu.Lock()
	p.modelsRefreshedAt = time.Now().Add(-panelModelsRefreshCool - time.Second)
	p.modelsMu.Unlock()
	rec, third := doModelsRequest(t, p, http.MethodPost, "/panel/api/models/refresh")
	if rec.Code != http.StatusOK || !third.OK {
		t.Fatalf("refresh after cooldown: status=%d ok=%v body=%s", rec.Code, third.OK, rec.Body.String())
	}
	if got := hits.Load(); got <= afterFirst {
		t.Fatalf("upstream hits after cooldown=%d, want > %d", got, afterFirst)
	}
}
