package metacore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestKernelPath(t *testing.T) {
	for _, tt := range []struct{ goos, goarch, want string }{
		{"windows", "amd64", "third_party/meta/bin/windows-amd64/mihomo.exe"},
		{"linux", "amd64", "third_party/meta/bin/linux-amd64/mihomo"},
		{"linux", "arm64", "third_party/meta/bin/linux-arm64/mihomo"},
		{"windows", "arm64", ""}, {"linux", "386", ""},
		{"darwin", "arm64", ""}, {"../linux", "amd64", ""},
	} {
		t.Run(tt.goos+"_"+tt.goarch, func(t *testing.T) {
			got, ok := KernelPath(tt.goos, tt.goarch)
			if got != filepath.FromSlash(tt.want) || ok != (tt.want != "") {
				t.Fatalf("KernelPath = %q, %v; want %q, %v", got, ok, tt.want, tt.want != "")
			}
		})
	}
}

func TestNativeDefaultPlatformPath(t *testing.T) {
	want, ok := KernelPath(runtime.GOOS, runtime.GOARCH)
	if !ok {
		t.Skip("host has no pinned kernel")
	}
	want, err := filepath.Abs(want)
	if err != nil {
		t.Fatal(err)
	}
	n := newNative(Options{}, "127.0.0.1:1", "fixture-only")
	if n.opts.Binary != want {
		t.Fatalf("native default = %q, want %q", n.opts.Binary, want)
	}
	explicit := filepath.Join(t.TempDir(), "explicit-core")
	n = newNative(Options{Binary: explicit}, "127.0.0.1:1", "fixture-only")
	if n.opts.Binary != explicit {
		t.Fatalf("explicit path changed: %q", n.opts.Binary)
	}
}

func TestNativeRejectsUnpinnedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mihomo")
	if err := os.WriteFile(path, []byte("not a pinned kernel"), 0755); err != nil {
		t.Fatal(err)
	}
	n := newNative(Options{Binary: path}, "127.0.0.1:1", "fixture-only")
	if n.verified() {
		t.Fatal("untrusted bytes verified")
	}
	if err := n.Validate(context.Background(), []byte("{}")); err != ErrUnavailable {
		t.Fatalf("Validate = %v, want unavailable", err)
	}
	if err := n.Start(context.Background(), []byte("{}")); err != ErrUnavailable {
		t.Fatalf("Start = %v, want unavailable", err)
	}
}

func TestNativeAvailabilityFileBounds(t *testing.T) {
	if _, ok := KernelPath(runtime.GOOS, runtime.GOARCH); !ok {
		t.Skip("host has no pinned kernel")
	}
	path := filepath.Join(t.TempDir(), "mihomo")
	n := newNative(Options{Binary: path}, "127.0.0.1:1", "fixture-only")
	if n.Available() {
		t.Fatal("missing file available")
	}
	if err := os.WriteFile(path, nil, 0755); err != nil {
		t.Fatal(err)
	}
	if n.Available() {
		t.Fatal("empty file available")
	}
	if err := os.WriteFile(path, []byte("fixture"), 0755); err != nil {
		t.Fatal(err)
	}
	if !n.Available() {
		t.Fatal("regular executable unavailable")
	}
	if runtime.GOOS == "linux" {
		if err := os.Chmod(path, 0644); err != nil {
			t.Fatal(err)
		}
		if n.Available() {
			t.Fatal("non-executable Linux file available")
		}
		if err := os.Chmod(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Truncate(path, 128<<20+1); err != nil {
		t.Fatal(err)
	}
	if n.Available() {
		t.Fatal("oversized file available")
	}
	n.opts.Binary = filepath.Dir(path)
	if n.Available() {
		t.Fatal("directory available as kernel")
	}
}

func TestPinnedKernelManifestAndInstaller(t *testing.T) {
	raw, err := os.ReadFile("../../third_party/meta/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Mihomo struct {
			Version   string `json:"version"`
			Platforms map[string]struct {
				Platform      string `json:"platform"`
				ArchiveSHA256 string `json:"archive_sha256"`
				BinarySHA256  string `json:"binary_sha256"`
				BinaryPath    string `json:"binary_path"`
				BinaryMode    string `json:"binary_mode"`
				URL           string `json:"url"`
				ReleaseAPI    string `json:"release_api"`
				ArchiveSize   int64  `json:"archive_size"`
				AssetID       int64  `json:"asset_id"`
			} `json:"platforms"`
			Installers map[string]struct {
				Path   string `json:"path"`
				SHA256 string `json:"sha256"`
			} `json:"installers"`
		} `json:"mihomo"`
	}
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Mihomo.Version != KernelVersion {
		t.Fatalf("manifest version = %q", manifest.Mihomo.Version)
	}
	if len(manifest.Mihomo.Platforms) != 3 {
		t.Fatalf("expected exactly three pins, got %d", len(manifest.Mihomo.Platforms))
	}
	script, err := os.ReadFile("../../scripts/meta-install-linux.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"windows", "amd64"}, {"linux", "amd64"}, {"linux", "arm64"}} {
		platform := pair[0] + "-" + pair[1]
		pin, ok := pinnedPlatform(pair[0], pair[1])
		if !ok {
			t.Fatal("missing code pin", platform)
		}
		entry, ok := manifest.Mihomo.Platforms[platform]
		if !ok {
			t.Fatal("missing manifest pin", platform)
		}
		path, _ := KernelPath(pair[0], pair[1])
		if entry.Platform != platform || entry.BinarySHA256 != pin.sha256 || filepath.FromSlash(entry.BinaryPath) != filepath.Join("bin", platform, pin.filename) {
			t.Fatalf("code/manifest disagree for %s (%s)", platform, path)
		}
		if len(entry.ArchiveSHA256) != 64 || entry.ArchiveSize <= 0 || entry.ArchiveSize > 32<<20 || entry.AssetID == 0 {
			t.Fatal("missing bounded official asset metadata", platform)
		}
		if _, err = hex.DecodeString(entry.ArchiveSHA256); err != nil {
			t.Fatal(err)
		}
		if entry.ReleaseAPI != "https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/"+KernelVersion ||
			!strings.HasPrefix(entry.URL, "https://github.com/MetaCubeX/mihomo/releases/download/"+KernelVersion+"/") {
			t.Fatal("non-primary pinned source", platform)
		}
		if pair[0] == "linux" {
			if entry.BinaryMode != "0755" {
				t.Fatal("Linux executable mode missing", platform)
			}
			if !bytes.Contains(script, []byte(entry.ArchiveSHA256)) || !bytes.Contains(script, []byte(pin.sha256)) {
				t.Fatal("installer/manifest pin drift", platform)
			}
		}
	}
	installer := manifest.Mihomo.Installers["linux"]
	sum := sha256.Sum256(script)
	if installer.Path != "../../scripts/meta-install-linux.sh" || installer.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatal("installer source checksum drift")
	}
}

