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
	if !strings.Contains(text, `type="module"`) || !strings.Contains(text, `src="/panel/app.js"`) {
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
	cmd := exec.Command(node, "--test", "frontend_api_contract_test.mjs", "frontend_csp_event_proxy_test.mjs", "frontend_delete_cancel_test.mjs", "frontend_geometry_contract_test.mjs", "frontend_production_entry_test.mjs", "frontend_task_button_test.mjs", "frontend_egress_test.mjs", "frontend_model_refresh_test.mjs", "frontend_audio_cycle_test.mjs", "frontend_animation_performance_test.mjs", "frontend_session_regression_test.mjs")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("frontend module contracts failed: %v\n%s", err, out)
	}
	t.Log(string(out))
}

// Only the geometric interface and its dependencies may be shipped.
func TestSingleFrontendAssets(t *testing.T) {
	page := string(indexHTML)
	for _, legacy := range []string{"v02-compatibility-layer", "view-overview", "glass-nav", "/panel/assets/styles.css"} {
		if strings.Contains(page, legacy) {
			t.Errorf("legacy frontend present: %s", legacy)
		}
	}
	if !strings.Contains(page, "main-world-canvas") {
		t.Fatal("geometric frontend missing")
	}
	for _, path := range []string{"assets/styles.css", "assets/router.js", "assets/auth.js"} {
		if _, err := assetFS.ReadFile(path); err == nil {
			t.Errorf("legacy asset embedded: %s", path)
		}
	}
	for _, path := range []string{"assets/tailwind.css", "assets/geometric.js", "assets/editorial-events.js"} {
		if _, err := assetFS.ReadFile(path); err != nil {
			t.Errorf("required asset %s: %v", path, err)
		}
	}
}
