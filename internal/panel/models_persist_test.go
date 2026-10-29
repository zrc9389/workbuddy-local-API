package panel

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestPersistedModelsRestartAndPartialFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cache.json")
	p := New(Config{ModelsCachePath: path})
	fetch := func(id string) func() ([]upstream.ModelInfo, error) {
		return func() ([]upstream.ModelInfo, error) { return []upstream.ModelInfo{{ID: id}}, nil }
	}
	p.modelsDomain("cn", false, fetch("cn-old"))
	p.modelsDomain("global", false, fetch("global-old"))
	p.modelsDomain("cn", true, fetch("cn-new"))
	failed := p.modelsDomain("global", true, func() ([]upstream.ModelInfo, error) { return nil, errors.New("secret-token-fixture") })
	if !failed.stale {
		t.Fatal("failed refresh must be stale")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "secret-token-fixture") {
		t.Fatal("error text persisted")
	}
	p2 := New(Config{ModelsCachePath: path})
	hits := 0
	noFetch := func() ([]upstream.ModelInfo, error) { hits++; return nil, errors.New("unexpected fetch") }
	cn := p2.modelsDomain("cn", false, noFetch)
	global := p2.modelsDomain("global", false, noFetch)
	if hits != 0 || len(cn.infos) != 1 || cn.infos[0].ID != "cn-new" || cn.stale || len(global.infos) != 1 || global.infos[0].ID != "global-old" || !global.stale {
		t.Fatalf("hits=%d cn=%+v global=%+v", hits, cn, global)
	}
}

func TestPersistedModelsExpiredAndInvalid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cache.json")
	p := New(Config{ModelsCachePath: path})
	p.modelsDomain("cn", false, func() ([]upstream.ModelInfo, error) { return []upstream.ModelInfo{{ID: "old"}}, nil })
	p.modelsMu.Lock()
	p.modelsCache["cn"].fetched = time.Now().Add(-panelModelsTTL - time.Second)
	p.persistModelsCacheLocked()
	p.modelsMu.Unlock()
	p2 := New(Config{ModelsCachePath: path})
	calls := 0
	failed := p2.modelsDomain("cn", false, func() ([]upstream.ModelInfo, error) { calls++; return nil, errors.New("down") })
	if calls != 1 || !failed.stale || len(failed.infos) != 1 {
		t.Fatalf("calls=%d result=%+v", calls, failed)
	}
	p3 := New(Config{ModelsCachePath: path})
	again := p3.modelsDomain("cn", false, func() ([]upstream.ModelInfo, error) { calls++; return nil, nil })
	if calls != 1 || !again.stale {
		t.Fatalf("negative cache not restored: calls=%d result=%+v", calls, again)
	}
	p3.modelsMu.Lock()
	p3.modelsCache["cn"].lastFail = time.Now().Add(-panelModelsFailCooldown - time.Second)
	p3.modelsMu.Unlock()
	recovered := p3.modelsDomain("cn", false, func() ([]upstream.ModelInfo, error) { calls++; return []upstream.ModelInfo{{ID: "new"}}, nil })
	if calls != 2 || recovered.stale || recovered.infos[0].ID != "new" {
		t.Fatalf("recovery: calls=%d result=%+v", calls, recovered)
	}
	p5 := New(Config{ModelsCachePath: path})
	if got := p5.modelsCache["cn"]; got.infos[0].ID != "new" || !got.lastFail.IsZero() {
		t.Fatalf("recovered snapshot not persisted: %+v", got)
	}
	if err := os.WriteFile(path, []byte("{broken"), 0600); err != nil {
		t.Fatal(err)
	}
	p4 := New(Config{ModelsCachePath: path})
	if len(p4.modelsCache) != 0 {
		t.Fatal("corrupt cache accepted")
	}
}

func TestModelCacheWriteFailureKeepsMemory(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "file")
	if err := os.WriteFile(blocker, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	p := New(Config{ModelsCachePath: filepath.Join(blocker, "cache.json")})
	result := p.modelsDomain("cn", false, func() ([]upstream.ModelInfo, error) { return []upstream.ModelInfo{{ID: "live"}}, nil })
	if result.err != nil || len(result.infos) != 1 || result.infos[0].ID != "live" {
		t.Fatalf("result=%+v", result)
	}
	result = p.modelsDomain("cn", false, func() ([]upstream.ModelInfo, error) { t.Fatal("memory cache not retained"); return nil, nil })
	if !result.fromCache {
		t.Fatal("memory cache unavailable")
	}
}
