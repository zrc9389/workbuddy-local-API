package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestChecksumMatchesNamedAsset(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, strings.Repeat("a", 64)+"  other\n"+strings.Repeat("b", 64)+"  target\n")
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	c := &http.Client{Transport: artifactTransport{u}}
	got, ok := fetchUpdateChecksum(context.Background(), c, "https://github.com/checksums", "target", false)
	if !ok || got != strings.Repeat("b", 64) {
		t.Fatalf("checksum=%q ok=%v", got, ok)
	}
	if _, ok = fetchUpdateChecksum(context.Background(), c, "https://github.com/checksums", "missing", false); ok {
		t.Fatal("accepted unrelated checksum")
	}
}
func TestSelectUpdateAssetRejectsPackages(t *testing.T) {
	name := "wb2api-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if selectUpdateAsset("v1.0.0", []updateAsset{{Name: name + ".tar.gz", URL: "https://github.com/a"}}) != nil {
		t.Fatal("archive selected as executable")
	}
	if selectUpdateAsset("v1.0.0", []updateAsset{{Name: name, URL: "https://github.com/a"}}) == nil {
		t.Fatal("standalone executable not selected")
	}
}
func TestUpdateKeepsExistingBackup(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "wb2api")
	os.WriteFile(exe, []byte("old"), 0700)
	os.WriteFile(exe+".bak", []byte("previous"), 0600)
	body := []byte("new")
	sum := sha256.Sum256(body)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	err := NewUpdateInstaller(exe, artifactTransport{u})(context.Background(), UpdateArtifact{CurrentVersion: "1.0.0", Version: "1.1.0", URL: "https://github.com/a", SHA256: hex.EncodeToString(sum[:]), Verified: true})
	if err == nil {
		t.Fatal("existing backup overwritten")
	}
	got, _ := os.ReadFile(exe + ".bak")
	if string(got) != "previous" {
		t.Fatal("backup changed")
	}
}
