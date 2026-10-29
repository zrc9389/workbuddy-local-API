package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/egress"
)

// 全局任务流水线启用状态（支持通过 /tasks/toggle 进行动态启停控制）
var (
	pipelineMu     sync.RWMutex
	pipelineActive = true
	pipelineReason = "running"
)

// decodeJSONBodyStrict 解析请求体并进行严格防御性检查：
// 1. 体积限制由 maxBytes 约束；
// 2. 空请求体拦截：若 !allowEmpty 且 body 为空，返回错误 "empty request body"；
// 3. 畸形 JSON 拦截：语法错误、类型不符、或多余尾随字符，返回 "malformed JSON: ..." 错误。
func decodeJSONBodyStrict(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any, allowEmpty bool) error {
	if r.Body == nil {
		if allowEmpty {
			return nil
		}
		return errors.New("empty request body")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return fmt.Errorf("request body exceeds %d bytes limit", maxBytes)
		}
		return fmt.Errorf("read body: %w", err)
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		if allowEmpty {
			return nil
		}
		return errors.New("empty request body")
	}

	dec := json.NewDecoder(bytes.NewReader(trimmed))
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("malformed JSON: %w", err)
	}
	if dec.Decode(new(any)) != io.EOF {
		return errors.New("malformed JSON: expected exactly one JSON value")
	}
	return nil
}

// tasksRun 任务流水线触发接口 (/panel/api/tasks/run)
// 支持可选请求体 {"concurrency": 1..4, "growth": true}
func (p *Panel) tasksRun(w http.ResponseWriter, r *http.Request) {
	pipelineMu.RLock()
	active := pipelineActive
	reason := pipelineReason
	pipelineMu.RUnlock()

	if !active {
		writeJSON(w, http.StatusLocked, map[string]any{
			"ok":    false,
			"error": "task pipeline is currently paused: " + reason,
		})
		return
	}

	var req struct {
		Concurrency int   `json:"concurrency"`
		Growth      *bool `json:"growth"`
	}
	if err := decodeJSONBodyStrict(w, r, 4096, &req, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	concurrency := req.Concurrency
	if concurrency < 1 {
		concurrency = 1
	} else if concurrency > 4 {
		concurrency = 4
	}
	growth := true
	if req.Growth != nil {
		growth = *req.Growth
	}

	if p.cfg.Tasks == nil {
		data := map[string]any{
			"started": false,
			"total":   0,
			"seq":     0,
			"message": "tasks service unavailable",
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"data":    data,
			"started": false,
			"total":   0,
			"seq":     0,
			"message": "tasks service unavailable",
		})
		return
	}

	started, total, seq, msg := p.cfg.Tasks.StartGrowthQueue(concurrency, growth)
	if seq == -1 {
		writeJSON(w, http.StatusConflict, map[string]any{
			"ok":    false,
			"error": msg,
		})
		return
	}

	data := map[string]any{
		"started": started,
		"total":   total,
		"seq":     seq,
		"message": msg,
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"data":    data,
		"started": started,
		"total":   total,
		"seq":     seq,
		"message": msg,
	})
}

// tasksToggle 任务流水线状态切换接口 (/panel/api/tasks/toggle)
// 要求传入 {"enabled": true/false} 或 {"action": "pause"/"resume"}
func (p *Panel) tasksToggle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled *bool  `json:"enabled"`
		Action  string `json:"action"`
	}
	if err := decodeJSONBodyStrict(w, r, 4096, &req, false); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	pipelineMu.Lock()
	defer pipelineMu.Unlock()

	var newActive bool
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if req.Enabled != nil {
		newActive = *req.Enabled
	} else if action == "pause" || action == "stop" || action == "disable" {
		newActive = false
	} else if action == "resume" || action == "start" || action == "enable" {
		newActive = true
	} else {
		writeErr(w, http.StatusBadRequest, "expected enabled boolean or valid action (pause/resume)")
		return
	}

	pipelineActive = newActive
	if pipelineActive {
		pipelineReason = "running"
	} else {
		pipelineReason = "manually paused"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"active": pipelineActive,
			"status": pipelineReason,
		},
		"active": pipelineActive,
		"status": pipelineReason,
	})
}

