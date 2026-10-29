package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

type UpdateSource struct {
	GitHubOwner string `json:"github_owner"`
	GitHubRepo  string `json:"github_repo"`
	Channel     string `json:"channel"`
}
type UpdateResult struct {
	CurrentVersion string          `json:"current_version"`
	LatestVersion  string          `json:"latest_version"`
	HasUpdate      bool            `json:"has_update"`
	Artifact       *UpdateArtifact `json:"artifact,omitempty"`
}

// UpdateArtifact 是一次受固定 release 检查产生的、可安装的工件。
// URL 与摘要均来自检查响应，apply 不接受客户端提供的任意地址。
type UpdateArtifact struct {
	CurrentVersion string `json:"current_version,omitempty"`
	Version        string `json:"version"`
	Tag            string `json:"tag"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	SHA256         string `json:"sha256"`
	Verified       bool   `json:"verified"`
}

type UpdateApplier func(context.Context, UpdateArtifact) error

type updateAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
}
type UpdateError struct {
	Code    string
	Message string
}

func (e *UpdateError) Error() string         { return e.Message }
func updateError(code, message string) error { return &UpdateError{Code: code, Message: message} }

type UpdateChecker func(context.Context) (UpdateResult, error)

var repositoryPart = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$`)
var semverPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$`)
var maxUpdateBinarySize int64 = 512 << 20

type semVersion struct {
	core [3]*big.Int
	pre  []string
}

func parseUpdateVersion(s string) (semVersion, error) {
	var v semVersion
	m := semverPattern.FindStringSubmatch(s)
	if m == nil {
		return v, errors.New("invalid version")
	}
	for i := range v.core {
		v.core[i], _ = new(big.Int).SetString(m[i+1], 10)
	}
	if m[4] != "" {
		v.pre = strings.Split(m[4], ".")
		for _, p := range v.pre {
			if p == "" || numeric(p) && len(p) > 1 && p[0] == '0' {
				return v, errors.New("invalid prerelease")
			}
		}
	}
	return v, nil
}
func numeric(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}
func compareUpdateVersions(a, b semVersion) int {
	for i := range a.core {
		if c := a.core[i].Cmp(b.core[i]); c != 0 {
			return c
		}
	}
	if len(a.pre) == 0 && len(b.pre) > 0 {
		return 1
	}
	if len(a.pre) > 0 && len(b.pre) == 0 {
		return -1
	}
	for i := 0; i < len(a.pre) && i < len(b.pre); i++ {
		x, y := a.pre[i], b.pre[i]
		if x == y {
			continue
		}
		if numeric(x) && numeric(y) {
			xx, _ := new(big.Int).SetString(x, 10)
			yy, _ := new(big.Int).SetString(y, 10)
			return xx.Cmp(yy)
		}
		if numeric(x) {
			return -1
		}
		if numeric(y) {
			return 1
		}
		if x < y {
			return -1
		}
		return 1
	}
	if len(a.pre) < len(b.pre) {
		return -1
	}
	if len(a.pre) > len(b.pre) {
		return 1
	}
	return 0
}

// NewUpdateChecker always contacts the official GitHub API, without following redirects.
func NewUpdateChecker(source UpdateSource, current string) UpdateChecker {
	return newUpdateChecker(source, current, http.DefaultTransport)
}
func newUpdateChecker(source UpdateSource, current string, transport http.RoundTripper) UpdateChecker {
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: safeUpdateRedirect}
	return func(ctx context.Context) (UpdateResult, error) {
		result := UpdateResult{CurrentVersion: current}
		if source.GitHubOwner == "" || source.GitHubRepo == "" {
			return result, updateError("not_configured", "update source is not configured")
		}
		if !repositoryPart.MatchString(source.GitHubOwner) || !repositoryPart.MatchString(source.GitHubRepo) || strings.HasSuffix(source.GitHubRepo, ".git") {
			return result, updateError("invalid_config", "invalid GitHub owner or repository")
		}
		if source.Channel != "" && source.Channel != "stable" {
			return result, updateError("invalid_config", "unsupported update channel")
		}
		old, err := parseUpdateVersion(current)
		if err != nil {
			return result, updateError("invalid_version", "current version is invalid")
		}
		url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", source.GitHubOwner, source.GitHubRepo)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return result, updateError("invalid_config", "invalid update source")
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "WorkBuddy-update-check")
		resp, err := client.Do(req)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return result, updateError("timeout", "GitHub request timed out")
			}
			return result, updateError("network_error", "GitHub request failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return result, updateError("api_error", fmt.Sprintf("GitHub API returned HTTP %d", resp.StatusCode))
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
		if err != nil {
			return result, updateError("network_error", "GitHub response could not be read")
		}
		if len(data) > 1<<20 {
			return result, updateError("response_too_large", "GitHub response exceeds 1 MiB")
		}
		var release struct {
			Tag        string        `json:"tag_name"`
			Draft      bool          `json:"draft"`
			Prerelease bool          `json:"prerelease"`
			Assets     []updateAsset `json:"assets"`
		}
		if json.Unmarshal(data, &release) != nil || release.Draft || release.Prerelease {
			return result, updateError("invalid_release", "invalid stable release response")
		}
		latest, err := parseUpdateVersion(release.Tag)
		if err != nil {
			return result, updateError("invalid_version", "release tag is not a semantic version")
		}
		result.LatestVersion = release.Tag
		result.HasUpdate = compareUpdateVersions(latest, old) > 0
		if result.HasUpdate {
			if a := selectUpdateAsset(release.Tag, release.Assets); a != nil {
				if a.SHA256 == "" {
					for _, asset := range release.Assets {
						if strings.EqualFold(asset.Name, a.Name+".sha256") || strings.Contains(strings.ToLower(asset.Name), "checksums") {
							if sum, ok := fetchUpdateChecksum(ctx, client, asset.URL, a.Name, strings.EqualFold(asset.Name, a.Name+".sha256")); ok {
								a.SHA256, a.Verified = sum, true
							}
							break
						}
					}
				}
				if a.Verified {
					a.CurrentVersion = current
					result.Artifact = a
				}
			}
		}
		return result, nil
	}
}

func fetchUpdateChecksum(ctx context.Context, client *http.Client, rawURL, name string, single bool) (string, bool) {
	if rawURL == "" {
		return "", false
	}
	if !isAllowedUpdateURL(rawURL) {
		return "", false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", false
	}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return "", false
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return "", false
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if len(fields) == 1 && !single {
			continue
		}
		if len(fields) > 1 && strings.TrimPrefix(fields[1], "*") != name {
			continue
		}
		sum := strings.TrimPrefix(strings.ToLower(fields[0]), "sha256:")
		if len(sum) == 64 {
			if _, err := hex.DecodeString(sum); err == nil {
				return sum, true
			}
		}
	}
	return "", false
}

func selectUpdateAsset(tag string, assets []updateAsset) *UpdateArtifact {
	platform, arch := runtime.GOOS, runtime.GOARCH
	var bin updateAsset
	for _, a := range assets {
		n := strings.ToLower(a.Name)
		// Only explicitly named standalone service executables are installable.
		// Release packages and unrelated platform assets must never replace the binary.
		expected := []string{"wb2api-" + platform + "-" + arch, "workbuddy-" + platform + "-" + arch}
		if platform == "windows" {
			expected[0] += ".exe"
			expected[1] += ".exe"
		}
		okPlatform, okArch := false, false
		for _, name := range expected {
			if n == name {
				okPlatform, okArch = true, true
			}
		}
		if okPlatform && okArch {
			bin = a
			break
		}
	}
	if bin.Name == "" || bin.URL == "" {
		return nil
	}
	digest := strings.TrimSpace(bin.Digest)
	if strings.HasPrefix(strings.ToLower(digest), "sha256:") {
		digest = digest[len("sha256:"):]
	}
	if !regexp.MustCompile(`^[0-9a-fA-F]{64}$`).MatchString(digest) {
		digest = ""
	}
	return &UpdateArtifact{Version: tag, Tag: tag, Name: bin.Name, URL: bin.URL, SHA256: digest, Verified: len(digest) == 64}
}

// NewUpdateInstaller returns a safe installer for the current executable.
func NewUpdateInstaller(executable string, transport http.RoundTripper) UpdateApplier {
	if transport == nil {
		transport = http.DefaultTransport
	}
	return func(ctx context.Context, a UpdateArtifact) error { return applyUpdate(ctx, executable, a, transport) }
}

func applyUpdate(ctx context.Context, executable string, a UpdateArtifact, transport http.RoundTripper) error {
	if !a.Verified || a.URL == "" || a.SHA256 == "" {
		return updateError("unverified_artifact", "update artifact was not verified by update check")
	}
	want, err := hex.DecodeString(strings.TrimSpace(a.SHA256))
	if err != nil || len(want) != sha256.Size {
		return updateError("invalid_checksum", "update checksum is invalid")
	}
	if !isAllowedUpdateURL(a.URL) {
		return updateError("invalid_url", "update URL must use HTTPS")
	}
	if a.CurrentVersion != "" {
		old, e1 := parseUpdateVersion(a.CurrentVersion)
		newer, e2 := parseUpdateVersion(a.Version)
		if e1 != nil || e2 != nil || compareUpdateVersions(newer, old) <= 0 {
			return updateError("version_rejected", "update version is not newer than the current version")
		}
	}
	if executable == "" {
		executable, err = os.Executable()
		if err != nil {
			return updateError("executable_unavailable", "current executable path is unavailable")
		}
	}
	if st, e := os.Stat(executable); e != nil || st.IsDir() {
		return updateError("executable_unavailable", "current executable is unavailable")
	}
	client := &http.Client{Transport: transport, Timeout: 2 * time.Minute, CheckRedirect: safeUpdateRedirect}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return updateError("invalid_url", "update URL is invalid")
	}
	resp, err := client.Do(req)
	if err != nil {
		var ue *UpdateError
		if errors.As(err, &ue) {
			return ue
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return updateError("timeout", "update download timed out")
		}
		return updateError("download_failed", "update download failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return updateError("download_failed", "update download returned an error")
	}
	dir := filepath.Dir(executable)
	f, err := os.CreateTemp(dir, ".workbuddy-update-*")
	if err != nil {
		return updateError("disk_error", "could not create update file")
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	h := sha256.New()
	n, err := io.CopyN(io.MultiWriter(f, h), resp.Body, maxUpdateBinarySize+1)
	if err != nil && err != io.EOF {
		f.Close()
		if errors.Is(err, context.DeadlineExceeded) {
			return updateError("timeout", "update download timed out")
		}
		return updateError("download_failed", "update download failed")
	}
	if n > maxUpdateBinarySize {
		f.Close()
		return updateError("download_too_large", "update exceeds size limit")
	}
	if !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), hex.EncodeToString(want)) {
		f.Close()
		return updateError("checksum_mismatch", "update checksum mismatch")
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return updateError("disk_error", "could not flush update file")
	}
	if err := f.Close(); err != nil {
		return updateError("disk_error", "could not close update file")
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		return updateError("disk_error", "could not set update permissions")
	}
	backup := executable + ".bak"
	if _, statErr := os.Lstat(backup); statErr == nil {
		return updateError("backup_exists", "existing executable backup must be resolved before installing")
	} else if !os.IsNotExist(statErr) {
		return updateError("disk_error", "could not inspect executable backup")
	}
	if err := os.Rename(executable, backup); err != nil {
		return updateError("replace_failed", "could not backup current executable")
	}
	if err := os.Rename(tmp, executable); err != nil {
		rollbackErr := os.Rename(backup, executable)
		if rollbackErr != nil {
			return updateError("replace_failed_rollback_failed", fmt.Sprintf("update replace failed (%v) and rollback failed (%v)", err, rollbackErr))
		}
		return updateError("replace_failed", fmt.Sprintf("could not install update, rolled back to original: %v", err))
	}
	return nil
}

func isAllowedUpdateURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "github.com" || host == "objects.githubusercontent.com" || host == "release-assets.githubusercontent.com" || host == "github-releases.githubusercontent.com"
}

func safeUpdateRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return updateError("too_many_redirects", "stopped after 10 redirects")
	}
	if req.URL == nil {
		return updateError("invalid_redirect", "redirect URL is missing")
	}
	if req.URL.Scheme != "https" {
		return updateError("insecure_redirect", "redirects must use HTTPS")
	}
	if req.URL.User != nil {
		return updateError("invalid_redirect", "redirect URL must not contain user credentials")
	}
	host := strings.ToLower(req.URL.Hostname())
	allowed := host == "github.com" || host == "api.github.com" || host == "objects.githubusercontent.com" || host == "release-assets.githubusercontent.com" || host == "github-releases.githubusercontent.com"
	if !allowed {
		return updateError("untrusted_redirect", fmt.Sprintf("redirect to untrusted host %q is forbidden", host))
	}
	return nil
}
