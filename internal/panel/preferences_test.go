package panel

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMinimalPreferencesPersistsThemeAndGuard(t *testing.T) {
	p := pool.New("")
	p.SetBalanceGuard(100)
	var cfg = map[string]any{"panel": map[string]any{"theme": "dark"}}
	pn := New(Config{Pool: p, LoadConfig: func() (any, error) { return cfg, nil }, SaveConfig: func(raw []byte) ([]string, error) {
		var patch map[string]any
		json.Unmarshal(raw, &patch)
		for key, value := range patch {
			section, _ := cfg[key].(map[string]any)
			if section == nil {
				section = map[string]any{}
			}
			incoming, _ := value.(map[string]any)
			for field, fieldValue := range incoming {
				section[field] = fieldValue
			}
			cfg[key] = section
		}
		return nil, nil
	}})
	w := httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"credit_guard_low":123,"theme":"light"}`)))
	if w.Code != 200 || p.BalanceGuard() != 123 || !strings.Contains(w.Body.String(), `"theme":"light"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"credit_guard_low":0,"theme":"dark"}`)))
	if w.Code != 400 || p.BalanceGuard() != 123 {
		t.Fatal("invalid threshold committed")
	}
	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"theme":"auto"}`)))
	if w.Code != 200 || p.BalanceGuard() != 123 || !strings.Contains(w.Body.String(), `"theme":"auto"`) {
		t.Fatal("theme-only save failed:", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"credit_guard_low":456}`)))
	if w.Code != 200 || p.BalanceGuard() != 456 || !strings.Contains(w.Body.String(), `"theme":"auto"`) {
		t.Fatal("threshold-only save failed:", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{}`)))
	if w.Code != 400 || p.BalanceGuard() != 456 {
		t.Fatal("empty preferences committed")
	}
}

func TestPreferencesPersistAnimationStyle(t *testing.T) {
	p := pool.New("")
	p.SetBalanceGuard(100)
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := map[string]any{"panel": map[string]any{"theme": "dark"}}
	write := func() {
		raw, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	pn := New(Config{
		Pool:       p,
		ConfigPath: path,
		LoadConfig: func() (any, error) { return cfg, nil },
		SaveConfig: func(raw []byte) ([]string, error) {
			var patch map[string]any
			if err := json.Unmarshal(raw, &patch); err != nil {
				return nil, err
			}
			section, _ := cfg["panel"].(map[string]any)
			if section == nil {
				section = map[string]any{}
			}
			incoming, _ := patch["panel"].(map[string]any)
			for field, value := range incoming {
				section[field] = value
			}
			cfg["panel"] = section
			if value, ok := patch["pool"].(map[string]any); ok {
				cfg["pool"] = value
			}
			write()
			return nil, nil
		},
	})

	for _, style := range []string{"names", "orbital", "scan", "minimal"} {
		w := httptest.NewRecorder()
		pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"animation_style":"`+style+`"}`)))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"animation_style":"`+style+`"`) {
			t.Fatalf("animation-only save failed for %s: %d %s", style, w.Code, w.Body.String())
		}
		if got := cfg["panel"].(map[string]any)["startup_animation"]; got != style {
			t.Fatalf("saved startup_animation=%v want %s", got, style)
		}
	}

	w := httptest.NewRecorder()
	pn.preferencesGet(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"animation_style":"minimal"`) {
		t.Fatalf("animation preference was not echoed: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"animation_style":"bounce"}`)))
	if w.Code != 400 || !strings.Contains(w.Body.String(), "invalid animation_style") {
		t.Fatalf("invalid animation style accepted: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"theme":"auto"}`)))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"theme":"auto"`) || !strings.Contains(w.Body.String(), `"animation_style":"minimal"`) {
		t.Fatalf("theme-only save clobbered animation: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	pn.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"credit_guard_low":321}`)))
	if w.Code != 200 || p.BalanceGuard() != 321 || !strings.Contains(w.Body.String(), `"animation_style":"minimal"`) {
		t.Fatalf("threshold-only save failed: %d %s", w.Code, w.Body.String())
	}
}

func TestPreferencesAnimationStyleDefaultsToNames(t *testing.T) {
	p := pool.New("")
	p.SetBalanceGuard(100)
	pn := New(Config{Pool: p, LoadConfig: func() (any, error) { return map[string]any{"panel": map[string]any{"theme": "dark"}}, nil }})
	w := httptest.NewRecorder()
	pn.preferencesGet(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"animation_style":"names"`) {
		t.Fatalf("default animation style missing: %d %s", w.Code, w.Body.String())
	}
}
