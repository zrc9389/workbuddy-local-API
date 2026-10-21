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
	if a.AccessTokenValue() != "new-fake" || a.ProxyURLValue() == "" {
		t.Fatal("update lost account/proxy")
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
	if err != nil || b.AccessTokenValue() != "new-fake" || b.ProxyURLValue() != a.ProxyURLValue() {
		t.Fatal("bad export", err)
	}
}
func TestAccountsImportValidatesWholeBatchAndBounds(t *testing.T) {
	p := ioTestPanel(t)
	for _, body := range []string{`[{"uid":"valid","accessToken":"fake"},{"uid":"../bad","accessToken":"fake"}]`, `{"uid":"CON","accessToken":"fake"}`, `{"uid":"safe","accessToken":"fake","proxy":"http://user:supersecret@host:bad"}`, `[{"uid":"dup","accessToken":"fake"},{"uid":"dup","accessToken":"fake"}]`, `null`, `[]`, `{"uid":"safe","accessToken":"fake"} {}`, strings.Repeat("x", maxCredentialImportBytes+1)} {
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