// This only reads files; launching the real core remains META_REAL_TEST=1 opt-in.
func TestBundledKernelDigestsAndFormats(t *testing.T) {
	for _, pair := range [][2]string{{"windows", "amd64"}, {"linux", "amd64"}, {"linux", "arm64"}} {
		t.Run(pair[0]+"-"+pair[1], func(t *testing.T) {
			relative, _ := KernelPath(pair[0], pair[1])
			path := filepath.Join("..", "..", relative)
			f, err := os.Open(path)
			if os.IsNotExist(err) {
				t.Skip("optional kernel not provisioned in this source checkout")
			}
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			info, err := f.Stat()
			if err != nil {
				t.Fatal(err)
			}
			if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 128<<20 {
				t.Fatal("invalid kernel file bounds")
			}
			header := make([]byte, 20)
			if _, err = io.ReadFull(f, header); err != nil {
				t.Fatal(err)
			}
			if pair[0] == "windows" {
				if string(header[:2]) != "MZ" {
					t.Fatal("expected PE binary")
				}
			} else {
				if !bytes.Equal(header[:6], []byte{0x7f, 'E', 'L', 'F', 2, 1}) {
					t.Fatal("expected ELF64 little-endian binary")
				}
				machine := uint16(62)
				if pair[1] == "arm64" {
					machine = 183
				}
				if binary.LittleEndian.Uint16(header[18:20]) != machine {
					t.Fatal("ELF architecture mismatch")
				}
			}
			h := sha256.New()
			h.Write(header)
			if _, err = io.Copy(h, io.LimitReader(f, (128<<20)+1)); err != nil {
				t.Fatal(err)
			}
			pin, _ := pinnedPlatform(pair[0], pair[1])
			if hex.EncodeToString(h.Sum(nil)) != pin.sha256 {
				t.Fatal("bundled kernel digest mismatch")
			}
		})
	}
}

func linuxInstaller(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("installer behavior requires Linux shell")
	}
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no sh installed")
	}
	path, err := filepath.Abs("../../scripts/meta-install-linux.sh")
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLinuxInstallerRejectsCorruptArchive(t *testing.T) {
	script := linuxInstaller(t)
	dir := t.TempDir()
	archive := filepath.Join(dir, "not-a-release.gz")
	if err := os.WriteFile(archive, []byte("corrupt fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(dir, "install with spaces")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sh", script, "--arch", "amd64", "--destination", destination, "--archive", archive).CombinedOutput()
	if err == nil || !bytes.Contains(out, []byte("archive checksum mismatch")) {
		t.Fatalf("bad archive accepted or wrong error: %v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(destination, "mihomo")); !os.IsNotExist(err) {
		t.Fatal("corrupt kernel was installed")
	}
}

func TestLinuxInstallerDoesNotReplaceExistingKernel(t *testing.T) {
	script := linuxInstaller(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "mihomo")
	content := []byte("local existing file - not the pinned release")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sh", script, "--arch", "amd64", "--destination", dir).CombinedOutput()
	if err == nil || !bytes.Contains(out, []byte("existing kernel checksum mismatch")) {
		t.Fatalf("existing untrusted file accepted: %v %s", err, out)
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, content) {
		t.Fatal("installer replaced existing file")
	}
	st, err := os.Stat(path)
	if err != nil || st.Mode().Perm() != 0644 {
		t.Fatal("unverified file mode changed")
	}
}

func TestLinuxInstallerVerifiedExistingKernelMode(t *testing.T) {
	script := linuxInstaller(t)
	relative, ok := KernelPath("linux", runtime.GOARCH)
	if !ok {
		t.Skip("unsupported architecture")
	}
	f, err := os.Open(filepath.Join("..", "..", relative))
	if os.IsNotExist(err) {
		t.Skip("kernel not provisioned")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	dir := t.TempDir()
	target := filepath.Join(dir, "mihomo")
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		t.Fatal(err)
	}
	_, copyErr := io.Copy(out, f)
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil {
		t.Fatal(copyErr, closeErr)
	}
	if err = os.Chmod(target, 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "sh", script, "--arch", runtime.GOARCH, "--destination", dir).CombinedOutput()
	if err != nil {
		t.Fatalf("verified existing binary: %v %s", err, output)
	}
	st, err := os.Stat(target)
	if err != nil || st.Mode().Perm() != 0755 {
		t.Fatal("verified Linux kernel not chmod 0755")
	}
}
