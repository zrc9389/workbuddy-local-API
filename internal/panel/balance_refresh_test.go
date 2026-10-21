package panel

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/scheduler"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

// TestBalanceRefreshOnlyUpdatesAccountData 锁定手动「刷新」只刷新余额等账号数据：
// 不得回查 /console/account 覆盖昵称（昵称同步死代码已移除）。
func TestBalanceRefreshOnlyUpdatesAccountData(t *testing.T) {
	var balanceCalls, profileCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/get-user-resource"):
			balanceCalls.Add(1)
			_, _ = w.Write([]byte(`{"code":0,"data":{"Response":{"Data":{"Accounts":[{"CycleCapacitySize":1000,"CycleCapacityRemain":500,"CycleCapacityUsed":500}]}}}}`))
		case strings.HasSuffix(r.URL.Path, "/console/account"):
			profileCalls.Add(1)
			_, _ = w.Write([]byte(`{"code":0,"data":{"uid":"refresh-one","nickname":"上游新名字"}}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer srv.Close()

	accounts := pool.New("")
	accounts.Add(&auth.Auth{UID: "refresh-one", Nickname: "本地昵称", AccessToken: "at", RefreshToken: "rt", ExpiresAt: 9999999999})
	up := &upstream.Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, BillingBaseCN: srv.URL, WebBaseCN: srv.URL}
	p := New(Config{Pool: accounts, Upstream: up, Scheduler: scheduler.New(scheduler.Config{Pool: accounts, Upstream: up})})

	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/panel/api/balance_all", strings.NewReader("{}")))
	if rec.Code != http.StatusOK {
		t.Fatalf("balance refresh status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := balanceCalls.Load(); got != 1 {
		t.Fatalf("balance calls=%d want 1", got)
	}
	if got := profileCalls.Load(); got != 0 {
		t.Fatalf("profile calls=%d want 0: refresh must not sync nicknames", got)
	}
	st, ok := accounts.Status("refresh-one")
	if !ok {
		t.Fatal("account missing from pool")
	}
	if st.Nickname != "本地昵称" {
		t.Fatalf("nickname=%q want unchanged 本地昵称", st.Nickname)
	}
	if st.Credits != 500 {
		t.Fatalf("credits=%d want 500", st.Credits)
	}
}
