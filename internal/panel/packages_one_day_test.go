package panel

import (
	"encoding/json"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPackagesOneDayWindow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"code":0,"data":{"Response":{"Data":{"Accounts":[{"PackageName":"soon","CycleCapacitySize":100,"CycleCapacityRemain":60,"DeductionEndTime":%d},{"PackageName":"later","CycleCapacitySize":100,"CycleCapacityRemain":40,"DeductionEndTime":%d}]}}}}`, time.Now().Add(23*time.Hour).UnixMilli(), time.Now().Add(25*time.Hour).UnixMilli())
	}))
	defer srv.Close()
	accounts := pool.New("")
	accounts.Add(&auth.Auth{UID: "fixture", AccessToken: "fake", ExpiresAt: 9999999999})
	p := New(Config{Pool: accounts, Upstream: &upstream.Client{HTTP: srv.Client(), BillingBaseCN: srv.URL}})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/panel/api/packages?filter=expiring", nil))
	var out struct {
		Window  string `json:"expiring_soon_window"`
		Count   int    `json:"expiring_packages_count"`
		Credits int    `json:"expiring_credits_total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || out.Window != "24h" || out.Count != 1 || out.Credits != 60 {
		t.Fatalf("status=%d result=%+v", w.Code, out)
	}
}
