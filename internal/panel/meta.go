package panel

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
	metaassets "github.com/linguo2625469/workbuddy2api-panel/third_party/meta"
)

// All Meta handlers require the same outer session/Origin/CSRF guards as the
// existing panel endpoints. No raw controller proxy endpoint is exposed.
func (p *Panel) metaManager(w http.ResponseWriter) *metacore.Manager {
	w.Header().Set("Cache-Control", "no-store")
	if p.cfg.Meta == nil {
		writeErr(w, 503, "meta service unavailable")
		return nil
	}
	return p.cfg.Meta
}
func metaError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	switch {
	case errors.Is(err, metacore.ErrSubscriptionNotFound):
		status = http.StatusNotFound
	case errors.Is(err, metacore.ErrSubscriptionInUse):
		status = http.StatusConflict
	case errors.Is(err, metacore.ErrUnavailable), errors.Is(err, metacore.ErrRollback):
		status = 503
	case errors.Is(err, metacore.ErrBusy):
		status = 409
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		status = 408
	case errors.Is(err, metacore.ErrApply):
		status = 502
	}
	writeErr(w, status, err.Error())
}
func (p *Panel) MetaStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p.cfg.Meta == nil {
		writeJSON(w, 200, metacore.Status{State: "unavailable"})
		return
	}
	writeJSON(w, 200, p.cfg.Meta.Status())
}
func (p *Panel) MetaNodes(w http.ResponseWriter, r *http.Request) {
	m := p.metaManager(w)
	if m == nil {
		return
	}
	result := m.Nodes()
	if subscriptionID := strings.TrimSpace(r.URL.Query().Get("subscription_id")); subscriptionID != "" {
		allowed := make(map[string]struct{})
		filtered := result.Nodes[:0]
		for _, node := range result.Nodes {
			if node.Provider != subscriptionID {
				continue
			}
			allowed[node.ID] = struct{}{}
			filtered = append(filtered, node)
		}
		result.Nodes = filtered
		bindings := result.Bindings[:0]
		for _, binding := range result.Bindings {
			if _, ok := allowed[binding.Node]; ok {
				bindings = append(bindings, binding)
			}
		}
		result.Bindings = bindings
		result.Total = len(result.Nodes)
	}
	sort.SliceStable(result.Nodes, func(i, j int) bool {
		left, right := result.Nodes[i], result.Nodes[j]
		if left.ProviderName != right.ProviderName {
			return left.ProviderName < right.ProviderName
		}
		if left.Name != right.Name {
			return left.Name < right.Name
		}
		return left.ID < right.ID
	})
	writeJSON(w, 200, result)
}
func (p *Panel) MetaSubscriptions(w http.ResponseWriter, r *http.Request) {
	m := p.metaManager(w)
	if m == nil {
		return
	}
	if r.Method == http.MethodGet {
		subscriptions := m.Subscriptions()
		if id := strings.TrimSpace(r.URL.Query().Get("id")); id != "" {
			if r.URL.Query().Get("reveal") != "1" {
				writeJSON(w, http.StatusOK, map[string]any{"subscriptions": subscriptions})
				return
			}
			subscription, err := m.Subscription(id)
			if err != nil {
				metaError(w, err)
				return
			}
			if !subscription.HasURL {
				metaError(w, metacore.ErrSubscriptionNoURL)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id, "url": subscription.URLPreview})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"subscriptions": subscriptions})
		return
	}
	var v struct {
		Action  string  `json:"action"`
		ID      string  `json:"id"`
		URL     string  `json:"url"`
		Name    *string `json:"name"`
		Enabled *bool   `json:"enabled"`
	}
	if decodeSingleJSON(w, r, 8192, &v) != nil {
		writeErr(w, 400, "invalid subscription payload")
		return
	}
	v.Action = strings.TrimSpace(v.Action)
	v.ID = strings.TrimSpace(v.ID)
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	switch v.Action {
	case "":
		if v.URL == "" {
			writeErr(w, 400, "expected subscription URL")
			return
		}
		result, err := m.AddSubscriptionNamed(ctx, v.URL, subscriptionName(v.Name))
		if err != nil {
			metaError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	case "toggle":
		if v.ID == "" || v.Enabled == nil {
			writeErr(w, 400, "expected subscription id and enabled")
			return
		}
		subscription, err := m.UpdateSubscription(ctx, v.ID, nil, v.Enabled)
		if err != nil {
			metaError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "subscription": subscription})
		return
	case "rename":
		if v.ID == "" || v.Name == nil {
			writeErr(w, 400, "expected subscription id and name")
			return
		}
		subscription, err := m.UpdateSubscription(ctx, v.ID, v.Name, nil)
		if err != nil {
			metaError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "subscription": subscription})
		return
	case "refresh":
		if v.ID == "" {
			writeErr(w, 400, "expected subscription id")
			return
		}
		result, err := m.RefreshSubscription(ctx, v.ID)
		if err != nil {
			metaError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	case "delete":
		if v.ID == "" {
			writeErr(w, 400, "expected subscription id")
			return
		}
		if err := m.RemoveSubscription(ctx, v.ID); err != nil {
			metaError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": v.ID})
		return
	default:
		writeErr(w, 400, "unsupported subscription action")
	}
}

func subscriptionName(name *string) string {
	if name == nil {
		return ""
	}
	return strings.TrimSpace(*name)
}

func (p *Panel) MetaTests(w http.ResponseWriter, r *http.Request) {
	m := p.metaManager(w)
	if m == nil {
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, 200, m.Tests())
		return
	}
	var v struct {
		Cancel bool `json:"cancel"`
	}
	if decodeSingleJSON(w, r, 1024, &v) != nil {
		writeErr(w, 400, "expected test options object")
		return
	}
	if v.Cancel {
		writeJSON(w, 200, m.CancelTests())
		return
	}
	job, err := m.StartTests(r.Context())
	if err != nil {
		metaError(w, err)
		return
	}
	writeJSON(w, 200, job)
}
func (p *Panel) MetaStats(w http.ResponseWriter, r *http.Request) {
	m := p.metaManager(w)
	if m == nil {
		return
	}
	writeJSON(w, 200, m.Stats())
}
func (p *Panel) MetaBind(w http.ResponseWriter, r *http.Request) {
	m := p.metaManager(w)
	if m == nil {
		return
	}
	a := p.egressAccount(w, r)
	if a == nil {
		return
	}
	var v struct {
		Node string `json:"node"`
	}
	if decodeSingleJSON(w, r, 1024, &v) != nil || v.Node == "" {
		writeErr(w, 400, "expected node id")
		return
	}
	select {
	case accountMutationSlots <- struct{}{}:
		defer func() { <-accountMutationSlots }()
	default:
		writeErr(w, 409, "another account mutation is running")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()
	b, err := m.Bind(ctx, a.UID, v.Node, func(proxy string) error {
		if m.Status().Demo {
			return nil
		}
		if err := a.SetProxyAndSave(proxy); err != nil {
			return err
		}
		if p.cfg.Upstream != nil {
			p.cfg.Upstream.ForgetTransport(a.UID)
		}
		accountEgressService.Forget(a)
		return nil
	})
	if err != nil {
		metaError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "binding": b, "demo": m.Status().Demo})
}
func (p *Panel) MetaAsset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, _ = w.Write(metaassets.LatencyTrendJS)
}
