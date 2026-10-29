package panel

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestPackagesExcludesBlockedAndUsesMilliseconds(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprintf(w, "{\"code\":0,\"data\":{\"Response\":{\"Data\":{\"Accounts\":[{\"PackageName\":\"test\",\"CycleCapacitySize\":100,\"CycleCapacityRemain\":80,\"DeductionEndTime\":%d}]}}}}", time.Now().Add(23*time.Hour).UnixMilli())
	}))
	defer srv.Close()
	accounts := pool.New("")
	for _, uid := range []string{"available", "blocked"} {
		accounts.Add(&auth.Auth{UID: uid, AccessToken: "fixture", ExpiresAt: 9999999999})
	}
	accounts.NoteUnauthorized("blocked", "UNAUTHORIZED: fixture")
	p := New(Config{Pool: accounts, Upstream: &upstream.Client{HTTP: srv.Client(), BillingBaseCN: srv.URL}})
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panel/api/packages", nil))
	var result struct {
		Accounts              []struct{ UID string }
		ExpiringPackagesCount int
		ExpiringCreditsTotal  int
	}
	var body map[string]json.RawMessage
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	json.Unmarshal(body["accounts"], &result.Accounts)
	json.Unmarshal(body["expiring_packages_count"], &result.ExpiringPackagesCount)
	json.Unmarshal(body["expiring_credits_total"], &result.ExpiringCreditsTotal)
	if calls.Load() != 1 || len(result.Accounts) != 1 || result.Accounts[0].UID != "available" || result.ExpiringPackagesCount != 1 || result.ExpiringCreditsTotal != 80 {
		t.Fatalf("calls=%d result=%+v", calls.Load(), result)
	}
}
