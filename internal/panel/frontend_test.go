package panel

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Parse every shipped ES module: go:embed does not validate JavaScript.
func TestAppJSSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required for frontend verification: ", err)
	}
	paths, err := filepath.Glob("assets/*.js")
	if err != nil {
		t.Fatal(err)
	}
	paths = append(paths, "app.js")
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(node, "--input-type=module", "--check")
		cmd.Stdin = bytes.NewReader(body)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s syntax: %v\n%s", path, err, out)
		}
	}
}

func TestIndexHTMLNoInlineScript(t *testing.T) {
	body, err := os.ReadFile("index.html")
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, tag := range regexp.MustCompile(`<script\b[^>]*>`).FindAllString(text, -1) {
		if !strings.Contains(tag, `src=`) {
			t.Fatalf("inline script blocked by CSP: %s", tag)
		}
	}
	if regexp.MustCompile(`\son(?:click|submit|input|change)=`).MatchString(text) {
		t.Fatal("inline event handler blocked by CSP")
	}
	if !strings.Contains(text, `type="module"`) || !strings.Contains(text, `src="app.js"`) {
		t.Fatal("external ES module entry is missing")
	}
}

// Execute the actual modules, not extracted source slices. Removed search/filter,
// batch actions and raw CFG_MAP tests are replaced by v0.2 behavioral contracts.
// Kept semantics include auth/CSRF, numeric formatting, rate-limit reasons,
// archive authority, expiry ordering/clamping, display-only model policy, bounded
// DOM, visibility cancellation and the new real Meta/maintenance endpoints.
func TestFrontendModules(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required for frontend verification: ", err)
	}
	cmd := exec.Command(node, "--test", "frontend_modules_test.mjs", "frontend_pool_test.mjs", "frontend_preview_test.mjs", "frontend_v02_test.mjs", "frontend_startup_test.mjs", "frontend_animation_settings_test.mjs", "frontend_subscriptions_test.mjs", "frontend_logs_errors_test.mjs")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("frontend module contracts failed: %v\n%s", err, out)
	}
	t.Log(string(out))
}
