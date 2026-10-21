package tasks

import (
	"encoding/json"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	raw, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": msg})
}
func (p *Service) TasksScanAll(w http.ResponseWriter, r *http.Request) {
	result, err := p.Scan(r.Context())
	if err != nil {
		status := http.StatusServiceUnavailable
		if r.Context().Err() != nil {
			status = http.StatusRequestTimeout
		}
		writeErr(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
