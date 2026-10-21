package demo

import (
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"testing"
)

func TestMockCatalogUsesActualUpstreamEnvelope(t *testing.T) {
	s := StartUpstream()
	defer s.Close()
	up := upstream.New()
	Configure(up, s.URL)
	models, e := up.FetchModels(&auth.Auth{UID: "fixture", AccessToken: "demo", Domain: "copilot.tencent.com"})
	if e != nil {
		t.Fatal(e)
	}
	if len(models) < 3 || models[0].ContextWindow <= 0 {
		t.Fatal("incomplete demo catalog", models)
	}
}
