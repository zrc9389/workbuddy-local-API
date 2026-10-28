package panel

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/modelpolicy"
)

// accountsList 返回当前账号池完整清单及按状态聚合统计
func (p *Panel) accountsList(w http.ResponseWriter, r *http.Request) {
	total, healthy, cooling, disabled, paused, inFlightFull := p.cfg.Pool.CountsDetailedWithPaused()
	accts := p.cfg.Pool.List()
	blocked := 0
	for _, acc := range accts {
		if acc.State == "BLOCKED" || acc.Blocked {
			blocked++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"accounts":       accts,
		"total":          total,
		"healthy":        healthy,
		"cooling":        cooling,
		"disabled":       disabled,
		"paused":         paused,
		"in_flight_full": inFlightFull,
		"blocked":        blocked,
		"isolated":       blocked,
		"unauthorized":   blocked,
	})
}

// accountsCreateOrUpdate 处理账号导入或更新，正向承接 200
func (p *Panel) accountsCreateOrUpdate(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		p.importCockpit(w, r)
		return
	}
	writeErr(w, http.StatusNotImplemented, "account import requires multipart data")
}

// accountsRefresh 承接账号刷新操作并触发全量余额刷新
func (p *Panel) accountsRefresh(w http.ResponseWriter, r *http.Request) {
	p.balanceAll(w, r)
}

// tasksList 返回当前任务队列与各账号任务状态
func (p *Panel) tasksList(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Tasks == nil {
		writeErr(w, http.StatusServiceUnavailable, "task service unavailable")
		return
	}
	// 利用中间记录器保证即使底层组件未准备好，也始终返回正向 HTTP 200
	rec := &responseInterceptor{ResponseWriter: w, code: http.StatusOK}
	p.tasksQueueStatus(rec, r)
	if rec.code >= 400 {
		writeErr(w, http.StatusServiceUnavailable, "task service unavailable")
		return
	}
	rec.flush()
}

// tasksTrigger 触发任务队列执行，保障平滑返回 HTTP 200
func (p *Panel) tasksTrigger(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Tasks == nil {
		writeErr(w, http.StatusServiceUnavailable, "task service unavailable")
		return
	}
	rec := &responseInterceptor{ResponseWriter: w, code: http.StatusOK}
	p.tasksRunQueue(rec, r)
	if rec.code >= 400 {
		writeErr(w, http.StatusServiceUnavailable, "task service unavailable")
		return
	}
	rec.flush()
}

type responseInterceptor struct {
	http.ResponseWriter
	code int
	body []byte
}

func (ri *responseInterceptor) WriteHeader(statusCode int) {
	ri.code = statusCode
}

func (ri *responseInterceptor) Write(b []byte) (int, error) {
	ri.body = append(ri.body, b...)
	return len(b), nil
}

func (ri *responseInterceptor) flush() {
	ri.ResponseWriter.WriteHeader(ri.code)
	_, _ = ri.ResponseWriter.Write(ri.body)
}

// capabilitiesGet 返回面板各项特性的启用状态
func (p *Panel) capabilitiesGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"logs":        p.cfg.RequestLog != nil,
		"maintenance": p.cfg.Maintenance != nil,
		"demo":        p.cfg.Demo,
		"version":     p.cfg.Version,
	})
}

// modelPolicyGet 返回当前模型策略快照
func (p *Panel) modelPolicyGet(w http.ResponseWriter, r *http.Request) {
	if p.modelPolicy != nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": p.modelPolicy.Snapshot()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": map[string]any{}})
}

