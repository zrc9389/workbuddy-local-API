package upstream

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

func TestGlobalExplicitRefreshBypassesCatalogCache(t *testing.T) {
	var version atomic.Int32
	version.Store(1)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprintf(w, "{\"code\":0,\"data\":{\"models\":[{\"id\":\"model-%d\",\"maxOutputTokens\":1024}]}}", version.Load())
	}))
	defer srv.Close()
	c := &Client{HTTP: srv.Client(), ChatBaseGlobal: srv.URL, GlobalEnabled: true}
	a := &auth.Auth{UID: "fixture", AccessToken: "fixture", Domain: "www.workbuddy.ai"}
	first := c.FetchGlobalModelInfos(a)
	if len(first) != 1 || first[0].ID != "model-1" {
		t.Fatalf("first: %+v", first)
	}
	initialCalls := calls.Load()
	version.Store(2)
	cached := c.FetchGlobalModelInfos(a)
	if len(cached) != 1 || cached[0].ID != "model-1" || calls.Load() != initialCalls {
		t.Fatalf("cached: %+v calls=%d", cached, calls.Load())
	}
	fresh := c.FetchGlobalModelInfosRefresh(a, true)
	if len(fresh) != 1 || fresh[0].ID != "model-2" || calls.Load() <= initialCalls {
		t.Fatalf("fresh: %+v calls=%d", fresh, calls.Load())
	}
}
