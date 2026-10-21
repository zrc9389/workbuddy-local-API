package server

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"net/http"
	"time"
)

func (h *Handler) underPressure() bool { return h.cfg.Pressure != nil && h.cfg.Pressure() }
func (h *Handler) reserve(n int64) bool {
	select {
	case h.slots <- struct{}{}:
	default:
		return false
	}
	if !h.bodyBudget.Acquire(n) {
		<-h.slots
		return false
	}
	if !h.workBudget.Acquire(workingCost(n)) {
		h.bodyBudget.Release(n)
		<-h.slots
		return false
	}
	return true
}
func (h *Handler) release(n int64) {
	h.workBudget.Release(workingCost(n))
	h.bodyBudget.Release(n)
	<-h.slots
}
func (h *Handler) admit(w http.ResponseWriter, r *http.Request) (*http.Request, func(), bool) {
	noop := func() {}
	if r.ContentLength > h.cfg.MaxBodyBytes {
		writeOpenAIError(w, 413, "request_body_too_large", h.bodyLimitMessage())
		return r, noop, false
	}
	n := r.ContentLength
	if n <= 0 {
		n = h.cfg.MaxBodyBytes
	}
	if workingCost(n) > h.workLimit {
		writeOpenAIError(w, 413, "working_budget_exceeded", "request too large for the configured memory working budget; content was not dispatched")
		return r, noop, false
	}
	if !h.underPressure() && h.reserve(n) {
		r.Body = http.MaxBytesReader(w, r.Body, h.cfg.MaxBodyBytes)
		return r, func() { h.release(n) }, true
	}
	if h.cfg.Spool == nil {
		w.Header().Set("Retry-After", "2")
		writeOpenAIError(w, 429, "resource_busy", "request capacity reached")
		return r, noop, false
	}
	// Disk path is used only when in-flight/memory admission is exhausted.
	j, e := h.cfg.Spool.Stage(r.Context(), r.Body, h.cfg.MaxBodyBytes)
	if e != nil {
		writeOpenAIError(w, 507, "spool_rejected", e.Error())
		return r, noop, false
	}
	w.Header().Set("X-Local-Spool-ID", j.ID())
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		if !h.underPressure() && h.reserve(n) {
			break
		}
		select {
		case <-ctx.Done():
			_ = j.Complete("cancelled")
			writeOpenAIError(w, 503, "queue_timeout", "request was not dispatched; queue deadline exceeded")
			return r, noop, false
		case <-tick.C:
		}
	}
	body, e := j.Open()
	if e != nil {
		h.release(n)
		_ = j.Complete("unknown")
		writeOpenAIError(w, 500, "spool_integrity", e.Error())
		return r, noop, false
	}
	if e = j.Mark("dispatch_intent"); e != nil {
		body.Close()
		h.release(n)
		writeOpenAIError(w, 507, "spool_commit", e.Error())
		return r, noop, false
	}
	r.Body = body
	r = r.WithContext(context.WithValue(r.Context(), spoolKey{}, j))
	return r, func() { body.Close(); h.release(n); _ = j.Complete("unknown") }, true
}

type spoolKey struct{}

func finishSpool(r *http.Request, success bool) {
	if j, ok := r.Context().Value(spoolKey{}).(*spool.Job); ok && success && r.Context().Err() == nil {
		r.Body.Close()
		_ = j.Complete("committed")
	}
}
func (h *Handler) resourceStatus(w http.ResponseWriter, r *http.Request) {
	var q any
	if h.cfg.Spool != nil {
		q = h.cfg.Spool.Stats()
	}
	writeJSON(w, 200, map[string]any{"pressure": h.underPressure(), "in_flight": len(h.slots), "body_bytes": h.bodyBudget.Used(), "working_bytes": h.workBudget.Used(), "working_limit": h.workLimit, "spool": q})
}

func workingCost(n int64) int64 {
	if n < 65536 {
		n = 65536
	}
	return n * 8
}