// modelPolicySet 更新单模型策略配置
func (p *Panel) modelPolicySet(w http.ResponseWriter, r *http.Request) {
	var v struct {
		ID string `json:"id"`
		modelpolicy.Rule
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&v) != nil {
		writeErr(w, http.StatusBadRequest, "invalid model policy")
		return
	}
	if p.modelPolicy != nil {
		if err := p.modelPolicy.Set(v.ID, v.Rule); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// customizationGet 返回前端个性化配置（音乐、文案、主题等）
func (p *Panel) customizationGet(w http.ResponseWriter, r *http.Request) {
	p.customMu.RLock()
	defer p.customMu.RUnlock()
	writeJSON(w, http.StatusOK, p.customData)
}

// customizationSet 存储并合并前端个性化配置（音乐、文案、主题等）
func (p *Panel) customizationSet(w http.ResponseWriter, r *http.Request) {
	var patch map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 15<<20)).Decode(&patch) != nil {
		writeErr(w, http.StatusBadRequest, "invalid customization json")
		return
	}
	if len(patch) == 0 {
		writeErr(w, http.StatusBadRequest, "customization patch is empty")
		return
	}
	p.customMu.Lock()
	previous := make(map[string]any, len(p.customData))
	for k, v := range p.customData {
		previous[k] = v
	}
	for k, v := range patch {
		p.customData[k] = v
	}
	encoded, marshalErr := json.Marshal(map[string]any{"panel": patch})
	if marshalErr == nil && p.cfg.SaveConfig != nil {
		if _, saveErr := p.cfg.SaveConfig(encoded); saveErr != nil {
			p.customData = previous
			p.customMu.Unlock()
			writeErr(w, http.StatusInternalServerError, "could not persist customization")
			return
		}
	}
	p.customMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": p.customData})
}

// globalRefresh 通用全局刷新入口
func (p *Panel) globalRefresh(w http.ResponseWriter, r *http.Request) {
	// This endpoint is intentionally limited to the four data families shown
	// by the refresh control.  Each operation reports its own result so a
	// failed upstream call cannot be presented as a successful full refresh.
	result := map[string]any{}
	allOK := true
	if p.cfg.Scheduler == nil {
		result["balance"] = map[string]any{"ok": false, "error": "scheduler unavailable"}
		allOK = false
	} else {
		b := p.cfg.Scheduler.RunBalanceRefreshNow()
		result["balance"] = map[string]any{"ok": b.Failed == 0, "total": b.Total, "completed": b.Completed, "failed": b.Failed}
		if b.Failed != 0 {
			allOK = false
		}
	}
	if p.cfg.Usage == nil {
		result["usage"] = map[string]any{"ok": false, "error": "usage recorder not available"}
		allOK = false
	} else {
		p.cfg.Usage.Save()
		result["usage"] = map[string]any{"ok": true}
	}
	if p.cfg.RequestLog == nil {
		result["errors"] = map[string]any{"ok": false, "error": "request log not available"}
		allOK = false
	} else {
		s := p.cfg.RequestLog.Snapshot()
		result["errors"] = map[string]any{"ok": true, "recent": len(s.Recent), "failed": s.Failed}
	}
	// Reuse the packages handler so refresh has the same upstream semantics as
	// the packages view.  Capture its JSON without emitting a second response.
	if p.cfg.Pool == nil {
		result["packages"] = map[string]any{"ok": false, "error": "pool unavailable"}
		allOK = false
	} else {
		rec := &responseInterceptor{ResponseWriter: w, code: http.StatusOK}
		p.packages(rec, r)
		if rec.code >= 400 {
			result["packages"] = map[string]any{"ok": false, "error": "package refresh failed", "status": rec.code}
			allOK = false
		} else {
			var body map[string]any
			if json.Unmarshal(rec.body, &body) == nil {
				result["packages"] = map[string]any{"ok": true, "data": body}
			} else {
				result["packages"] = map[string]any{"ok": false, "error": "invalid package response"}
				allOK = false
			}
		}
	}
	status := http.StatusOK
	if !allOK {
		// Keep the component-level report in the body, but expose failure at the
		// HTTP boundary so callers cannot mistake an unavailable refresh service
		// for a successful operation.
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": allOK, "components": result, "refreshed_at": time.Now().UTC()})
}

// globalSync 通用状态同步确认入口
func (p *Panel) globalSync(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusNotImplemented, "sync operation is not configured")
}
