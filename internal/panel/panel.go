// Package panel 内嵌式 Web 管理面板：账号池总览、单号运维（解冻/禁用/签到/
// 刷新余额/移除）、浏览器内 OAuth 添加账号（免重启热加载进池）、手动批量
// 签到/保活，以及运行日志环形缓冲（镜像 log 包与 chat 表格日志）。
//
// 设计约束：
//   - 前端 go:embed 单文件（index.html），无任何外部构建依赖，与二进制同体部署；
//   - 管理鉴权统一由外层 localauth 密码会话、Host/Origin 和 CSRF 边界执行。
//   - 不改写既有池语义：所有运维操作落到 pool 已有入口（Revive/Disable/Remove...），
//     添加账号走 auth.SaveAtomic + pool.Add，重启后与 auths/ 目录天然对齐。
package panel

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/livecfg"
	"github.com/linguo2625469/workbuddy2api-panel/internal/maintenance"
	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/reqlog"
	"github.com/linguo2625469/workbuddy2api-panel/internal/scheduler"
	"github.com/linguo2625469/workbuddy2api-panel/internal/tasks"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
)

// Config 面板依赖（main 装配注入）。
type Config struct {
	Meta        *metacore.Manager
	Maintenance *maintenance.Service
	Demo        bool
	Tasks       *tasks.Service // Shared task service; nil creates a default in New.
	Pool        *pool.Pool
	Upstream    *upstream.Client
	Scheduler   *scheduler.Scheduler // 手动触发签到/保活；nil 时对应接口返回 501
	AuthDir     string               // OAuth 登录完成后凭证落盘目录
	RedisMode   string               // "upstash" / "noop"，仅观测透出
	Version     string               // 面板版本号（展示用）

	// Live 运行期可变配置（在线改配置立即生效）。
	Live *livecfg.Holder

	// ConfigPath config.json 路径与加载器（配置页读写用）。
	// LoadConfig 返回解析后的配置对象（前端展示/校验用，具体类型由 main 注入的闭包决定）；
	// nil 时配置页返回 501。
	ConfigPath string
	LoadConfig func() (any, error)
	// SaveConfig 校验并落盘配置，返回需要重启才能生效的字段列表；随后由 main 注入的
	// ApplyConfig 闭包完成热生效（池参数/排程/密钥/脱敏）。error 时配置不写盘。
	SaveConfig func(raw []byte) (restartRequired []string, err error)

	// StickyCount 返回粘性会话绑定数；nil 时报告 0。
	StickyCount func() int

	// Usage 逐请求用量记录器（nil = 用量接口返回 501）。
	Usage *usage.Recorder
	// RequestLog 请求指标与归档（nil = 对应接口返回 501）。
	RequestLog telemetry.Sink

	// ProbeFile 模型输出上限探测结果文件（scripts/probe_max_tokens.py --panel-out
	// 写入；空或文件不存在 = model_probes 端点返回空集，面板不显示任何实测标注）。
	// 只读展示：网关不解析、不依赖其内容做任何路由/出站决策。
	ProbeFile string
}

// Panel 管理面板 handler。挂载方式：外层 mux Handle("/panel/", panel)，
// 本 mux 的 pattern 均带 /panel 前缀（外层不做前缀剥离）。
type Panel struct {
	cfg     Config
	mux     *http.ServeMux
	started time.Time
	logs    *Ring

	// modelsMu 保护 modelsCache 与刷新冷却；面板模型目录按 realm（cn/global）分键。
	// 与 /v1/models 一致为每域单快照（首个可用账号），不引入账号级差异。
	modelsMu          sync.Mutex
	modelsCache       map[string]*panelModelsSnapshot
	modelsRefreshedAt time.Time

	bootstrapMu sync.Mutex
	bootstraps  map[string]bootstrapSession

	// logins 进行中的 OAuth 设备授权会话（state → 会话信息）。
	// poll 成功或超时（loginTTL）后剔除；面板常驻进程，容量天然有界。
	loginMu sync.Mutex
	logins  map[string]loginSession
}

// loginTTL 授权 URL 的最长有效期：超时的 state 直接回收，
// 防止"开了添加账号弹窗就走开"的会话永久滞留。
const loginTTL = 15 * time.Minute

// 面板模型目录缓存：成功 10 分钟；上游失败负缓存 60 秒（期间不再打上游）。
// 手动刷新冷却 5 分钟，避免面板连点放大上游请求。
const (
	panelModelsTTL          = 10 * time.Minute
	panelModelsFailCooldown = 60 * time.Second
	panelModelsRefreshCool  = 5 * time.Minute
)

// panelModelsSnapshot 单域（cn/global）模型目录快照。失败时保留旧 infos，
// 并记 lastFail/lastErr 进入负缓存：冷却期内不再打上游。
type panelModelsSnapshot struct {
	infos    []upstream.ModelInfo
	fetched  time.Time
	lastFail time.Time
	lastErr  string
	// wait 非 nil 表示该域有一次拉取在途：并发请求等待它结束，避免同时打上游。
	wait chan struct{}
}

// panelModelsResult 单域读取结果：infos 是否来自缓存、缓存年龄与错误。
type panelModelsResult struct {
	infos     []upstream.ModelInfo
	fromCache bool
	stale     bool
	age       time.Duration
	err       error
}

