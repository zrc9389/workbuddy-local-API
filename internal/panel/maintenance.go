package panel

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/maintenance"
	"net/http"
	"os"
)

var animationStyles = map[string]bool{"names": true, "orbital": true, "scan": true, "minimal": true}

func normalizeAnimationStyle(style string) string {
	if animationStyles[style] {
		return style
	}
	return "names"
}

// savedAnimationStyle reads the raw config so a preference that the typed
// Config does not model yet survives the config loader round trip.
func (p *Panel) savedAnimationStyle() string {
	if p.cfg.ConfigPath == "" {
		return "names"
	}
	raw, err := os.ReadFile(p.cfg.ConfigPath)
	if err != nil {
		return "names"
	}
	var v struct {
		Panel struct {
			StartupAnimation string `json:"startup_animation"`
		} `json:"panel"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return "names"
	}
	return normalizeAnimationStyle(v.Panel.StartupAnimation)
}

func (p *Panel) maintenanceStatus(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Maintenance == nil {
		writeJSON(w, 200, maintenance.Status{Steps: []maintenance.Step{}})
		return
	}
	writeJSON(w, 200, p.cfg.Maintenance.Status())
}
func (p *Panel) maintenanceRun(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Maintenance == nil {
		writeErr(w, 503, "maintenance unavailable")
		return
	}
	if !p.cfg.Maintenance.Start() {
		writeErr(w, 409, "maintenance already running")
		return
	}
	writeJSON(w, 202, p.cfg.Maintenance.Status())
}
func (p *Panel) toggleDisabled(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Disabled *bool `json:"disabled"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&v) != nil || v.Disabled == nil {
		writeErr(w, 400, "disabled boolean required")
		return
	}
	if !p.cfg.Pool.SetManualDisabled(r.PathValue("uid"), *v.Disabled) {
		writeErr(w, 404, "account not found")
		return
	}
	p.cfg.Pool.Flush()
	st, _ := p.cfg.Pool.Status(r.PathValue("uid"))
	writeJSON(w, 200, map[string]any{"ok": true, "account": st})
}
func (p *Panel) preferencesGet(w http.ResponseWriter, r *http.Request) {
	theme := "dark"
	animationStyle := p.savedAnimationStyle()
	if p.cfg.LoadConfig != nil {
		cfg, e := p.cfg.LoadConfig()
		if e != nil {
			writeErr(w, 500, "could not read saved preferences")
			return
		}
		raw, e := json.Marshal(cfg)
		if e != nil {
			writeErr(w, 500, "could not read saved preferences")
			return
		}
		var v struct {
			Panel struct {
				Theme            string `json:"theme"`
				StartupAnimation string `json:"startup_animation"`
			} `json:"panel"`
		}
		_ = json.Unmarshal(raw, &v)
		if v.Panel.Theme != "" {
			theme = v.Panel.Theme
		}
		if v.Panel.StartupAnimation != "" {
			animationStyle = normalizeAnimationStyle(v.Panel.StartupAnimation)
		}
	}
	writeJSON(w, 200, map[string]any{"credit_guard_low": p.cfg.Pool.BalanceGuard(), "theme": theme, "animation_style": animationStyle})
}
func (p *Panel) preferencesSet(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Low            *int64 `json:"credit_guard_low"`
		Theme          string `json:"theme"`
		AnimationStyle string `json:"animation_style"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&v) != nil {
		writeErr(w, 400, "invalid preferences")
		return
	}
	if v.Low == nil && v.Theme == "" && v.AnimationStyle == "" {
		writeErr(w, 400, "preferences required")
		return
	}
	if v.Low != nil && (*v.Low < 1 || *v.Low > 1000000) {
		writeErr(w, 400, "invalid credit_guard_low")
		return
	}
	if v.Theme != "" && v.Theme != "dark" && v.Theme != "light" && v.Theme != "auto" {
		writeErr(w, 400, "invalid theme")
		return
	}
	if v.AnimationStyle != "" && !animationStyles[v.AnimationStyle] {
		writeErr(w, 400, "invalid animation_style")
		return
	}
	if p.cfg.SaveConfig == nil {
		writeErr(w, 503, "settings unavailable")
		return
	}
	patch := map[string]any{}
	if v.Low != nil {
		patch["pool"] = map[string]any{"credit_floor": *v.Low}
	}
	panelPatch := map[string]any{}
	if v.Theme != "" {
		panelPatch["theme"] = v.Theme
	}
	if v.AnimationStyle != "" {
		panelPatch["startup_animation"] = v.AnimationStyle
	}
	if len(panelPatch) > 0 {
		patch["panel"] = panelPatch
	}
	raw, _ := json.Marshal(patch)
	if _, e := p.cfg.SaveConfig(raw); e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	if v.Low != nil {
		p.cfg.Pool.SetBalanceGuard(*v.Low)
	}
	p.preferencesGet(w, r)
}
