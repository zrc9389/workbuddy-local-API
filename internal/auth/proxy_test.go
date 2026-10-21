package auth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProxyPersistenceAndValidation(t *testing.T) {
	for _, raw := range []string{`{"uid":"safe-1","accessToken":"fake-token","proxy":"http://user:secret@127.0.0.1:8080"}`, `{"auth":{"accessToken":"fake-token"},"account":{"uid":"safe-1"},"proxy":"socks5://127.0.0.1:1080"}`} {
		a, err := Parse([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		if a.ProxyURLValue() == "" {
			t.Fatal("proxy lost during parse")
		}
		a.FilePath = filepath.Join(t.TempDir(), "workbuddy-safe-1.json")
		if err := a.SaveAtomic(); err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(a.FilePath)
		again, err := Parse(b)
		if err != nil || again.ProxyURLValue() != a.ProxyURLValue() {
			t.Fatal("proxy round trip", err)
		}
		exported, err := a.ExportJSON()
		if err != nil {
			t.Fatal(err)
		}
		var doc map[string]any
		if json.Unmarshal(exported, &doc) != nil || doc["proxy"] != a.ProxyURLValue() {
			t.Fatal("export proxy")
		}
		before := a.ProxyURLValue()
		if a.SetProxyAndSave("file:///bad") == nil || a.ProxyURLValue() != before {
			t.Fatal("invalid proxy mutated account")
		}
	}
	for _, p := range []string{"ftp://host:21", "http://", "http://host:99999", "http://host:0", "http://host/path", "http://host?secret=1", "http://user:secret@host:bad", "http://host#frag"} {
		if err := ValidateProxyURL(p); err == nil {
			t.Errorf("accepted %q", p)
		} else if strings.Contains(err.Error(), "secret") {
			t.Fatal("secret in error")
		}
	}
	for _, p := range []string{"", "http://localhost:80", "https://user:pass@host:443", "socks5://127.0.0.1:1080", "http://[::1]:8080"} {
		if err := ValidateProxyURL(p); err != nil {
			t.Errorf("rejected proxy: %v", err)
		}
	}
}
func TestProxySaveFailureRollsBack(t *testing.T) {
	a := &Auth{UID: "ok", AccessToken: "fake", ProxyURL: "http://old:80", FilePath: filepath.Join(t.TempDir(), "missing", "auth.json")}
	if a.SetProxyAndSave("http://new:80") == nil || a.ProxyURLValue() != "http://old:80" {
		t.Fatal("failed save must rollback")
	}
}
func TestSafeUID(t *testing.T) {
	for _, s := range []string{"", "../x", `a\b`, "a/b", "CON", "nul", "COM1", "LPT9", "x:y", "foo.", strings.Repeat("a", 129), "a\n"} {
		if ValidateUID(s) == nil {
			t.Errorf("accepted uid %q", s)
		}
	}
	for _, s := range []string{"12345", "user-1", "abc_def"} {
		if ValidateUID(s) != nil {
			t.Errorf("rejected %s", s)
		}
	}
}

func TestImportedReplacementRetiresOldWriter(t *testing.T) {
	old := &Auth{UID: "u", AccessToken: "old", ProxyURL: "http://old:80", FilePath: filepath.Join(t.TempDir(), "workbuddy-u.json")}
	next := &Auth{UID: "u", AccessToken: "new", Nickname: "new-name"}
	if err := old.ImportCredentialsAndSave(next, true); err != nil {
		t.Fatal(err)
	}
	if old.AccessTokenValue() != "old" {
		t.Fatal("must not mutate immutable shared account metadata in place")
	}
	if err := old.SaveAtomic(); err == nil {
		t.Fatal("retired account may overwrite imported credentials")
	}
	raw, _ := os.ReadFile(old.FilePath)
	current, err := Parse(raw)
	if err != nil || current.AccessTokenValue() != "new" || current.ProxyURLValue() != "http://old:80" {
		t.Fatal("replacement persistence failed", err)
	}
}

func TestProxyNullIsNotImplicitDirect(t *testing.T) {
	for _, raw := range []string{`{"uid":"u","accessToken":"fake","proxy":null}`, `{"uid":"u","accessToken":"fake","proxy_url":null}`} {
		if _, err := Parse([]byte(raw)); err == nil {
			t.Fatal("null proxy must not silently select direct")
		}
	}
}