// modelsDomain 按域读取/刷新模型目录（调用方已确认该域有可用账号）。
// 命中 TTL 直接返回；失败负缓存期内不打上游。成功 10 分钟 TTL，失败 60 秒负缓存；
// 失败时保留旧条目，由调用方按旧快照继续展示。
func (p *Panel) modelsDomain(realm string, force bool, fetch func() ([]upstream.ModelInfo, error)) panelModelsResult {
	var snap *panelModelsSnapshot
	for {
		p.modelsMu.Lock()
		snap = p.modelsCache[realm]
		if snap == nil {
			snap = &panelModelsSnapshot{}
			p.modelsCache[realm] = snap
		}
		if !force {
			if len(snap.infos) > 0 && time.Since(snap.fetched) < panelModelsTTL {
				p.modelsMu.Unlock()
				return panelModelsResult{infos: snap.infos, fromCache: true, age: time.Since(snap.fetched)}
			}
			if !snap.lastFail.IsZero() && time.Since(snap.lastFail) < panelModelsFailCooldown {
				res := panelModelsResult{infos: snap.infos, fromCache: true, stale: len(snap.infos) > 0, age: cacheAge(snap.fetched), err: fmt.Errorf("%s", snap.lastErr)}
				p.modelsMu.Unlock()
				return res
			}
		}
		if snap.wait == nil {
			snap.wait = make(chan struct{})
			p.modelsMu.Unlock()
			break
		}
		// 旧快照已过成功 TTL：不再阻塞等别人拉，直接按旧列表返回（标 stale）。
		if len(snap.infos) > 0 {
			p.modelsMu.Unlock()
			return panelModelsResult{infos: snap.infos, fromCache: true, stale: true, age: cacheAge(snap.fetched)}
		}
		// 该域已有拉取在途：等它结束后重新判定（命中缓存/负缓存，或紧接着自己拉）。
		wait := snap.wait
		p.modelsMu.Unlock()
		<-wait
	}

	infos, err := fetch()
	now := time.Now()
	p.modelsMu.Lock()
	defer p.modelsMu.Unlock()
	close(snap.wait)
	snap.wait = nil
	if err != nil || len(infos) == 0 {
		if err == nil {
			err = fmt.Errorf("上游未返回可用模型")
		}
		snap.lastFail = now
		snap.lastErr = err.Error()
		return panelModelsResult{infos: snap.infos, fromCache: len(snap.infos) > 0, stale: len(snap.infos) > 0, age: cacheAge(snap.fetched), err: err}
	}
	snap.infos = infos
	snap.fetched = now
	snap.lastFail = time.Time{}
	snap.lastErr = ""
	return panelModelsResult{infos: infos}
}

// cacheAge 缓存年龄：从未成功拉取时返回 0，避免 time.Since(零值) 得到荒谬大数。
func cacheAge(fetched time.Time) time.Duration {
	if fetched.IsZero() {
		return 0
	}
	return time.Since(fetched)
}

// loginSession 进行中的 OAuth 会话：创建时刻 + realm（cn/global，用于落盘与端点切换）。
type loginSession struct {
	created time.Time
	realm   string // "cn" / "global"，缺省 cn
}

type bootstrapState struct {
	Running     bool      `json:"running"`
	Completed   bool      `json:"completed"`
	Partial     bool      `json:"partial"`
	Failed      bool      `json:"failed"`
	Total       int       `json:"total"`
	Succeeded   int       `json:"succeeded"`
	FailedCount int       `json:"failed_count"`
	Error       string    `json:"error,omitempty"`
	StartedAt   time.Time `json:"started_at,omitempty"`
	EndedAt     time.Time `json:"ended_at,omitempty"`
}

type bootstrapSession struct {
	state    bootstrapState
	lastUsed time.Time
}

const maxBootstrapSessions = 64
const bootstrapSessionTTL = 24 * time.Hour

// New 构建面板。
func New(cfg Config) *Panel {
	if cfg.Tasks == nil {
		cfg.Tasks = tasks.New(tasks.Config{Pool: cfg.Pool, Upstream: cfg.Upstream})
	}
	if cfg.RedisMode == "" {
		cfg.RedisMode = "noop"
	}
	p := &Panel{
		cfg:         cfg,
		mux:         http.NewServeMux(),
		started:     time.Now(),
		logs:        NewRing(500),
		modelsCache: map[string]*panelModelsSnapshot{},
		logins:      map[string]loginSession{},
		bootstraps:  map[string]bootstrapSession{},
	}
	p.routes()
	return p
}

// Logs 返回日志环形缓冲（main 经 MultiWriter 镜像 log 与 chat 表格日志进来）。
func (p *Panel) Logs() *Ring { return p.logs }

func bootstrapKey(r *http.Request) string {
	c, err := r.Cookie("wb_local_session")
	if err != nil || c.Value == "" {
		return "anonymous"
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(c.Value)))
}

func (p *Panel) bootstrapStatus(w http.ResponseWriter, r *http.Request) {
	key := bootstrapKey(r)
	p.bootstrapMu.Lock()
	state := p.bootstraps[key].state
	p.bootstrapMu.Unlock()
	writeJSON(w, http.StatusOK, state)
}

