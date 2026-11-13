package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
		io.WriteString(w, strings.Repeat("a", 64)+"  other\n"+
			strings.Repeat("b", 64)+"  target\n"+
			strings.Repeat("c", 64)+" *binary-target\n"+
			strings.Repeat("d", 64)+"  ./dotted-target\n")
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
	if got, ok = fetchUpdateChecksum(context.Background(), c, "https://github.com/checksums", "binary-target", false); !ok || got != strings.Repeat("c", 64) {
		t.Fatalf("binary prefix checksum=%q ok=%v", got, ok)
	}
	if got, ok = fetchUpdateChecksum(context.Background(), c, "https://github.com/checksums", "dotted-target", false); !ok || got != strings.Repeat("d", 64) {
		t.Fatalf("dot prefix checksum=%q ok=%v", got, ok)
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
func installSafetyPayload(t *testing.T, exe string) error {
	t.Helper()
	body := []byte("new")
	sum := sha256.Sum256(body)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return NewUpdateInstaller(exe, artifactTransport{u})(context.Background(), UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/a",
		SHA256:         hex.EncodeToString(sum[:]),
		Verified:       true,
	})
}

func TestUpdateRotatesRegularBackup(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "wb2api")
	if err := os.WriteFile(exe, []byte("old"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe+".bak", []byte("previous"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := installSafetyPayload(t, exe); err != nil {
		t.Fatalf("install with previous backup: %v", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "new" {
		t.Fatalf("installed payload = %q", got)
	}
	if got, _ := os.ReadFile(exe + ".bak"); string(got) != "old" {
		t.Fatalf("rotated backup = %q", got)
	}
	if _, err := os.Stat(exe + ".bak.prev"); !os.IsNotExist(err) {
		t.Fatalf(".bak.prev should be removed after successful replace, err=%v", err)
	}
}

func TestUpdateRejectsSymlinkBackup(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "wb2api")
	target := filepath.Join(dir, "elsewhere")
	if err := os.WriteFile(exe, []byte("old"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("target"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, exe+".bak"); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	err := installSafetyPayload(t, exe)
	var ue *UpdateError
	if err == nil || !errorsAs(err, &ue) || ue.Code != "backup_exists" {
		t.Fatalf("expected backup_exists, got %v", err)
	}
	if got, _ := os.ReadFile(target); string(got) != "target" {
		t.Fatalf("symlink target modified: %q", got)
	}
	if got, _ := os.ReadFile(exe); string(got) != "old" {
		t.Fatalf("executable modified: %q", got)
	}
}

func TestUpdateRejectsDirectoryBackup(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "wb2api")
	if err := os.WriteFile(exe, []byte("old"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(exe+".bak", 0o700); err != nil {
		t.Fatal(err)
	}
	err := installSafetyPayload(t, exe)
	var ue *UpdateError
	if err == nil || !errorsAs(err, &ue) || ue.Code != "backup_exists" {
		t.Fatalf("expected backup_exists, got %v", err)
	}
	if info, statErr := os.Stat(exe + ".bak"); statErr != nil || !info.IsDir() {
		t.Fatalf("directory backup changed: info=%v err=%v", info, statErr)
	}
	if got, _ := os.ReadFile(exe); string(got) != "old" {
		t.Fatalf("executable modified: %q", got)
	}
}

func TestUpdateReportsBackupInUse(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "wb2api")
	if err := os.WriteFile(exe, []byte("old"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe+".bak", []byte("previous"), 0o600); err != nil {
		t.Fatal(err)
	}
	origRename := updateRename
	defer func() { updateRename = origRename }()
	updateRename = func(oldpath, newpath string) error {
		if oldpath == exe+".bak" && newpath == exe+".bak.prev" {
			return errors.New("sharing violation")
		}
		return os.Rename(oldpath, newpath)
	}
	err := installSafetyPayload(t, exe)
	var ue *UpdateError
	if err == nil || !errorsAs(err, &ue) || ue.Code != "backup_in_use" || !strings.Contains(ue.Message, "restart service") {
		t.Fatalf("expected backup_in_use, got %v", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "old" {
		t.Fatalf("executable modified: %q", got)
	}
	if got, _ := os.ReadFile(exe + ".bak"); string(got) != "previous" {
		t.Fatalf("backup modified: %q", got)
	}
}

func TestUpdateRollbackKeepsBothBackups(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "wb2api")
	if err := os.WriteFile(exe, []byte("old"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe+".bak", []byte("previous"), 0o600); err != nil {
		t.Fatal(err)
	}
	origRename := updateRename
	defer func() { updateRename = origRename }()
	failed := false
	updateRename = func(oldpath, newpath string) error {
		if !failed && newpath == exe && strings.HasPrefix(filepath.Base(oldpath), ".workbuddy-update-") {
			failed = true
			return errors.New("simulated replace failure")
		}
		return os.Rename(oldpath, newpath)
	}
	err := installSafetyPayload(t, exe)
	var ue *UpdateError
	if err == nil || !errorsAs(err, &ue) || ue.Code != "replace_failed" {
		t.Fatalf("expected replace_failed, got %v", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "old" {
		t.Fatalf("executable was not rolled back: %q", got)
	}
	if got, _ := os.ReadFile(exe + ".bak"); string(got) != "previous" {
		t.Fatalf("previous backup was not restored: %q", got)
	}
	if _, err := os.Stat(exe + ".bak.prev"); !os.IsNotExist(err) {
		t.Fatalf(".bak.prev should be empty after rollback, err=%v", err)
	}
}
