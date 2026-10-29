package panel

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/egress"
	"io"
	"net/http"
)

// One bounded service across panels caps process-wide probe concurrency and observation memory.
// No credentials are retained in probe results; account pointers are evicted by TTL/capacity.
var accountEgressService = egress.New(egress.Options{})
var accountMutationSlots = make(chan struct{}, 1)

func (p *Panel) egressAccount(w http.ResponseWriter, r *http.Request) *auth.Auth {
	if p.cfg.Pool == nil {
		writeErr(w, 503, "account pool unavailable")
		return nil
	}
	uid := r.PathValue("uid")
	if auth.ValidateUID(uid) != nil {
		writeErr(w, 400, "invalid account UID")
		return nil
	}
	a := p.cfg.Pool.AuthByUID(uid)
	if a == nil {
		writeErr(w, 404, "account not found")
	}
	return a
}
func decodeSingleJSON(w http.ResponseWriter, r *http.Request, max int64, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return errors.New("invalid or oversized JSON body")
	}
	if dec.Decode(new(any)) != io.EOF {
		return errors.New("expected exactly one JSON value")
	}
	return nil
}

// AccountSetProxy is routed behind the caller's session authentication and CSRF guard.
func (p *Panel) AccountSetProxy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	a := p.egressAccount(w, r)
	if a == nil {
		return
	}
	var v struct {
		Proxy *string `json:"proxy"`
	}
	if decodeSingleJSON(w, r, 4096, &v) != nil || v.Proxy == nil {
		writeErr(w, 400, "expected proxy string")
		return
	}
	if err := auth.ValidateProxyURL(*v.Proxy); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	select {
	case accountMutationSlots <- struct{}{}:
		defer func() { <-accountMutationSlots }()
	default:
		writeErr(w, 409, "another account mutation is running")
		return
	}
	if p.cfg.Meta != nil && p.cfg.Meta.IsBound(a.UID) {
		writeErr(w, http.StatusConflict, "unbind the Meta route before changing the account proxy")
		return
	}
	if r.Context().Err() != nil {
		writeErr(w, 408, "request cancelled")
		return
	}
	if err := a.SetProxyAndSave(*v.Proxy); err != nil {
		writeErr(w, 500, "could not persist account proxy")
		return
	}
	if p.cfg.Upstream != nil {
		p.cfg.Upstream.ForgetTransport(a.UID)
	}
	accountEgressService.Forget(a)
	result := accountEgressService.Matrix([]*auth.Auth{a}).Accounts[0]
	writeJSON(w, 200, map[string]any{"ok": true, "account": result})
}
func (p *Panel) AccountEgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	a := p.egressAccount(w, r)
	if a == nil {
		return
	}
	if st, ok := p.cfg.Pool.Status(a.UID); ok && st.Blocked {
		writeErr(w, http.StatusConflict, "account requires reauthorization")
		return
	}
	if p.cfg.Upstream == nil {
		writeErr(w, 503, "upstream unavailable")
		return
	}
	result, err := accountEgressService.Probe(r.Context(), p.cfg.Upstream, a)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(err, egress.ErrBusy) {
			code = 429
		} else if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			code = 408
		}
		writeJSON(w, code, map[string]any{"ok": false, "error": err.Error(), "account": result})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "account": result})
}
func (p *Panel) EgressMatrix(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p.cfg.Pool == nil {
		writeErr(w, 503, "account pool unavailable")
		return
	}
	// Pool.List is already deterministic. Service.Matrix imposes a bounded output cap.
	states := p.cfg.Pool.List()
	accounts := make([]*auth.Auth, 0, len(states))
	for _, st := range states {
		if a := p.cfg.Pool.AuthByUID(st.UID); a != nil {
			accounts = append(accounts, a)
		}
	}
	writeJSON(w, 200, accountEgressService.Matrix(accounts))
}