func (p *Panel) bootstrapStart(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusNotImplemented, "scheduler not available")
		return
	}
	key := bootstrapKey(r)
	p.bootstrapMu.Lock()
	entry, exists := p.bootstraps[key]
	now := time.Now()
	if exists && !entry.state.Running && now.Sub(entry.lastUsed) > bootstrapSessionTTL {
		delete(p.bootstraps, key)
		exists = false
	}
	if exists && (entry.state.Running || (entry.state.Completed && !entry.state.Partial && !entry.state.Failed)) {
		entry.lastUsed = time.Now()
		p.bootstraps[key] = entry
		state := entry.state
		p.bootstrapMu.Unlock()
		writeJSON(w, http.StatusOK, state)
		return
	}
	for candidate, candidateEntry := range p.bootstraps {
		if !candidateEntry.state.Running && now.Sub(candidateEntry.lastUsed) > bootstrapSessionTTL {
			delete(p.bootstraps, candidate)
		}
	}
	if len(p.bootstraps) >= maxBootstrapSessions {
		oldestKey := ""
		var oldest time.Time
		for candidate, candidateEntry := range p.bootstraps {
			if candidateEntry.state.Running {
				continue
			}
			if oldestKey == "" || candidateEntry.lastUsed.Before(oldest) {
				oldestKey, oldest = candidate, candidateEntry.lastUsed
			}
		}
		if oldestKey != "" {
			delete(p.bootstraps, oldestKey)
		} else if _, exists := p.bootstraps[key]; !exists {
			p.bootstrapMu.Unlock()
			writeErr(w, http.StatusTooManyRequests, "too many bootstrap sessions are running")
			return
		}
	}
	startedAt := time.Now()
	state := bootstrapState{Running: true, StartedAt: startedAt}
	p.bootstraps[key] = bootstrapSession{state: state, lastUsed: startedAt}
	p.bootstrapMu.Unlock()
	go func() {
		result := p.cfg.Scheduler.RunBalanceRefreshNow()
		completed := result.Failed == 0 || result.Completed > 0
		partial := result.Completed > 0 && result.Failed > 0
		failed := result.Total > 0 && result.Completed == 0 && result.Failed > 0
		message := ""
		if result.Failed > 0 {
			message = fmt.Sprintf("%d/%d 个账号同步失败", result.Failed, result.Total)
		}
		p.bootstrapMu.Lock()
		p.bootstraps[key] = bootstrapSession{
			state: bootstrapState{
				Completed: completed, Partial: partial, Failed: failed,
				Total: result.Total, Succeeded: result.Completed, FailedCount: result.Failed,
				Error: message, StartedAt: startedAt, EndedAt: time.Now(),
			},
			lastUsed: time.Now(),
		}
		p.bootstrapMu.Unlock()
	}()
	writeJSON(w, http.StatusAccepted, state)
}

func (p *Panel) routes() {
	p.mux.HandleFunc("GET /panel/api/meta/status", p.MetaStatus)
	p.mux.HandleFunc("GET /panel/api/meta/nodes", p.MetaNodes)
	p.mux.HandleFunc("GET /panel/api/meta/stats", p.MetaStats)
	p.mux.HandleFunc("GET /panel/api/meta/tests", p.MetaTests)
	p.mux.HandleFunc("POST /panel/api/meta/tests", p.MetaTests)
	p.mux.HandleFunc("GET /panel/api/meta/subscriptions", p.MetaSubscriptions)
	p.mux.HandleFunc("POST /panel/api/meta/subscriptions", p.MetaSubscriptions)
	p.mux.HandleFunc("POST /panel/api/meta/accounts/{uid}/bind", p.MetaBind)
	p.mux.HandleFunc("GET /panel/vendor/latency-trend.js", p.MetaAsset)

	p.mux.HandleFunc("GET /panel/api/maintenance/status", p.maintenanceStatus)
	p.mux.HandleFunc("POST /panel/api/maintenance/run", p.maintenanceRun)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/toggle_disabled", p.toggleDisabled)
	p.mux.HandleFunc("GET /panel/api/preferences", p.preferencesGet)
	p.mux.HandleFunc("POST /panel/api/preferences", p.preferencesSet)

	p.mux.HandleFunc("GET /panel/{$}", p.index)
	p.mux.HandleFunc("GET /panel/app.js", p.appScript)
	p.mux.HandleFunc("GET /panel/assets/", p.assets)
	p.mux.HandleFunc("GET /panel/api/egress", p.EgressMatrix)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/proxy", p.AccountSetProxy)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/egress", p.AccountEgress)
	p.mux.HandleFunc("GET /panel/api/accounts/export", p.AccountsExport)
	p.mux.HandleFunc("POST /panel/api/accounts/import", p.AccountsImport)
	p.mux.HandleFunc("GET /panel/api/overview", p.overview)
	p.mux.HandleFunc("GET /panel/api/session/bootstrap/status", p.bootstrapStatus)
	p.mux.HandleFunc("POST /panel/api/session/bootstrap", p.bootstrapStart)
	p.mux.HandleFunc("GET /panel/api/logs", p.logsHandler)
	p.mux.HandleFunc("GET /panel/api/request_metrics", p.requestMetrics)
	p.mux.HandleFunc("GET /panel/api/request_logs", p.requestLogs)
	p.mux.HandleFunc("GET /panel/api/models", p.models)
	p.mux.HandleFunc("POST /panel/api/models/refresh", p.modelsRefresh)
	p.mux.HandleFunc("POST /panel/api/login/start", p.loginStart)
	p.mux.HandleFunc("GET /panel/api/login/poll", p.loginPoll)
	p.mux.HandleFunc("GET /panel/api/login/regions", p.loginRegions)
	p.mux.HandleFunc("POST /panel/api/import/cockpit", p.importCockpit)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/revive", p.accountRevive)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/disable", p.accountDisable)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/pause", p.accountPause)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/resume", p.accountResume)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/checkin", p.accountCheckin)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/balance", p.accountBalance)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/remove", p.accountRemove)
	p.mux.HandleFunc("GET /panel/api/accounts/{uid}/tasks", p.accountTasks)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/tasks/accept", p.accountTaskAccept)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/tasks/accept_all", p.taskAcceptAll)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/tasks/claim", p.accountTaskClaim)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/tasks/auto", p.accountTaskAuto)
	p.mux.HandleFunc("POST /panel/api/accounts/{uid}/tasks/auto_all", p.accountTaskAutoAll)
	p.mux.HandleFunc("POST /panel/api/tasks/scan_all", p.tasksScanAll)
	p.mux.HandleFunc("POST /panel/api/tasks/run_queue", p.tasksRunQueue)
	p.mux.HandleFunc("GET /panel/api/tasks/queue", p.tasksQueueStatus)
	p.mux.HandleFunc("GET /panel/api/school/vouchers", p.schoolVouchers)
	p.mux.HandleFunc("POST /panel/api/checkin_all", p.checkinAll)
	p.mux.HandleFunc("POST /panel/api/travel_all", p.travelAll)
	p.mux.HandleFunc("POST /panel/api/activity_all", p.activityAll)
	p.mux.HandleFunc("POST /panel/api/keepalive_all", p.keepaliveAll)
	p.mux.HandleFunc("POST /panel/api/balance_all", p.balanceAll)
	p.mux.HandleFunc("GET /panel/api/packages", p.packages)
	p.mux.HandleFunc("GET /panel/api/usage", p.usage)
	p.mux.HandleFunc("POST /panel/api/usage/save", p.usageSave)
	p.mux.HandleFunc("GET /panel/api/model_probes", p.modelProbes)
	p.mux.HandleFunc("GET /panel/api/config", p.getConfig)
	p.mux.HandleFunc("POST /panel/api/config", p.saveConfig)
}