// tasksSchedule controls the daily scheduler gate used by the account-task
// page. It is distinct from /tasks/toggle, which remains the legacy
// growth-queue gate, and from /maintenance/pause, which pauses only an
// already-running four-step maintenance batch.
// GET returns the current state; POST accepts {`enabled`:true|false}.
func (p *Panel) tasksSchedule(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusServiceUnavailable, "scheduler unavailable")
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if err := decodeJSONBodyStrict(w, r, 1024, &req, false); err != nil || req.Enabled == nil {
			if err == nil {
				err = errors.New("enabled boolean required")
			}
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if p.cfg.SaveConfig == nil {
			writeErr(w, http.StatusServiceUnavailable, "schedule configuration unavailable")
			return
		}
		patch, _ := json.Marshal(map[string]any{"schedule": map[string]any{
			"checkin_enabled": *req.Enabled, "travel_enabled": *req.Enabled,
			"activity_enabled": *req.Enabled, "keepalive_enabled": *req.Enabled,
		}})
		if _, err := p.cfg.SaveConfig(patch); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not save task schedule")
			return
		}
	}
	enabled := p.cfg.Scheduler.FourTasksEnabled()
	status := "enabled"
	if !enabled {
		status = "disabled"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "enabled": enabled, "status": status,
		"data": map[string]any{"enabled": enabled, "status": status},
	})
}

// poolRefresh 账号池状态刷新接口 (/panel/api/pool/refresh)
// 统一支持可选 JSON 请求体，触发状态/余额全量刷新，并以结构化 JSON 返回最新快照
func (p *Panel) poolRefresh(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSONBodyStrict(w, r, 4096, &req, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if p.cfg.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "pool not available")
		return
	}

	var refreshResult any
	if p.cfg.Scheduler != nil {
		refreshResult = p.cfg.Scheduler.RunBalanceRefreshNow()
	}

	total, healthy, cooling, disabled, paused, inFlightFull := p.cfg.Pool.CountsDetailedWithPaused()
	data := map[string]any{
		"total":          total,
		"healthy":        healthy,
		"cooling":        cooling,
		"disabled":       disabled,
		"paused":         paused,
		"in_flight_full": inFlightFull,
		"refreshed_at":   time.Now().Unix(),
		"result":         refreshResult,
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"data":           data,
		"total":          total,
		"healthy":        healthy,
		"cooling":        cooling,
		"disabled":       disabled,
		"paused":         paused,
		"in_flight_full": inFlightFull,
	})
}

// egressSpeedtest 出口测速综合端点 (/panel/api/egress/test 和 /panel/api/egress/speedtest)
// 支持指定 {"uid": "..."} 进行单号出口测试，或空体执行全局矩阵测速
func (p *Panel) egressSpeedtest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var req struct {
		UID string `json:"uid"`
	}
	if err := decodeJSONBodyStrict(w, r, 4096, &req, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	req.UID = strings.TrimSpace(req.UID)
	if req.UID != "" {
		if auth.ValidateUID(req.UID) != nil {
			writeErr(w, http.StatusBadRequest, "invalid account UID")
			return
		}
		if p.cfg.Pool == nil {
			writeErr(w, http.StatusServiceUnavailable, "account pool unavailable")
			return
		}
		if st, ok := p.cfg.Pool.Status(req.UID); ok && st.Blocked {
			writeErr(w, http.StatusConflict, "account requires reauthorization")
			return
		}
		a := p.cfg.Pool.AuthByUID(req.UID)
		if a == nil {
			writeErr(w, http.StatusNotFound, "account not found")
			return
		}
		if p.cfg.Upstream == nil {
			writeErr(w, http.StatusServiceUnavailable, "upstream unavailable")
			return
		}
		res, err := accountEgressService.Probe(r.Context(), p.cfg.Upstream, a)
		if err != nil {
			code := http.StatusBadGateway
			if errors.Is(err, egress.ErrBusy) {
				code = http.StatusTooManyRequests
			} else if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				code = http.StatusRequestTimeout
			}
			writeJSON(w, code, map[string]any{
				"ok":      false,
				"error":   err.Error(),
				"account": res,
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"data":    res,
			"account": res,
		})
		return
	}

	if p.cfg.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "account pool unavailable")
		return
	}
	states := p.cfg.Pool.List()
	accounts := make([]*auth.Auth, 0, len(states))
	for _, st := range states {
		if a := p.cfg.Pool.AuthByUID(st.UID); a != nil {
			accounts = append(accounts, a)
		}
	}
	matrix := accountEgressService.Matrix(accounts)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": matrix,
	})
}

