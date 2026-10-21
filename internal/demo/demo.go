// Package demo provides isolated, labeled fixtures. It never uses real credentials.
package demo

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"
)

func StartUpstream() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var data any = map[string]any{}
		switch {
		case strings.Contains(r.URL.Path, "chat/completions"):
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintln(w, `data: {"id":"demo","object":"chat.completion.chunk","model":"demo-model","choices":[{"index":0,"delta":{"content":"这是隔离演示响应，不是真实模型调用。"},"finish_reason":null}]}`)
			fmt.Fprintln(w)
			fmt.Fprintln(w, `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2048,"completion_tokens":32,"total_tokens":2080,"credit":0}}`)
			fmt.Fprintln(w)
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		case strings.Contains(r.URL.Path, "token/refresh"):
			data = map[string]any{"accessToken": "demo-access", "refreshToken": "demo-refresh", "expiresIn": 86400, "domain": "copilot.tencent.com"}
		case strings.Contains(r.URL.Path, "get-user-resource"):
			data = map[string]any{"Response": map[string]any{"Data": map[string]any{"Accounts": []any{map[string]any{"PackageName": "演示积分包", "CapacityRemain": 850, "CapacitySize": 2000, "CapacityUsed": 1150, "CycleEndTime": time.Now().Add(72 * time.Hour).Format("2006-01-02 15:04:05"), "DeductionEndTime": time.Now().Add(72 * time.Hour).UnixMilli()}}}}}
		case strings.Contains(r.URL.Path, "buddy/info"):
			data = map[string]any{"buddy": map[string]any{"id": 1, "name": "Demo Buddy"}}
		case strings.Contains(r.URL.Path, "travel/status"):
			data = map[string]any{"state": "idle", "daily_limit_reached": false}
		case strings.Contains(r.URL.Path, "/streak"):
			data = map[string]any{"streak": map[string]any{"days": 7}}
		case strings.Contains(r.URL.Path, "/models"), r.URL.Path == "/v3/config":
			models := []any{}
			for i, id := range []string{"demo-model", "demo-reasoning", "demo-vision"} {
				models = append(models, map[string]any{"id": id, "name": []string{"演示通用模型", "演示推理模型", "演示视觉模型"}[i], "descriptionZh": "隔离演示模型；非真实上游能力或1M验证", "vendor": "Demo", "credits": "x0.00", "maxInputTokens": 128000, "maxOutputTokens": 8192, "supportsToolCall": true, "supportsImages": i == 2, "supportsReasoning": i == 1, "reasoning": map[string]any{"defaultEffort": "medium", "supportedEfforts": []string{"low", "medium", "high"}}})
			}
			data = map[string]any{"models": models, "agents": []any{map[string]any{"name": "cli", "models": []string{"demo-model", "demo-reasoning", "demo-vision"}}}}

		}
		json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": data})
	}))
}
func Seed(p *pool.Pool, dir string) error {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	for i := 1; i <= 18; i++ {
		uid := fmt.Sprintf("demo_%02d", i)
		a := &auth.Auth{UID: uid, Nickname: fmt.Sprintf("演示账号 %02d", i), AccessToken: "demo-access", RefreshToken: "demo-refresh", ExpiresAt: time.Now().Add(24 * time.Hour).Unix(), Domain: "copilot.tencent.com", FilePath: fmt.Sprintf("%s/%s.json", dir, uid)}
		p.Add(a)
		p.SetCredits(uid, int64(300+i*43), 2000)
		if i%6 == 0 {
			p.SetManualDisabled(uid, true)
		} else if i%5 == 0 {
			p.Cooldown(uid, pool.CoolSoft, 20*time.Minute, "演示：模型限流冷却")
		} else if i%7 == 0 {
			p.SetCredits(uid, 42, 2000)
		}
	}
	return nil
}
func Configure(up *upstream.Client, url string) {
	up.ChatBaseCN = url
	up.BillingBaseCN = url
	up.WebBaseCN = url
	up.ChatBaseGlobal = url
	up.BillingBaseGlobal = url
}
func Feed(ctx context.Context, p *pool.Pool, u *usage.Recorder, logs telemetry.Sink) {
	tick := func(i int, when time.Time) {
		uid := fmt.Sprintf("demo_%02d", 1+i%18)
		if i >= 72 {
			eligible := p.AvailableUIDs()
			if len(eligible) == 0 {
				return
			}
			uid = eligible[i%len(eligible)]
		}
		ok := i%7 != 0
		in := int64(1500 + (i%11)*397)
		out := int64(120 + i%500)
		p.RecordTokenUsage(uid, pool.TokenUsageDelta{Model: "demo-model", HasPromptTokens: true, PromptTokens: in, HasCompletionTokens: true, CompletionTokens: out, HasTotalTokens: true, TotalTokens: in + out})
		if ok {
			p.NoteSuccess(uid)
		}
		u.Add(when, "cn", uid, "demo-model", usage.Delta{HasPromptTokens: true, PromptTokens: in, HasCompletion: true, CompletionTokens: out, HasTotal: true, TotalTokens: in + out, HasCredit: true, Credit: .2, HasLatency: true, LatencyMs: 800}, ok)
		status := 200
		outcome := telemetry.OutcomeSuccess
		if !ok {
			status = 429
			outcome = telemetry.OutcomeHTTPError
		}
		logs.Begin()
		logs.Record(telemetry.Event{Time: when, RequestID: fmt.Sprintf("DEMO-%d", i), Path: "/v1/chat/completions", Account: uid, Model: "demo-model", Status: status, OK: ok, Outcome: outcome, DurationMs: 800, PromptTokens: in, CompletionTokens: out, TotalTokens: in + out})
		log.Printf("[DEMO] request=%d account=%s status=%d tokens=%d", i, uid, status, in+out)
	}
	if u.Snapshot(0, nil).Totals.Requests == 0 {
		for i := 0; i < 72; i++ {
			tick(i, time.Now().Add(-time.Duration(72-i)*20*time.Minute))
		}
	}
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for i := 72; ; i++ {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			tick(i, now)
		}
	}
}
