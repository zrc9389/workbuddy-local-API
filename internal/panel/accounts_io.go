package panel

import (
	"encoding/json"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxCredentialImportBytes = 2 << 20
const maxCredentialImportAccounts = 100
const maxCredentialExportBytes = 8 << 20

func safeCredentialPath(dir, path string) error {
	root, err := filepath.Abs(dir)
	if err != nil || strings.TrimSpace(dir) == "" {
		return errors.New("invalid auth directory")
	}
	full, err := filepath.Abs(path)
	if err != nil {
		return errors.New("invalid credential path")
	}
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return errors.New("credential path outside auth directory")
	}
	// Imported credentials must be direct children, not attacker-controlled nested paths.
	if filepath.Dir(full) != root {
		return errors.New("invalid credential path")
	}
	for _, p := range []string{full, full + ".tmp"} {
		st, err := os.Lstat(p)
		if err != nil && !os.IsNotExist(err) {
			return errors.New("cannot inspect credential path")
		}
		if err == nil && (!st.Mode().IsRegular() || st.Mode()&os.ModeSymlink != 0) {
			return errors.New("unsafe credential path")
		}
	}
	return nil
}

// AccountsExport explicitly returns secrets, only under the parent's authenticated route.
// Do not log this payload or include it in normal account listings.
func (p *Panel) AccountsExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if p.cfg.Pool == nil {
		writeErr(w, 503, "account pool unavailable")
		return
	}
	states := p.cfg.Pool.List()
	if len(states) > 1000 {
		writeErr(w, 413, "too many accounts to export")
		return
	}
	docs := make([]json.RawMessage, 0, len(states))
	size := 2
	for _, st := range states {
		if r.Context().Err() != nil {
			writeErr(w, 408, "request cancelled")
			return
		}
		a := p.cfg.Pool.AuthByUID(st.UID)
		if a == nil {
			continue
		}
		raw, err := a.ExportJSON()
		if err != nil {
			writeErr(w, 500, "could not export account")
			return
		}
		size += len(raw) + 1
		if size > maxCredentialExportBytes {
			writeErr(w, 413, "credential export exceeds size limit")
			return
		}
		docs = append(docs, raw)
	}
	w.Header().Set("Content-Disposition", `attachment; filename="workbuddy-accounts.json"`)
	writeJSON(w, 200, docs)
}

// AccountsImport accepts the existing nested or flat auth format as one object or an array.
// All entries are validated before writes. Disk failures may yield a documented partial result;
// successful writes are never silently rolled back, and this operation performs no upstream I/O.
func (p *Panel) AccountsImport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p.cfg.Pool == nil || p.cfg.AuthDir == "" {
		writeErr(w, 503, "credential storage unavailable")
		return
	}
	var raw json.RawMessage
	if decodeSingleJSON(w, r, maxCredentialImportBytes, &raw) != nil {
		writeErr(w, 400, "invalid or oversized credential JSON")
		return
	}
	raw = json.RawMessage(strings.TrimSpace(string(raw)))
	var docs []json.RawMessage
	if len(raw) > 0 && raw[0] == '{' {
		docs = []json.RawMessage{raw}
	} else if len(raw) > 0 && raw[0] == '[' {
		if json.Unmarshal(raw, &docs) != nil {
			writeErr(w, 400, "invalid credential array")
			return
		}
	} else {
		writeErr(w, 400, "expected credential object or array")
		return
	}
	if len(docs) == 0 || len(docs) > maxCredentialImportAccounts {
		writeErr(w, 400, "import requires 1 to 100 accounts")
		return
	}
	type item struct {
		a             *auth.Auth
		preserveProxy bool
	}
	items := make([]item, 0, len(docs))
	seen := make(map[string]bool)
	for _, doc := range docs {
		a, err := auth.Parse(doc)
		if err != nil || auth.ValidateUID(aUID(a)) != nil {
			writeErr(w, 400, "invalid account credentials, UID or proxy")
			return
		}
		if seen[a.UID] {
			writeErr(w, 400, "duplicate account UID")
			return
		}
		seen[a.UID] = true
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(doc, &fields)
		_, hasProxy := fields["proxy"]
		_, hasAlias := fields["proxy_url"]
		a.FilePath = filepath.Join(p.cfg.AuthDir, "workbuddy-"+a.UID+".json")
		if old := p.cfg.Pool.AuthByUID(a.UID); old != nil {
			a.FilePath = old.FilePath
		}
		if safeCredentialPath(p.cfg.AuthDir, a.FilePath) != nil {
			writeErr(w, 400, "unsafe credential storage path")
			return
		}
		items = append(items, item{a, !hasProxy && !hasAlias})
	}
	select {
	case accountMutationSlots <- struct{}{}:
		defer func() { <-accountMutationSlots }()
	default:
		writeErr(w, 409, "another account mutation is running")
		return
	}
	if r.Context().Err() != nil {
		writeErr(w, 408, "request cancelled")
		return
	}
	if err := os.MkdirAll(p.cfg.AuthDir, 0700); err != nil {
		writeErr(w, 500, "credential directory unavailable")
		return
	}
	imported := []string{}
	failed := []string{}
	for _, it := range items {
		if r.Context().Err() != nil {
			failed = append(failed, it.a.UID)
			continue
		}
		a := it.a
		var err error
		if old := p.cfg.Pool.AuthByUID(a.UID); old != nil {
			if safeCredentialPath(p.cfg.AuthDir, old.FilePath) != nil {
				err = errors.New("unsafe credential path")
			} else {
				err = old.ImportCredentialsAndSave(a, it.preserveProxy)
				if err == nil {
					accountEgressService.Forget(old)
				}
			}
		} else {
			err = a.SaveAtomic()
		}
		if err != nil {
			failed = append(failed, it.a.UID)
			continue
		}
		// Panel v1.13 uses Pool.Add, whose upsert preserves all existing pool health state.
		p.cfg.Pool.Add(a)
		if p.cfg.Upstream != nil {
			p.cfg.Upstream.ForgetTransport(a.UID)
		}
		accountEgressService.Forget(a)
		imported = append(imported, a.UID)
	}
	status := 200
	if len(failed) > 0 {
		status = 500
	}
	writeJSON(w, status, map[string]any{"ok": len(failed) == 0, "imported": len(imported), "uids": imported, "failed": failed})
}
func aUID(a *auth.Auth) string {
	if a == nil {
		return ""
	}
	return a.UID
}