// updateCheck 检查后端服务版本更新 (/panel/api/update/check)。
// 更新源未配置时返回明确的服务不可用错误，避免伪造版本或成功状态。
func (p *Panel) updateCheck(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSONBodyStrict(w, r, 4096, &req, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if p.cfg.UpdateChecker == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]any{"ok": false, "code": "not_configured", "error": "update source is not configured"})
		return
	}
	p.updateMu.Lock()
	defer p.updateMu.Unlock()
	p.updateArtifact = nil
	result, err := p.cfg.UpdateChecker(r.Context())
	if err != nil {
		code, message, status := "check_failed", "update check failed", http.StatusBadGateway
		var updateErr *UpdateError
		if errors.As(err, &updateErr) {
			code, message = updateErr.Code, updateErr.Message
			if code == "not_configured" {
				status = http.StatusNotImplemented
			}
			if code == "invalid_config" || code == "invalid_version" {
				status = http.StatusBadRequest
			}
			if code == "timeout" {
				status = http.StatusGatewayTimeout
			}
		}
		writeJSON(w, status, map[string]any{"ok": false, "code": code, "error": message, "current_version": result.CurrentVersion})
		return
	}
	if result.Artifact != nil && result.Artifact.Verified {
		a := *result.Artifact
		p.updateArtifact = &a
	} else {
		p.updateArtifact = nil
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "current_version": result.CurrentVersion, "latest_version": result.LatestVersion, "has_update": result.HasUpdate, "data": result})
}

// updateApply 触发后端服务版本更新应用并重启 (/panel/api/update/apply)。
// 没有经过校验的更新工件时拒绝执行。
func (p *Panel) updateApply(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSONBodyStrict(w, r, 4096, &req, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if p.cfg.UpdateApplier == nil {
		writeErr(w, http.StatusNotImplemented, "update installation is not enabled")
		return
	}
	p.updateMu.Lock()
	defer p.updateMu.Unlock()
	a := p.updateArtifact
	if a != nil {
		c := *a
		a = &c
	}
	if a == nil || !a.Verified {
		writeErr(w, http.StatusPreconditionFailed, "update check with a verified artifact is required")
		return
	}
	if err := p.cfg.UpdateApplier(r.Context(), *a); err != nil {
		code, status := "apply_failed", http.StatusBadGateway
		var ue *UpdateError
		if errors.As(err, &ue) {
			code = ue.Code
			if ue.Code == "unverified_artifact" || ue.Code == "invalid_checksum" || ue.Code == "invalid_url" {
				status = http.StatusBadRequest
			}
		}
		writeJSON(w, status, map[string]any{"ok": false, "code": code, "error": err.Error()})
		return
	}
	if p.cfg.RestartService != nil {
		if err := p.cfg.RestartService(); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "code": "restart_failed", "error": "update installed but service restart failed"})
			return
		}
	}
	p.updateArtifact = nil
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "status": "restart_required"})
}