// ServeHTTP 统一入口：先写安全响应头再分发，保证页面、静态资源、API
// 与 401 错误响应全都带上（API 也可能在浏览器里被直接打开）。
func (p *Panel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	// 静态资源路径含 ".." 时直接拒绝：ServeMux 会先做 307 清洗重定向，
	// 到达 assets handler 前已失去原文，这里提前返回 400。
	if strings.HasPrefix(r.URL.Path, "/panel/assets/") && hasDotDotSegment(r.URL.Path) {
		http.Error(w, "invalid asset path", http.StatusBadRequest)
		return
	}
	p.mux.ServeHTTP(w, r)
}

// expiringSoonWindow 返回调度器当前生效的快过期路由窗口；测试面板无调度器时返回 0。
func (p *Panel) expiringSoonWindow() time.Duration {
	if p.cfg.Scheduler == nil {
		return 0
	}
	return p.cfg.Scheduler.ExpiringSoonWindow()
}

// ---------------------------------------------------------------------------
// 只读接口
// ---------------------------------------------------------------------------

// overview 总览：池计数 + 每账号状态 + 面板元信息。
func (p *Panel) overview(w http.ResponseWriter, r *http.Request) {
	// 用 WithPaused 而不是 CountsDetailed：后者把暂停号并进 disabled（/status 的
	// 「不可用」口径），而概况卡片要分开展示（issue #125）。
	total, healthy, cooling, disabled, paused, inFlightFull := p.cfg.Pool.CountsDetailedWithPaused()
	sticky := 0
	if p.cfg.StickyCount != nil {
		sticky = p.cfg.StickyCount()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version":         p.cfg.Version,
		"demo":            p.cfg.Demo,
		"uptime_sec":      int(time.Since(p.started).Seconds()),
		"auth_required":   true,
		"redis_mode":      p.cfg.RedisMode,
		"sticky_sessions": sticky,
		"total":           total,
		"healthy":         healthy,
		"cooling":         cooling,
		"disabled":        disabled,
		"paused":          paused,
		"in_flight_full":  inFlightFull,
		"accounts":        p.cfg.Pool.List(),
		// model_locks 模型级限流全清单（哪些模型不能用、锁了几个号、还要锁多久）：
		// 与 accounts 的账号池视图互补，前端「模型锁池」表直接渲染。无锁时为 null。
		"model_locks": p.cfg.Pool.ModelLockView(),
	})
}

// logsHandler 返回日志环形缓冲快照（时间升序，含频道标记 chat/task/sys）。
func (p *Panel) logsHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"entries": p.logs.Snapshot()})
}

// requestMetrics 返回进程内指标与归档状态。recent 一律投影为脱敏摘要，
// 避免 request_id/账号/来源随指标响应铺进错误列表；详情改走 id 查询。
func (p *Panel) requestMetrics(w http.ResponseWriter, r *http.Request) {
	if p.cfg.RequestLog == nil {
		writeErr(w, http.StatusNotImplemented, "request logger not available")
		return
	}
	snapshot := p.cfg.RequestLog.Snapshot()
	recent := requestLogSummaries(snapshot.Recent)
	snapshot.Recent = nil
	writeJSON(w, http.StatusOK, struct {
		telemetry.Snapshot
		Recent []requestLogSummary `json:"recent"`
	}{Snapshot: snapshot, Recent: recent})
}

