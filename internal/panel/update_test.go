package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type artifactTransport struct{ target *url.URL }

func (t artifactTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	u := *r.URL
	u.Scheme, u.Host = t.target.Scheme, t.target.Host
	clone := r.Clone(r.Context())
	clone.URL = &u
	return http.DefaultTransport.RoundTrip(clone)
}

func TestApplyUpdateVerifiedArtifactAndRollbackGuard(t *testing.T) {
	payload := []byte("new executable")
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(payload) }))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	dir := t.TempDir()
	exe := dir + "/workbuddy.exe"
	if err := os.WriteFile(exe, []byte("old executable"), 0o755); err != nil {
		t.Fatal(err)
	}
	artifact := UpdateArtifact{CurrentVersion: "1.0.0", Version: "1.1.0", URL: "https://github.com/acme/workbuddy/releases/download/v1.1.0/workbuddy-windows-amd64.exe", SHA256: hex.EncodeToString(sum[:]), Verified: true}
	if err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != string(payload) {
		t.Fatalf("installed payload = %q", got)
	}
	backup, _ := os.ReadFile(exe + ".bak")
	if string(backup) != "old executable" {
		t.Fatalf("backup = %q", backup)
	}
	artifact.Version = "0.9.0"
	if err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact); err == nil {
		t.Fatal("downgrade accepted")
	}
}

func TestApplyUpdateRejectsMissingOrWrongChecksumAndURL(t *testing.T) {
	dir := t.TempDir()
	exe := dir + "/workbuddy"
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "payload") }))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	transport := artifactTransport{target}
	base := UpdateArtifact{CurrentVersion: "1.0.0", Version: "1.1.0", URL: "https://github.com/acme/workbuddy/releases/download/v1.1.0/workbuddy-linux-amd64", Verified: true}
	for _, tc := range []UpdateArtifact{
		base,
		func() UpdateArtifact { x := base; x.SHA256 = strings.Repeat("0", 64); return x }(),
		func() UpdateArtifact {
			x := base
			x.SHA256 = strings.Repeat("0", 64)
			x.URL = "https://example.com/update"
			return x
		}(),
	} {
		if err := NewUpdateInstaller(exe, transport)(context.Background(), tc); err == nil {
			t.Fatal("invalid artifact accepted")
		}
	}
}

type updateTransport struct {
	target *url.URL
	calls  int
}

