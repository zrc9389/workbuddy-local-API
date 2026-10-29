package panel

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ioTestPanel(t *testing.T) *Panel {
	t.Helper()
	return New(Config{Pool: pool.New(""), AuthDir: t.TempDir()})
}
func TestAccountsImportExportAndStatePreservation(t *testing.T) {
	p := ioTestPanel(t)
	body := `[{"uid":"safe-1","accessToken":"fake-access","refreshToken":"fake-refresh","proxy":"http://user:password@localhost:8080"}]`
	w := httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(body)))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	a := p.cfg.Pool.AuthByUID("safe-1")
	if a == nil {
		t.Fatal("not imported")
	}
	p.cfg.Pool.Disable(a.UID, "test")
	w = httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"uid":"safe-1","accessToken":"new-fake"}`)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	a = p.cfg.Pool.AuthByUID(a.UID)
	if a.AccessTokenValue() != "fake-access" || a.ProxyURLValue() == "" {
		t.Fatal("duplicate import changed account/proxy")
	}
	st, _ := p.cfg.Pool.Status(a.UID)
	if !st.Disabled {
		t.Fatal("import revived disabled account")
	}
	w = httptest.NewRecorder()
	p.AccountsExport(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Header())
	}
	var docs []json.RawMessage
	if json.Unmarshal(w.Body.Bytes(), &docs) != nil || len(docs) != 1 {
		t.Fatal(w.Body.String())
	}
	b, err := auth.Parse(docs[0])
	if err != nil || b.AccessTokenValue() != "fake-access" || b.ProxyURLValue() != a.ProxyURLValue() {
		t.Fatal("bad export", err)
	}
}

func TestImportMergeKeepsExistingAndFirstDuplicate(t *testing.T) {
	p := ioTestPanel(t)
	importJSON := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(body)))
		return w
	}
	if w := importJSON(`{"uid":"old","accessToken":"old-token","realm":"global","proxy":"http://proxy:80"}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := importJSON(`[{"uid":"old","accessToken":"replacement"},{"uid":"new","accessToken":"first"},{"uid":"new","accessToken":"second"}]`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"imported":1`) || !strings.Contains(w.Body.String(), `"retained":["old"]`) {
		t.Fatal(w.Body.String())
	}
	if p.cfg.Pool.AuthByUID("old").AccessTokenValue() != "old-token" || p.cfg.Pool.AuthByUID("new").AccessTokenValue() != "first" {
		t.Fatal("duplicate replaced data")
	}
	w = httptest.NewRecorder()
	p.AccountsExport(w, httptest.NewRequest("GET", "/", nil))
	if !strings.Contains(w.Body.String(), `"region":"global"`) || !strings.Contains(w.Body.String(), `"proxy_url":"http://proxy:80"`) {
		t.Fatal("region or proxy missing")
	}
}

func TestImportDoesNotUseUnrestoredMetaListener(t *testing.T) {
	p := ioTestPanel(t)
	w := httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"uid":"new","accessToken":"fake","proxy":"http://localhost:1234","binding":{"subscription_url":"https://fixture.invalid/sub","node":"fixture"}}`)))
	if w.Code != 500 || p.cfg.Pool.AuthByUID("new") != nil {
		t.Fatal("unrestored Meta route imported")
	}
}
func TestAccountsImportValidatesWholeBatchAndBounds(t *testing.T) {
	p := ioTestPanel(t)
	for _, body := range []string{`[{"uid":"valid","accessToken":"fake"},{"uid":"../bad","accessToken":"fake"}]`, `{"uid":"CON","accessToken":"fake"}`, `{"uid":"safe","accessToken":"fake","proxy":"http://user:supersecret@host:bad"}`, `null`, `[]`, `{"uid":"safe","accessToken":"fake"} {}`, strings.Repeat("x", maxCredentialImportBytes+1)} {
		w := httptest.NewRecorder()
		p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(body)))
		if w.Code < 400 {
			t.Fatalf("accepted invalid import: %d", w.Code)
		}
		if strings.Contains(w.Body.String(), "supersecret") {
			t.Fatal("secret leaked")
		}
	}
	files, _ := os.ReadDir(p.cfg.AuthDir)
	if len(files) != 0 || len(p.cfg.Pool.List()) != 0 {
		t.Fatal("invalid batch partially imported")
	}
}
func TestAccountsImportRejectsOutsidePath(t *testing.T) {
	p := ioTestPanel(t)
	outside := filepath.Join(t.TempDir(), "outside.json")
	a := &auth.Auth{UID: "safe", AccessToken: "old", FilePath: outside}
	p.cfg.Pool.Add(a)
	w := httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"uid":"safe","accessToken":"fake"}`)))
	if w.Code < 400 {
		t.Fatal("allowed outside path")
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatal("wrote outside auth dir")
	}
}

func TestLegacyAccountFileImportAcceptsNestedWorkBuddyJSONWithoutUpstreamCalls(t *testing.T) {
	p := ioTestPanel(t)
	var body strings.Builder
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", "accounts.json")
	if err != nil {
		t.Fatal(err)
	}
	fixture := `[{"account":{"uid":"nested-001","nickname":"fixture","enterpriseId":"","realm":"cn"},"auth":{"accessToken":"fake-access","refreshToken":"fake-refresh","expiresAt":1790000000,"refreshExpiresAt":1790000000,"domain":"www.codebuddy.cn","realm":"cn"},"proxy":"","realm":"cn"}]`
	if _, err := file.Write([]byte(fixture)); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/", strings.NewReader(body.String()))
	req.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	p.importCockpit(w, req)
	if w.Code != 200 {
		t.Fatalf("nested account upload status=%d body=%s", w.Code, w.Body.String())
	}
	if got := p.cfg.Pool.AuthByUID("nested-001"); got == nil || got.AccessTokenValue() != "fake-access" {
		t.Fatal("nested account was not imported")
	}
	if strings.Contains(w.Body.String(), "fake-access") || strings.Contains(w.Body.String(), "fake-refresh") {
		t.Fatal("credential leaked in import response")
	}
}

func TestBlockedAccountCannotBeManuallyEnabledOrProbed(t *testing.T) {
	p := ioTestPanel(t)
	p.cfg.Pool.Add(&auth.Auth{UID: "isolated", AccessToken: "fake"})
	p.cfg.Pool.Disable("isolated", "invalid token")
	p.cfg.Pool.SetManualDisabled("isolated", true)
	req := httptest.NewRequest("POST", "/", strings.NewReader("{\"disabled\":false}"))
	req.SetPathValue("uid", "isolated")
	w := httptest.NewRecorder()
	p.toggleDisabled(w, req)
	st, _ := p.cfg.Pool.Status("isolated")
	if w.Code != 409 || !st.ManualDisabled || !st.Blocked {
		t.Fatalf("enable: %d %+v", w.Code, st)
	}
	req = httptest.NewRequest("POST", "/", nil)
	req.SetPathValue("uid", "isolated")
	w = httptest.NewRecorder()
	p.accountRevive(w, req)
	if w.Code != 409 {
		t.Fatalf("revive: %d", w.Code)
	}
	req = httptest.NewRequest("POST", "/", strings.NewReader("{\"uid\":\"isolated\"}"))
	w = httptest.NewRecorder()
	p.egressSpeedtest(w, req)
	if w.Code != 409 {
		t.Fatalf("probe: %d %s", w.Code, w.Body.String())
	}
	req = httptest.NewRequest("POST", "/", nil)
	req.SetPathValue("uid", "isolated")
	w = httptest.NewRecorder()
	p.accountBalance(w, req)
	if w.Code != 409 {
		t.Fatalf("balance: %d", w.Code)
	}
}

func TestImportDoesNotReplacePendingDeletionCredential(t *testing.T) {
	dir := t.TempDir()
	pl := pool.New("")
	p := New(Config{Pool: pl, AuthDir: dir, DeletionJournalPath: filepath.Join(dir, "journal.json"), RequestLog: failingDeleteSink{}})
	path := filepath.Join(dir, "workbuddy-u.json")
	a := &auth.Auth{UID: "u", AccessToken: "old-fake", FilePath: path}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl.Add(a)
	req := httptest.NewRequest("POST", "/", nil)
	req.SetPathValue("uid", "u")
	p.accountRemove(httptest.NewRecorder(), req)
	if _, ok := p.deletions.journal.get("u"); !ok {
		t.Fatal("expected pending deletion")
	}
	w := httptest.NewRecorder()
	p.AccountsImport(w, httptest.NewRequest("POST", "/", strings.NewReader("{\"uid\":\"u\",\"accessToken\":\"new-fake\"}")))
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	raw, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(raw), "old-fake") || strings.Contains(string(raw), "new-fake") {
		t.Fatal("pending credential changed", err)
	}
}

func TestPackagesSkipsTokenIsolatedAccount(t *testing.T) {
	p := ioTestPanel(t)
	p.cfg.Pool.Add(&auth.Auth{UID: "isolated", AccessToken: "fake"})
	p.cfg.Pool.Disable("isolated", "invalid token")
	w := httptest.NewRecorder()
	p.packages(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"accounts":[]`) {
		t.Fatalf("response: %d %s", w.Code, w.Body.String())
	}
}
