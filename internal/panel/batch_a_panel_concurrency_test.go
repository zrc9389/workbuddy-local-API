package panel

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func TestAccountsReimportPublishesNonRetiredObjectAndAllowsSaveAtomic(t *testing.T) {
	p := ioTestPanel(t)
	// 1. 首次导入
	w := httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"uid":"reimport-1","accessToken":"tok-v1","refreshToken":"ref-v1","proxy":"http://127.0.0.1:7890"}`)))
	if w.Code != 200 {
		t.Fatalf("first import status=%d body=%s", w.Code, w.Body.String())
	}
	oldObj := p.cfg.Pool.AuthByUID("reimport-1")
	if oldObj == nil {
		t.Fatal("missing initial account")
	}

	// 2. 同 UID 仅带新 accessToken 重导入（不再被 RefreshTokenValue != "" 门控拦掉）
	w = httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"uid":"reimport-1","accessToken":"tok-v2"}`)))
	if w.Code != 200 {
		t.Fatalf("reimport status=%d body=%s", w.Code, w.Body.String())
	}
	curObj := p.cfg.Pool.AuthByUID("reimport-1")
	if curObj == nil {
		t.Fatal("missing account after reimport")
	}
	if curObj == oldObj {
		t.Fatal("pool still holds old retired object pointer instead of new replacement")
	}
	if !oldObj.IsRetired() {
		t.Fatal("expected old object to be marked retired")
	}
	if curObj.IsRetired() {
		t.Fatal("expected active pool object to have retired == false")
	}
	if curObj.AccessTokenValue() != "tok-v2" {
		t.Fatalf("accessToken=%q want tok-v2", curObj.AccessTokenValue())
	}
	if curObj.ProxyURLValue() != "http://127.0.0.1:7890" {
		t.Fatalf("proxy=%q want preserved proxy", curObj.ProxyURLValue())
	}
	// 后续 SaveAtomic 必须成功（若池内仍是 retired 旧对象，此处必定报错）
	if err := curObj.SaveAtomic(); err != nil {
		t.Fatalf("SaveAtomic on pool account after reimport failed: %v", err)
	}
	raw, err := os.ReadFile(curObj.FilePath)
	if err != nil || !strings.Contains(string(raw), "tok-v2") {
		t.Fatalf("persisted file missing tok-v2: err=%v", err)
	}
}

func TestBatchAConcurrencyRaceSafety(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(cfgPath, []byte(`{"listen":":7863"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	var saveMu sync.Mutex
	pl := pool.New("")
	a := &auth.Auth{UID: "race-u1", AccessToken: "tok", Nickname: "init", FilePath: filepath.Join(dir, "workbuddy-race-u1.json")}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl.Add(a)

	p := New(Config{
		Pool:                pl,
		AuthDir:             dir,
		ConfigPath:          cfgPath,
		ConfigSaveMu:        &saveMu,
		DeletionJournalPath: filepath.Join(dir, "deletions.json"),
	})

	oldClient := getLoginHTTP()
	defer setLoginHTTP(oldClient)

	var wg sync.WaitGroup
	// 1. Nickname 并发读写
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			pl.SetNickname("race-u1", "nick-"+string(rune('a'+i%26)))
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 60; i++ {
			_ = a.NicknameValue()
		}
	}()

	// 2. loginHTTP 并发切换与读取
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i++ {
			if i%2 == 0 {
				_ = setLoginProxy("http://127.0.0.1:7890")
			} else {
				_ = setLoginProxy("")
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i++ {
			c := getLoginHTTP()
			if c == nil {
				t.Error("nil loginHTTP client")
			}
		}
	}()

	// 3. ensureDeletionCoordinator 并发获取
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				dc, err := p.ensureDeletionCoordinator()
				if err != nil || dc == nil {
					t.Errorf("ensureDeletionCoordinator err=%v", err)
				}
			}
		}()
	}

	// 4. persistDefaultEgress 与 ConfigSaveMu 并发写 config.json
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			p.persistDefaultEgress("node-a")
			p.persistDefaultEgress("")
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			saveMu.Lock()
			raw, err := os.ReadFile(cfgPath)
			if err == nil {
				var doc map[string]any
				if json.Unmarshal(raw, &doc) != nil {
					t.Errorf("corrupted config.json during concurrent write: %s", string(raw))
				}
			}
			saveMu.Unlock()
		}
	}()

	wg.Wait()

	// 5. RestoreDefaultEgress 支持 ctx 取消及时退出（不会卡死）
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p.RestoreDefaultEgress(ctx)
	time.Sleep(10 * time.Millisecond)
}