// requestLogs 读取错误记录。三种读法共用同一路由，避免新增未受 no_logs 闸门
// 保护的入口：
//   - id=<稳定ID>：单条详情（列表点击后按需 GET）；
//   - summary=1：脱敏摘要，只含展示所需字段与稳定 ID，不含 request_id/账号/来源；
//   - 默认：完整事件数组，保留给运维与既有测试使用。
func (p *Panel) requestLogs(w http.ResponseWriter, r *http.Request) {
	if p.cfg.RequestLog == nil {
		writeErr(w, http.StatusNotImplemented, "request logger not available")
		return
	}
	q := r.URL.Query()
	if id := strings.TrimSpace(q.Get("id")); id != "" {
		event, err := p.findRequestLog(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if event == nil {
			writeErr(w, http.StatusNotFound, "request log not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entry": event})
		return
	}
	limit := 200
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := p.cfg.RequestLog.ReadArchive(limit, telemetry.Filter{
		Outcome:   q.Get("outcome"),
		Account:   q.Get("account"),
		Model:     q.Get("model"),
		ClientIP:  q.Get("client_ip"),
		UserAgent: q.Get("user_agent"),
		From:      parseTimeParam(q.Get("from")),
		To:        parseTimeParam(q.Get("to")),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// 空结果回 []（而不是 JSON null）：前端把 null 与"归档关闭"混在一起会走错分支，
	// 显示成不满足筛选条件的最近请求。
	if rows == nil {
		rows = []telemetry.Event{}
	}
	if q.Get("summary") == "1" {
		writeJSON(w, http.StatusOK, map[string]any{"entries": requestLogSummaries(rows), "limit": limit})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": rows, "limit": limit})
}

// requestLogSummary 是错误列表的最小投影：稳定 ID 用于按需取详情，
// 其余字段只够渲染“时间/模型/类别/状态/延迟”，不含 request_id、账号、IP、UA。
type requestLogSummary struct {
	ID         string    `json:"id"`
	Time       time.Time `json:"time"`
	Model      string    `json:"model,omitempty"`
	Status     int       `json:"status"`
	Outcome    string    `json:"outcome"`
	DurationMs int64     `json:"duration_ms"`
}

func requestLogSummaries(rows []telemetry.Event) []requestLogSummary {
	out := make([]requestLogSummary, 0, len(rows))
	for _, e := range rows {
		if e.Outcome == telemetry.OutcomeSuccess || e.OK {
			continue
		}
		out = append(out, requestLogSummary{
			ID:         reqlog.EventID(e),
			Time:       e.Time,
			Model:      e.Model,
			Status:     e.Status,
			Outcome:    e.Outcome,
			DurationMs: e.DurationMs,
		})
	}
	return out
}

// findRequestLog 优先查归档，归档关闭或未命中时回落内存错误列表。
func (p *Panel) findRequestLog(id string) (*telemetry.Event, error) {
	if finder, ok := p.cfg.RequestLog.(interface {
		FindArchive(string) (*telemetry.Event, error)
	}); ok {
		event, err := finder.FindArchive(id)
		if err != nil || event != nil {
			return event, err
		}
	}
	if finder, ok := p.cfg.RequestLog.(interface{ FindRecent(string) *telemetry.Event }); ok {
		return finder.FindRecent(id), nil
	}
	return nil, nil
}

// models 查询上游模型列表与 reasoning 实际档位：10 分钟内读本面板缓存，过期才直连
// 上游（失败 60 秒负缓存）。回答"该模型到底支持哪几档思考"，同时刷新 client 的
// effort 降级能力缓存。
// 与 /v1/models 同口径的双域输出：CN 域模型加 "cn:" 前缀、global 域加 "global:" 前缀
// （gateway 路由协议，前端显示的 id 就是调用时要填的完整 model 值）。
// 各域独立探测、独立容错：某域无可用账号则整域跳过；两域全空时才报错
// （有错误明细回 502，一个账号都没有回 503）。响应带 cached / cache_age_seconds，
// 旧列表兜底时另带 stale:true。
func (p *Panel) models(w http.ResponseWriter, r *http.Request) {
	p.serveModels(w, false)
}

// modelsRefresh 手动刷新模型目录（POST）。5 分钟冷却内直接返回 ok:false，
// 且不触发任何上游请求；冷却外强制重拉并按同一缓存结构写回。
func (p *Panel) modelsRefresh(w http.ResponseWriter, r *http.Request) {
	p.modelsMu.Lock()
	if !p.modelsRefreshedAt.IsZero() {
		if remaining := panelModelsRefreshCool - time.Since(p.modelsRefreshedAt); remaining > 0 {
			secs := int((remaining + time.Second - 1) / time.Second)
			p.modelsMu.Unlock()
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "cooldown_seconds": secs})
			return
		}
	}
	p.modelsRefreshedAt = time.Now()
	p.modelsMu.Unlock()
	p.serveModels(w, true)
}

// serveModels 读取（force=false）或强制刷新（force=true）两域模型目录。
// 缓存按 realm 分键、每域单快照，与 /v1/models 的全局缓存口径一致；
// 失败负缓存期内不打上游，已有旧列表继续返回（不清空）。
func (p *Panel) serveModels(w http.ResponseWriter, force bool) {
	out := make([]map[string]any, 0)
	var fetchErrs []string
	allCached := true
	anyStale := false
	ageSeconds := 0

	// CN 域：有可用 CN 账号才查（此前无条件 Pool.Pick()+FetchModels——选中 global
	// 账号时打 CN 端点必然失败，混合池表现为偶发 502，纯 global 池必炸）。
	if uids := p.cfg.Pool.AvailableUIDsForRealm("cn"); len(uids) > 0 {
		if acct := p.cfg.Pool.AuthByUID(uids[0]); acct != nil {
			res := p.modelsDomain("cn", force, func() ([]upstream.ModelInfo, error) {
				return p.cfg.Upstream.FetchModels(acct)
			})
			if res.err != nil {
				fetchErrs = append(fetchErrs, "cn: "+res.err.Error())
			}
			if !res.fromCache {
				allCached = false
			}
			anyStale = anyStale || res.stale
			if res.age > time.Duration(ageSeconds)*time.Second {
				ageSeconds = int(res.age / time.Second)
			}
			for _, mi := range res.infos {
				out = append(out, panelModelEntry("cn", mi, mi.Efforts, mi.DefaultEffort, p.cfg.Upstream.HTTP))
			}
		}
	}

	// global 域：路由开关开且有可用 global 账号才查（独立目录端点，FetchGlobalModelInfos；
	// Upstream.GlobalEnabled 是探测侧同一道闸，与 main 装配的 config global.enabled 一致）。
	if p.cfg.Upstream.GlobalEnabled {
		if uids := p.cfg.Pool.AvailableUIDsForRealm("global"); len(uids) > 0 {
			if acct := p.cfg.Pool.AuthByUID(uids[0]); acct != nil {
				res := p.modelsDomain("global", force, func() ([]upstream.ModelInfo, error) {
					infos := p.cfg.Upstream.FetchGlobalModelInfos(acct)
					if len(infos) == 0 {
						return nil, fmt.Errorf("上游未返回可用模型")
					}
					return infos, nil
				})
				if res.err != nil {
					fetchErrs = append(fetchErrs, "global: "+res.err.Error())
				}
				if !res.fromCache {
					allCached = false
				}
				anyStale = anyStale || res.stale
				if res.age > time.Duration(ageSeconds)*time.Second {
					ageSeconds = int(res.age / time.Second)
				}
				efforts, defaults := p.cfg.Upstream.GlobalEffortSnapshot()
				for _, mi := range res.infos {
					out = append(out, panelModelEntry("global", mi, efforts[mi.ID], defaults[mi.ID], p.cfg.Upstream.HTTP))
				}
			}
		}
	}

	if len(out) == 0 {
		if len(fetchErrs) > 0 {
			writeErr(w, http.StatusBadGateway, "fetch models: "+strings.Join(fetchErrs, "; "))
			return
		}
		writeErr(w, http.StatusServiceUnavailable, "没有可用账号：请先在面板添加账号再查询")
		return
	}
	body := map[string]any{
		"ok":                true,
		"models":            out,
		"cached":            allCached,
		"cache_age_seconds": ageSeconds,
	}
	if anyStale {
		body["stale"] = true
	}
	writeJSON(w, http.StatusOK, body)
}

// panelModelEntry 构造单个模型条目（两域共用）：id 带 realm 前缀（调用值即显示值），
// context_length / max_output_tokens 走四级查找链，effort 档位按 realm 域取
// EffortListing（远端权威 ∪ 静态兜底表）——与 /v1/models 同一口径，两侧不再漂移。
func panelModelEntry(realm string, mi upstream.ModelInfo, remoteEfforts []string, remoteDefault string, httpc *http.Client) map[string]any {
	entry := map[string]any{
		"id":                   realm + ":" + mi.ID,
		"realm":                realm,
		"name":                 mi.Name,
		"default_effort":       mi.DefaultEffort,
		"supported_efforts":    mi.Efforts,
		"can_disable_thinking": mi.CanDisableThinking,
		"supports_reasoning":   mi.SupportsReasoning,
		"supports_images":      mi.SupportsImages,
		"credits":              mi.Credits,
		"description":          mi.Description,
		"tags":                 mi.Tags,
		"vendor":               mi.Vendor,
		"is_default":           mi.IsDefault,
		"supports_tool_call":   mi.SupportsToolCall,
		"only_reasoning":       mi.OnlyReasoning,
		"reasoning_effort":     mi.ReasoningEffort,
		"reasoning_summary":    mi.ReasoningSummary,
	}
	// 限时优惠（modelPromotions）：credits 是牌价，promo_* 是当前生效折扣
	//（WorkBuddy 客户端显示的就是这个生效价）。前端据此显示「生效价+标签+划线牌价」。
	if mi.PromoFactor != nil {
		entry["promo_factor"] = *mi.PromoFactor
		entry["promo_credits"] = mi.PromoCredits
	}
	if mi.PromoLabel != "" {
		entry["promo_label"] = mi.PromoLabel
	}
	if mi.PromoNote != "" {
		entry["promo_note"] = mi.PromoNote
	}
	if mi.MaxAllowedSize > 0 {
		entry["max_allowed_size"] = mi.MaxAllowedSize
	}
	entry["context_length"] = upstream.ContextWindowListingV4(mi.ID, mi.ContextWindow, httpc)
	if mo, ok := upstream.MaxOutputTokensListingV4(mi.ID, mi.MaxTokens, httpc); ok {
		entry["max_output_tokens"] = mo
	}
	if efforts, def := upstream.EffortListing(realm, mi.ID, remoteEfforts, remoteDefault); efforts != nil {
		entry["supported_efforts"] = efforts
		if def != "" {
			entry["default_effort"] = def
		}
	}
	return entry
}

// modelProbes 返回模型输出上限的探测结果（scripts/probe_max_tokens.py --panel-out
// 写入的契约文件），供前端在「模型与档位」的实测列做风险标注。
//
// 设计边界：纯只读透传——文件缺失/未配置返回空集（面板退化为无标注，与历史行为
// 一致），网关自身不解析字段语义、不据此做任何路由或出站决策；上游改了限制后
// 重跑一次工具、下次查询即刷新，无需重启网关。
func (p *Panel) modelProbes(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"probes": map[string]json.RawMessage{}, "exists": false}
	if p.cfg.ProbeFile == "" {
		writeJSON(w, http.StatusOK, out)
		return
	}
	raw, err := os.ReadFile(p.cfg.ProbeFile)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, out)
			return
		}
		writeErr(w, http.StatusInternalServerError, "read probes: "+err.Error())
		return
	}
	var f struct {
		Version int                        `json:"version"`
		Probes  map[string]json.RawMessage `json:"probes"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		writeErr(w, http.StatusBadGateway, "parse probes: "+err.Error())
		return
	}
	if f.Probes == nil {
		f.Probes = map[string]json.RawMessage{}
	}
	out["probes"] = f.Probes
	out["exists"] = true
	if fi, err := os.Stat(p.cfg.ProbeFile); err == nil {
		out["updated_at"] = fi.ModTime().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// 账号运维
// ---------------------------------------------------------------------------

// accountRevive 手动复活：清禁用 + 冷却 + 熔断（运维口径无条件恢复）。
func (p *Panel) accountRevive(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	if _, ok := p.cfg.Pool.Status(uid); !ok {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	p.cfg.Pool.Revive(uid)
	log.Printf("panel: revive uid=%s（人工清除禁用/冷却/熔断）", uid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// accountDisable 人工禁用（不再参与选号，需面板 revive 或重登恢复）。
func (p *Panel) accountDisable(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	if _, ok := p.cfg.Pool.Status(uid); !ok {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	p.cfg.Pool.SetManualDisabled(uid, true)
	log.Printf("panel: disable uid=%s（人工禁用）", uid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// accountPause 暂停选号：账号退出选号候选，但**照常参与**签到 / 活跃上报 / 保活 /
// 余额刷新。与 disable 的区别：不写 reason、不清冷却域、不重置计数——账号是「临时
// 让位」而非「判死」，点「恢复选号」即可立刻回到池子（无需重登或解冻）。
func (p *Panel) accountPause(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	if !p.cfg.Pool.Pause(uid) {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	log.Printf("panel: pause uid=%s（暂停选号，保号任务照常）", uid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// accountResume 解除暂停选号（幂等，对未暂停账号为空操作）。
func (p *Panel) accountResume(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	if !p.cfg.Pool.Resume(uid) {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	log.Printf("panel: resume uid=%s（恢复参与选号）", uid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// accountCheckin 单号签到：DailyCheckin + 余额查询解冻（已签到等业务错误不阻塞余额刷新），
// 与 scheduler.RunCheckinNow 的单号语义一致。
func (p *Panel) accountCheckin(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	a := p.cfg.Pool.AuthByUID(uid)
	if a == nil {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	checkinMsg := ""
	checkinDone := false
	// 企业版无签到体系（上游 400 code 10001「企业账号不支持该操作」）：不发起该调用，
	// 端点退化为「刷新额度」——企业额度走 get-enterprise-user-usage 口径（见 upstream）。
	// 前端对企业号不渲染「签到」按钮；此处是 API 侧防御（外部脚本/旧缓存前端仍可能调用）。
	if a.IsEnterprise() {
		checkinMsg = "企业账号无签到体系（已跳过签到，仅刷新额度）"
	} else if err := p.cfg.Upstream.DailyCheckin(a); err != nil {
		checkinMsg = err.Error() // "今天已签到"等业务错误照常查余额
		// 幂等拒绝同样是「今日已签」，标记后按钮显示「已签」。
		if upstream.IsAlreadyCheckin(err) {
			p.cfg.Pool.NoteCheckinDone(uid)
			checkinDone = true
		}
	} else {
		p.cfg.Pool.NoteCheckinDone(uid)
		checkinDone = true
	}
	resp := map[string]any{"ok": true, "checkin_done": checkinDone}
	if a.IsEnterprise() {
		resp["enterprise"] = true
	}
	if checkinMsg != "" {
		resp["checkin_message"] = checkinMsg
	}
	remain, total, expiring, earliestAt, earliestRemaining, err := p.cfg.Upstream.UserResourceDetailedWithExpiry(a, p.expiringSoonWindow())
	if err != nil {
		resp["balance_error"] = err.Error()
		writeJSON(w, http.StatusOK, resp)
		return
	}
	p.cfg.Pool.ReenableIfCredits(uid, remain, total)
	p.cfg.Pool.SetCreditsDetailed(uid, remain, total, expiring, earliestAt, earliestRemaining)
	resp["credits"] = remain
	resp["credits_total"] = total
	log.Printf("panel: checkin uid=%s msg=%q credits=%d/%d", uid, checkinMsg, remain, total)
	writeJSON(w, http.StatusOK, resp)
}

// accountBalance 单号余额刷新：更新余额与到期快照，不触碰冷却状态。
func (p *Panel) accountBalance(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	a := p.cfg.Pool.AuthByUID(uid)
	if a == nil {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	remain, total, expiring, earliestAt, earliestRemaining, err := p.cfg.Upstream.UserResourceDetailedWithExpiry(a, p.expiringSoonWindow())
	if err != nil {
		writeErr(w, http.StatusBadGateway, "user resource: "+err.Error())
		return
	}
	p.cfg.Pool.SetCreditsDetailed(uid, remain, total, expiring, earliestAt, earliestRemaining)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "credits": remain, "credits_total": total})
}

// accountRemove 移除账号：先出池（立即落盘 state），再删 auth 文件。
func (p *Panel) accountRemove(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	st, exists := p.cfg.Pool.Status(uid)
	if !exists {
		writeErr(w, 404, "account not found")
		return
	}
	if st.InFlight > 0 {
		writeErr(w, 409, "account has active requests; wait before deleting")
		return
	}
	if p.cfg.Meta != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		if e := p.cfg.Meta.DeleteAccountBinding(ctx, uid); e != nil {
			metaError(w, e)
			return
		}
	}
	a := p.cfg.Pool.Remove(uid)
	if a == nil {
		writeErr(w, http.StatusNotFound, "account not found")
		return
	}
	fileMsg := ""
	if a.FilePath != "" {
		if err := os.Remove(a.FilePath); err != nil && !os.IsNotExist(err) {
			fileMsg = err.Error()
		}
	}
	if fileMsg != "" {
		log.Printf("panel: remove uid=%s（auth 文件删除失败: %s）", uid, fileMsg)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "file_error": fileMsg})
		return
	}
	log.Printf("panel: remove uid=%s（已出池并删除凭证文件）", uid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------------------------------------------------------------------------
// 批量任务
// ---------------------------------------------------------------------------

// checkinAll 手动触发全量签到（异步执行，进度看日志区/账号状态变化）。
func (p *Panel) checkinAll(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusNotImplemented, "scheduler not available")
		return
	}
	go p.cfg.Scheduler.RunCheckinNow()
	log.Printf("panel: 手动全量签到已触发（含猫猫旅行）")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "started": true})
}

// travelAll 手动触发全量猫猫旅行巡检（异步执行）。
func (p *Panel) travelAll(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusNotImplemented, "scheduler not available")
		return
	}
	go p.cfg.Scheduler.RunTravelNow()
	log.Printf("panel: 手动全量旅行巡检已触发")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "started": true})
}

// activityAll 手动触发全量活跃上报（异步执行；点亮连登 + 解锁领养前置）。
func (p *Panel) activityAll(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusNotImplemented, "scheduler not available")
		return
	}
	go p.cfg.Scheduler.RunActivityNow()
	log.Printf("panel: 手动全量活跃上报已触发")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "started": true})
}

// keepaliveAll 手动触发全量 token 保活（异步执行）。
func (p *Panel) keepaliveAll(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusNotImplemented, "scheduler not available")
		return
	}
	go p.cfg.Scheduler.RunKeepaliveNow()
	log.Printf("panel: 手动全量保活已触发")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "started": true})
}

// balanceAll 手动全量刷新余额：并发查上游、写回池内 credits（含解冻语义），
// 完成后返回——面板紧接着拉 overview 即是最新值。账号量小（个位数），
// 同步等待（上限受短 RPC 超时约束）比"触发后盲刷"体验更确定。
func (p *Panel) balanceAll(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Scheduler == nil {
		writeErr(w, http.StatusNotImplemented, "scheduler not available")
		return
	}
	result := p.cfg.Scheduler.RunBalanceRefreshNow()
	log.Printf("panel: 手动全量余额刷新完成")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "total": result.Total, "completed": result.Completed, "failed": result.Failed})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// usage 返回逐请求用量聚合。统计窗口三选一：
//   - from/to（unix 秒）：显式区间，用于「今天」与「自定义」——区间由浏览器按
//     本地时区算好再发，服务端时区与浏览器不一致时「今天」才不会被算错；
//   - hours：滚动窗口（默认 72，上限 1440=60 天），卡片汇总/按域/按账号/按模型/
//     时序**全部**按该窗口统计；显式 hours=0 表示全部历史（含 90 天前折叠出的日桶）；
//   - 都不给：等同于 hours=72（保持旧调用方行为）。
func (p *Panel) usage(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Usage == nil {
		writeErr(w, http.StatusNotImplemented, "usage recorder not available")
		return
	}
	q := r.URL.Query()
	win := usage.Window{}
	win.From = parseTimeParam(q.Get("from"))
	win.To = parseTimeParam(q.Get("to"))
	if win.From.IsZero() && win.To.IsZero() {
		win.Hours = 72
		if v := q.Get("hours"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				win.Hours = n
			}
		}
		if win.Hours > 1440 {
			win.Hours = 1440
		}
	}
	// 昵称仅用于展示，取自池快照（不含任何凭证）。
	nicks := map[string]string{}
	for _, s := range p.cfg.Pool.List() {
		if s.Nickname != "" {
			nicks[s.UID] = s.Nickname
		}
	}
	var currentRate func(realm, model string) string
	if p.cfg.Upstream != nil {
		currentRate = p.cfg.Upstream.ModelRate
	}
	writeJSON(w, http.StatusOK, p.cfg.Usage.SnapshotWindow(win, nicks, currentRate))
}

// parseTimeParam 解析时间查询参数：unix 秒（前端默认）或 RFC3339（便于手工调
// 接口/写脚本）。空串与非法值都返回零值 = 该侧不设界，不报错——区间参数是可选
// 增强，拼错一个 from 不该让整页用量打不开。
func parseTimeParam(v string) time.Time {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Time{}
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		if n <= 0 {
			return time.Time{}
		}
		// 兼容秒与毫秒（前端可能直接把 Date.now() 传上来）。
		if n > 1e12 {
			return time.UnixMilli(n)
		}
		return time.Unix(n, 0)
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t
	}
	if t, err := time.ParseInLocation("2006-01-02T15:04", v, time.Local); err == nil {
		return t
	}
	return time.Time{}
}

// usageSave 立即把内存中的用量桶落盘（正常由后台 30s 防抖刷新负责）。
func (p *Panel) usageSave(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Usage == nil {
		writeErr(w, http.StatusNotImplemented, "usage recorder not available")
		return
	}
	p.cfg.Usage.Save()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// packages 返回全部账号的积分包构成，供「积分构成」视图对比。
//
// 逐个账号向上游查（并发有上限，避免瞬时打满上游限流），失败只在对应账号上
// 标 error，不影响其它账号——一个号 token 失效不该让整页空白。
func (p *Panel) packages(w http.ResponseWriter, r *http.Request) {
	accts := p.cfg.Pool.List()
	type row struct {
		UID      string                   `json:"uid"`
		Nickname string                   `json:"nickname"`
		Realm    string                   `json:"realm"`
		Remain   int64                    `json:"remain"`
		Size     int64                    `json:"size"`
		Packages []upstream.CreditPackage `json:"packages"`
		Error    string                   `json:"error,omitempty"`
	}
	out := make([]row, len(accts))

	sem := make(chan struct{}, 3)
	var wg sync.WaitGroup
	for i, s := range accts {
		select {
		case sem <- struct{}{}:
		case <-r.Context().Done():
			wg.Wait()
			return
		}
		wg.Add(1)
		go func(i int, s pool.Status) {
			defer wg.Done()
			defer func() { <-sem }()

			it := row{UID: s.UID, Nickname: s.Nickname, Realm: s.Realm}
			a := p.cfg.Pool.AuthByUID(s.UID)
			if a == nil {
				it.Error = "account not loaded"
				out[i] = it
				return
			}
			packs, remain, size, err := p.cfg.Upstream.CreditPackages(a)
			if err != nil {
				it.Error = err.Error()
				out[i] = it
				return
			}
			it.Packages = packs
			it.Remain = remain
			it.Size = size
			out[i] = it
		}(i, s)
	}
	wg.Wait()

	// 余额降序：多的在前，便于和少的对比。
	sort.SliceStable(out, func(i, j int) bool { return out[i].Remain > out[j].Remain })
	writeJSON(w, http.StatusOK, map[string]any{"accounts": out})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	raw, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": msg})
}
