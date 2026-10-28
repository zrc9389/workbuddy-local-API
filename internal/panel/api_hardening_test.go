package panel

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
)

func newTestPanelWithConfig(saveFn func(raw []byte) ([]string, error)) *Panel {
	return New(Config{
		Version:    "test",
		Pool:       pool.New(""),
		SaveConfig: saveFn,
	})
}

// 1. 配置更新输入校验与标准化返回测试
func TestConfigInputValidationAndStandardJSON(t *testing.T) {
	p := newTestPanelWithConfig(func(raw []byte) ([]string, error) {
		return []string{"listen"}, nil
	})

	// Case 1: 空请求体
	req := httptest.NewRequest("POST", "/panel/api/config", strings.NewReader(""))
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty body, got %d: %s", rec.Code, rec.Body.String())
	}
	var errResp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if errResp["ok"] != false || !strings.Contains(errResp["error"].(string), "empty request body") {
		t.Fatalf("unexpected error response: %v", errResp)
	}

	// Case 2: 畸形 JSON (Malformed JSON)
	req = httptest.NewRequest("POST", "/panel/api/config", strings.NewReader("{invalid json syntax"))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed json, got %d: %s", rec.Code, rec.Body.String())
	}
	errResp = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if errResp["ok"] != false || !strings.Contains(errResp["error"].(string), "malformed JSON") {
		t.Fatalf("unexpected error response: %v", errResp)
	}

	// Case 3: 正常有效配置，检查标准结构化返回
	req = httptest.NewRequest("POST", "/panel/api/config", strings.NewReader(`{"listen":"127.0.0.1:8080"}`))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid config, got %d: %s", rec.Code, rec.Body.String())
	}
	var okResp struct {
		OK              bool     `json:"ok"`
		RestartRequired []string `json:"restart_required"`
		Data            struct {
			RestartRequired []string `json:"restart_required"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &okResp); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if !okResp.OK || len(okResp.Data.RestartRequired) != 1 || okResp.Data.RestartRequired[0] != "listen" {
		t.Fatalf("unexpected response structure: %v", okResp)
	}
}

// 2. 任务流水线触发输入校验与标准化返回测试
func TestTasksRunInputValidationAndStandardJSON(t *testing.T) {
	p := newTestPanel()

	// Case 1: 畸形 JSON
	req := httptest.NewRequest("POST", "/panel/api/tasks/run", strings.NewReader(`{"concurrency": "not_int"`))
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed json in tasks run, got %d", rec.Code)
	}

	// Case 2: 空 body 缺省触发
	req = httptest.NewRequest("POST", "/panel/api/tasks/run", strings.NewReader(""))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty body tasks run, got %d", rec.Code)
	}
	var resp struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if !resp.OK || resp.Data == nil {
		t.Fatalf("expected standard ok:true and data map, got: %v", resp)
	}
}

// 3. 任务流水线状态启停切换测试
func TestTasksToggleValidation(t *testing.T) {
	p := newTestPanel()

	// Case 1: 空请求体应报错
	req := httptest.NewRequest("POST", "/panel/api/tasks/toggle", strings.NewReader(""))
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty toggle body, got %d", rec.Code)
	}

	// Case 2: 畸形 JSON 应报错
	req = httptest.NewRequest("POST", "/panel/api/tasks/toggle", strings.NewReader(`{invalid`))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed toggle body, got %d", rec.Code)
	}

	// Case 3: 缺少参数
	req = httptest.NewRequest("POST", "/panel/api/tasks/toggle", strings.NewReader(`{}`))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty object toggle body, got %d", rec.Code)
	}

	// Case 4: 成功暂停
	req = httptest.NewRequest("POST", "/panel/api/tasks/toggle", strings.NewReader(`{"action":"pause"}`))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for pause, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if !resp.OK || resp.Data["active"] != false {
		t.Fatalf("expected active=false, got: %v", resp)
	}

	// 验证暂停期间 /tasks/run 拒绝执行 (423 Locked)
	runReq := httptest.NewRequest("POST", "/panel/api/tasks/run", strings.NewReader(""))
	runRec := httptest.NewRecorder()
	p.ServeHTTP(runRec, runReq)
	if runRec.Code != http.StatusLocked {
		t.Fatalf("expected 423 Locked when paused, got %d", runRec.Code)
	}

	// Case 5: 成功恢复
	req = httptest.NewRequest("POST", "/panel/api/tasks/toggle", strings.NewReader(`{"enabled":true}`))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for resume, got %d", rec.Code)
	}
}

// 4. 账号池刷新接口测试
func TestPoolRefreshStandardJSON(t *testing.T) {
	p := newTestPanel()

	// Case 1: 畸形 JSON 报错
	req := httptest.NewRequest("POST", "/panel/api/pool/refresh", strings.NewReader(`{"bad":`))
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed json, got %d", rec.Code)
	}

	// Case 2: 正常触发并返回结构化数据
	req = httptest.NewRequest("POST", "/panel/api/pool/refresh", strings.NewReader(""))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for pool refresh, got %d", rec.Code)
	}
	var resp struct {
		OK   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if !resp.OK || resp.Data == nil {
		t.Fatalf("expected standard ok:true and data map, got: %v", resp)
	}
}

// 5. 出口测速接口校验测试
func TestEgressSpeedtestValidation(t *testing.T) {
	p := newTestPanel()

	// Case 1: 畸形 JSON 报错
	req := httptest.NewRequest("POST", "/panel/api/egress/test", strings.NewReader(`{"uid":`))
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed json, got %d", rec.Code)
	}

	// Case 2: 非法 UID (路径穿越等)
	req = httptest.NewRequest("POST", "/panel/api/egress/test", strings.NewReader(`{"uid":"../../evil"}`))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid UID, got %d", rec.Code)
	}

	// Case 3: 全局矩阵测速正常返回
	req = httptest.NewRequest("POST", "/panel/api/egress/test", strings.NewReader("{}"))
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty UID, got %d", rec.Code)
	}
}

// 6. 非法 HTTP 方法防范测试 (MethodNotAllowed 兜底统一返回 JSON)
func TestMethodNotAllowedHandling(t *testing.T) {
	p := newTestPanel()

	// GET 请求纯 POST 接口
	req := httptest.NewRequest("GET", "/panel/api/tasks/run", nil)
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Fatalf("expected application/json content type, got: %s", ct)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("expected JSON body, got error: %v, raw: %s", err, rec.Body.String())
	}
	if resp["ok"] != false || resp["error"] != "Method Not Allowed" {
		t.Fatalf("unexpected method not allowed response: %v", resp)
	}
}

// 7. 未注册接口防范测试 (NotFound 兜底统一返回 JSON)
func TestNotFoundHandling(t *testing.T) {
	p := newTestPanel()

	req := httptest.NewRequest("GET", "/panel/api/unregistered_endpoint_path", nil)
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Fatalf("expected application/json content type, got: %s", ct)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("expected JSON body, got error: %v, raw: %s", err, rec.Body.String())
	}
	if resp["ok"] != false || resp["error"] != "Not Found" {
		t.Fatalf("unexpected not found response: %v", resp)
	}
}

// 8. 版本更新与热重启接口综合测试 (POST /panel/api/update/check & POST /panel/api/update/apply)
func TestUpdateCheckAndApplyEndpoints(t *testing.T) {
	p := newTestPanel()

	// Case 1: POST /panel/api/update/check 正常调用
	{
		req := httptest.NewRequest("POST", "/panel/api/update/check", strings.NewReader("{}"))
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("expected 501 when update source is unavailable, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			OK             bool   `json:"ok"`
			CurrentVersion string `json:"current_version"`
			LatestVersion  string `json:"latest_version"`
			HasUpdate      bool   `json:"has_update"`
			Data           struct {
				CurrentVersion string `json:"current_version"`
				LatestVersion  string `json:"latest_version"`
				HasUpdate      bool   `json:"has_update"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to unmarshal update check response: %v", err)
		}
		if resp.OK {
			t.Fatalf("update check must not report success without a source: %+v", resp)
		}
	}

	// Case 2: POST /panel/api/update/check 畸形 JSON 拦截
	{
		req := httptest.NewRequest("POST", "/panel/api/update/check", strings.NewReader(`{invalid json`))
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for malformed json in update check, got %d", rec.Code)
		}
	}

	// Case 3: POST /panel/api/update/apply 正常调用
	{
		req := httptest.NewRequest("POST", "/panel/api/update/apply", strings.NewReader("{}"))
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("expected 501 when update artifact is unavailable, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			OK      bool   `json:"ok"`
			Status  string `json:"status"`
			Message string `json:"message"`
			Data    struct {
				Status  string `json:"status"`
				Message string `json:"message"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to unmarshal update apply response: %v", err)
		}
		if resp.OK {
			t.Fatalf("update apply must not report success without a verified artifact: %+v", resp)
		}
	}

	// Case 4: POST /panel/api/update/apply 畸形 JSON 拦截
	{
		req := httptest.NewRequest("POST", "/panel/api/update/apply", strings.NewReader(`{invalid json`))
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for malformed json in update apply, got %d", rec.Code)
		}
	}

	// Case 5: GET 方法被安全拦截并返回 405 Method Not Allowed 标准 JSON
	{
		req := httptest.NewRequest("GET", "/panel/api/update/check", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405 for GET /panel/api/update/check, got %d", rec.Code)
		}
	}
	{
		req := httptest.NewRequest("GET", "/panel/api/update/apply", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405 for GET /panel/api/update/apply, got %d", rec.Code)
		}
	}
}

// 9. overview 与 packages 防御健壮性测试
func TestOverviewAndPackagesRobustness(t *testing.T) {
	p := New(Config{Version: "3.0.1", Pool: nil})

	// Case 1: nil pool 下 GET /panel/api/overview
	{
		req := httptest.NewRequest("GET", "/panel/api/overview", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for overview with nil pool, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal overview failed: %v", err)
		}
	if resp["version"] != "3.0.1" || resp["ok"] != true {
			t.Fatalf("unexpected overview response: %v", resp)
		}
	}

	// Case 2: nil pool 下 GET /panel/api/packages
	{
		req := httptest.NewRequest("GET", "/panel/api/packages", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for packages with nil pool, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal packages failed: %v", err)
		}
		if resp["ok"] != true {
			t.Fatalf("unexpected packages response: %v", resp)
		}
	}
}
