package upstream

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestEveryAccountOperationUsesConfiguredProxy(t *testing.T) {
	var direct, proxied atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { direct.Add(1); w.WriteHeader(400) }))
	defer target.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		w.Write([]byte(`{"code":11101,"msg":"mock rejection"}`))
	}))
	defer proxy.Close()
	c := New()
	c.ChatBaseCN = target.URL
	c.BillingBaseCN = target.URL
	c.WebBaseCN = target.URL
	a := &auth.Auth{UID: "proxy-chain", AccessToken: "fixture", RefreshToken: "fixture", ExpiresAt: 9999999999, ProxyURL: proxy.URL}
	for name, op := range map[string]func(){"refresh": func() { c.RefreshToken(a) }, "balance": func() { c.UserResource(a) }, "checkin": func() { c.DailyCheckin(a) }, "tasks": func() { c.ListTasks(a) }, "travel": func() { c.TravelStatus(a) }, "activity": func() { c.ReportChatActivity(a, "c", "r") }, "catalog": func() { c.FetchModels(a) }, "chat": func() {
		r, _, _, _ := c.ChatStreamContext(context.Background(), a, []byte(`{"model":"glm-test","messages":[]}`), "", ChatMeta{})
		if r != nil {
			r.Close()
		}
	}} {
		t.Run(name, func(t *testing.T) {
			before := proxied.Load()
			op()
			if proxied.Load() <= before {
				t.Fatal("proxy not used")
			}
			if direct.Load() != 0 {
				t.Fatal("direct leak")
			}
		})
	}
}