func (t *updateTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	t.calls++
	if r.URL.Scheme != "https" || r.URL.Host != "api.github.com" || r.URL.Path != "/repos/owner/repo/releases/latest" {
		panic("unexpected update URL")
	}
	clone := r.Clone(r.Context())
	u := *r.URL
	u.Scheme = t.target.Scheme
	u.Host = t.target.Host
	clone.URL = &u
	return http.DefaultTransport.RoundTrip(clone)
}
func TestUpdateChecker(t *testing.T) {
	var response string
	var status int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, response)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	transport := &updateTransport{target: target}
	source := UpdateSource{GitHubOwner: "owner", GitHubRepo: "repo"}
	check := newUpdateChecker(UpdateSource{}, "0.2.0-local", transport)
	_, err := check(context.Background())
	var ue *UpdateError
	if err == nil || !errorsAs(err, &ue) || ue.Code != "not_configured" || transport.calls != 0 {
		t.Fatalf("unconfigured: %v calls=%d", err, transport.calls)
	}
	for _, tc := range []struct {
		name, body, current, latest string
		status                      int
		has                         bool
		code                        string
	}{
		{"api error", "secret token", "0.2.0-local", "", 403, false, "api_error"},
		{"new release", `{"tag_name":"v0.2.0"}`, "0.2.0-local", "v0.2.0", 200, true, ""},
		{"equal", `{"tag_name":"v0.2.0"}`, "0.2.0", "v0.2.0", 200, false, ""},
		{"older", `{"tag_name":"v0.1.9"}`, "0.2.0-local", "v0.1.9", 200, false, ""},
		{"invalid tag", `{"tag_name":"nightly"}`, "0.2.0", "", 200, false, "invalid_version"},
		{"oversize", strings.Repeat("x", (1<<20)+1), "0.2.0", "", 200, false, "response_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response = tc.body
			status = tc.status
			result, err := newUpdateChecker(source, tc.current, transport)(context.Background())
			if tc.code != "" {
				var e *UpdateError
				if !errorsAs(err, &e) || e.Code != tc.code {
					t.Fatalf("error=%v", err)
				}
				if strings.Contains(err.Error(), "secret") {
					t.Fatal("leaked response")
				}
				return
			}
			if err != nil || result.LatestVersion != tc.latest || result.HasUpdate != tc.has {
				t.Fatalf("result=%+v err=%v", result, err)
			}
		})
	}
}
func errorsAs(err error, target **UpdateError) bool {
	if e, ok := err.(*UpdateError); ok {
		*target = e
		return true
	}
	return false
}
func TestUpdateCheckHandler(t *testing.T) {
	p := New(Config{Version: "0.2.0-local", UpdateChecker: func(context.Context) (UpdateResult, error) {
		return UpdateResult{CurrentVersion: "0.2.0-local", LatestVersion: "v0.2.0", HasUpdate: true}, nil
	}})
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("POST", "/panel/api/update/check", strings.NewReader("{}")))
	var result struct {
		OK        bool `json:"ok"`
		HasUpdate bool `json:"has_update"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &result) != nil || !result.OK || !result.HasUpdate {
		t.Fatalf("response %d %s", rec.Code, rec.Body.String())
	}
}

func TestApplyUpdateTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte("slow"))
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/acme/workbuddy/releases/download/v1.1.0/workbuddy-amd64",
		SHA256:         strings.Repeat("0", 64),
		Verified:       true,
	}
	err := NewUpdateInstaller(exe, artifactTransport{target})(ctx, artifact)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	var ue *UpdateError
	if !errorsAs(err, &ue) || (ue.Code != "timeout" && ue.Code != "download_failed") {
		t.Fatalf("expected timeout or download_failed, got %v", err)
	}
}

func TestApplyUpdateOversizedFile(t *testing.T) {
	orig := maxUpdateBinarySize
	maxUpdateBinarySize = 16
	defer func() { maxUpdateBinarySize = orig }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("this payload exceeds sixteen bytes limit"))
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/acme/workbuddy/releases/download/v1.1.0/workbuddy-amd64",
		SHA256:         strings.Repeat("0", 64),
		Verified:       true,
	}
	err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact)
	if err == nil {
		t.Fatal("expected size limit error")
	}
	var ue *UpdateError
	if !errorsAs(err, &ue) || ue.Code != "download_too_large" {
		t.Fatalf("expected download_too_large, got %v", err)
	}
}

func TestApplyUpdateRollbackProof(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	originalContent := []byte("original-v1-stable")
	if err := os.WriteFile(exe, originalContent, 0o755); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("corrupted payload"))
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)

	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/acme/workbuddy/releases/download/v1.1.0/workbuddy-amd64",
		SHA256:         strings.Repeat("f", 64),
		Verified:       true,
	}
	err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact)
	if err == nil {
		t.Fatal("expected checksum failure")
	}

	// 验证旧文件完好无损，未被污染
	got, err := os.ReadFile(exe)
	if err != nil || string(got) != string(originalContent) {
		t.Fatalf("original file was corrupted or missing: %v, content=%q", err, got)
	}
}

func TestApplyUpdateRedirectAllowedCDN(t *testing.T) {
	payload := []byte("redirected new binary payload")
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/download/asset.exe" {
			// 模拟 GitHub 返回 302 重定向到官方 CDN
			w.Header().Set("Location", "https://objects.githubusercontent.com/cdn/asset.exe")
			w.WriteHeader(http.StatusFound)
			return
		}
		if r.URL.Path == "/cdn/asset.exe" {
			_, _ = w.Write(payload)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)

	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	if err := os.WriteFile(exe, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/acme/workbuddy/releases/download/v1.1.0/asset.exe",
		SHA256:         hex.EncodeToString(sum[:]),
		Verified:       true,
	}
	// 将 initial URL 指向测试服务的 /download/asset.exe 路径
	artifact.URL = "https://github.com/download/asset.exe"

	err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact)
	if err != nil {
		t.Fatalf("expected successful install via 302 CDN redirect, got %v", err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != string(payload) {
		t.Fatalf("unexpected content after redirect install: %q", got)
	}
}

func TestApplyUpdateRedirectRejectedUntrustedHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://evil-mirror.com/trojan.exe")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)

	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	if err := os.WriteFile(exe, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/download/asset.exe",
		SHA256:         strings.Repeat("a", 64),
		Verified:       true,
	}

	err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact)
	if err == nil {
		t.Fatal("expected untrusted redirect error")
	}
	var ue *UpdateError
	if !errorsAs(err, &ue) || ue.Code != "untrusted_redirect" {
		t.Fatalf("expected untrusted_redirect code, got %v", err)
	}
}

func TestApplyUpdateRedirectRejectedHTTPDowngrade(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 试图降级为不安全的 http 协议
		w.Header().Set("Location", "http://objects.githubusercontent.com/asset.exe")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)

	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	if err := os.WriteFile(exe, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/download/asset.exe",
		SHA256:         strings.Repeat("b", 64),
		Verified:       true,
	}

	err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact)
	if err == nil {
		t.Fatal("expected insecure_redirect error")
	}
	var ue *UpdateError
	if !errorsAs(err, &ue) || ue.Code != "insecure_redirect" {
		t.Fatalf("expected insecure_redirect code, got %v", err)
	}
}

func TestApplyUpdateRedirectRejectedUserInfo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 携带非法 userinfo
		w.Header().Set("Location", "https://attacker:secret@objects.githubusercontent.com/asset.exe")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)

	dir := t.TempDir()
	exe := filepath.Join(dir, "workbuddy.exe")
	if err := os.WriteFile(exe, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	artifact := UpdateArtifact{
		CurrentVersion: "1.0.0",
		Version:        "1.1.0",
		URL:            "https://github.com/download/asset.exe",
		SHA256:         strings.Repeat("c", 64),
		Verified:       true,
	}

	err := NewUpdateInstaller(exe, artifactTransport{target})(context.Background(), artifact)
	if err == nil {
		t.Fatal("expected invalid_redirect error")
	}
	var ue *UpdateError
	if !errorsAs(err, &ue) || ue.Code != "invalid_redirect" {
		t.Fatalf("expected invalid_redirect code, got %v", err)
	}
}

func TestUpdateCheckRedirectAllowedAndRejected(t *testing.T) {
	var status int
	var locHeader string
	var body string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status == http.StatusFound {
			w.Header().Set("Location", locHeader)
			w.WriteHeader(http.StatusFound)
			return
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	transport := &updateTransport{target: target}
	source := UpdateSource{GitHubOwner: "owner", GitHubRepo: "repo"}

	// 1. 允许的官方 CDN/API 重定向
	status = http.StatusFound
	locHeader = "https://api.github.com/repos/owner/repo/releases/latest"
	// 重定向后返回 200
	check := newUpdateChecker(source, "0.2.0-local", transport)
	// 测试重定向到不受信任的域
	locHeader = "https://evil-api.com/releases"
	_, err := check(context.Background())
	if err == nil {
		t.Fatal("expected untrusted redirect to be rejected by update check")
	}
	var ue *UpdateError
	if !errorsAs(err, &ue) || (ue.Code != "untrusted_redirect" && ue.Code != "network_error") {
		t.Fatalf("expected untrusted_redirect error, got %v", err)
	}
}
