package server

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/modelpolicy"
	"net/http"
)

func (h *Handler) modelPolicyGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"models": h.cfg.ModelPolicy.Snapshot()})
}
func (h *Handler) modelPolicySet(w http.ResponseWriter, r *http.Request) {
	var v struct {
		ID string `json:"id"`
		modelpolicy.Rule
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&v) != nil {
		writeOpenAIError(w, 400, "invalid_request", "invalid model policy")
		return
	}
	if err := h.cfg.ModelPolicy.Set(v.ID, v.Rule); err != nil {
		writeOpenAIError(w, 400, "invalid_request", err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
