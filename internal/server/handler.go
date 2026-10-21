// Responsibilities split from the gateway handler; behavior preserved.
package server

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/conversation"
	"github.com/linguo2625469/workbuddy2api-panel/internal/livecfg"
	"github.com/linguo2625469/workbuddy2api-panel/internal/modelpolicy"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/resource"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
	"net/http"
	"time"
)

// Config handler 依赖。
type Config struct {
	StrictContext      bool
	Spool              *spool.Store
	Pressure           func() bool
	LogsEnabled        bool
	NextCreditRecovery func(time.Time) time.Time
	ModelPolicy        *modelpolicy.Store
	History            *conversation.Store
	MaxBodyBytes       int64
	MaxConcurrent      int
	MaxWorkingBytes    int64
	Pool               *pool.Pool
	Upstream           *upstream.Client

	MaxRotate int // 单请求最多换号次数，默认 3
	// Session 会话粘性路由器（可选；nil = 关闭粘性，纯 Pick 轮换）。
	Session *session.Router
	// StickyCount 返回当前粘性会话绑定数（供 /status）；nil 时报告 0。
	StickyCount func() int
	// RedisMode 观测字段（"upstash" / "noop"），供 /status 透出。
	RedisMode    string
	SoftCooldown time.Duration // 429/限流文案软冷却基数，默认 600s（连续触发指数退避，封顶 soft_rate_max）
	RefreshSkew  time.Duration // token 提前刷新窗口，默认 10m

	// Panel 管理面板 handler（可选；nil = 不挂载）。挂载在 /panel/ 前缀下，
	// 会话鉴权位于 localauth 边界，面板提供内嵌静态资源。
	Panel http.Handler

	// Live 运行期可变配置（面板在线改 soft_rate / 脱敏开关时立即生效）。
	// nil 时回退静态字段（测试与裸用场景）。
	Live *livecfg.Holder

	// PromptMode "custom"（网关用自有提示词替换 system）/ "passthrough"（透传）。
	PromptMode string
	// PromptText custom 模式下注入的系统提示词文本（来自 config.PromptText）。
	PromptText string

	// GlobalEnabled global realm 路由开关（config global.enabled，缺省 true）。
	// handler 侧第三道闸（与 main 注入 auth 开关、upstream.GlobalEnabled 呼应）：
	// false（显式逃生门）时即便 auth realm=global 也不提供 global: 模型名
	// （modelList 不列 global 名单）。
	GlobalEnabled bool

	// Usage 逐请求用量记录器（可选；nil = 不记录）。
	// 在 recordAttempt 这一唯一汇聚点调用，因此流式/非流式、成功/失败都会计入，
	// 且与 pool 的每账号累计器同源，两条口径不会漂移。
	Usage *usage.Recorder

	// RequestLog 请求指标与脱敏 JSONL 归档（可选；nil = 不记录）。
	RequestLog telemetry.Sink

	// RecordClientInfo 是否在请求日志里记录调用来源（客户端 IP / User-Agent）。
	// 来自 logging.request_client_info（缺省 true）；关闭时 reqlog 事件的来源字段
	// 保持为空，归档与面板都不出现来源信息。
	RecordClientInfo bool
}

// loadLive 返回当前运行期快照；Live 为 nil 时用静态字段合成。
func (h *Handler) loadLive() livecfg.Snapshot {
	if h.cfg.Live != nil {
		return h.cfg.Live.Load()
	}
	return livecfg.Snapshot{
		SoftCooldown:     h.cfg.SoftCooldown,
		RecordClientInfo: h.cfg.RecordClientInfo,
	}
}

// softCooldown 返回当前生效的软冷却基数（热改优先，<=0 回退默认）。
func (h *Handler) softCooldown() time.Duration {
	if d := h.loadLive().SoftCooldown; d > 0 {
		return d
	}
	if h.cfg.SoftCooldown > 0 {
		return h.cfg.SoftCooldown
	}
	return 600 * time.Second
}

// ServiceName 网关身份标识。经 /healthz 响应体 service 字段与 X-Service 头同时透出：
// 宿主（如 workbuddy-switch 托管网关子进程）探测同端口的旧服务/其他服务时，对方即使
// 返回 2xx 也不带本标识，宿主据此可识别"假成功"。
const ServiceName = "workbuddy2api"

// Handler 主路由。
type Handler struct {
	cfg     Config
	mux     *http.ServeMux
	degrade degradeGate
	// wafIP WAF IP 级拦截状态机（fail-fast，wafip.go）：短窗多号 WAF 403 →
	// 激活期轮转遇 WAF 403 直接终止（不放大请求量）。进程内状态、重启清零。
	wafIP      wafIPGate
	slots      chan struct{}
	bodyBudget *resource.Budget
	workBudget *resource.Budget
	workLimit  int64
}

// NewHandler 构建 handler。
func NewHandler(cfg Config) *Handler {
	if cfg.MaxRotate <= 0 {
		cfg.MaxRotate = 3
	}
	if cfg.SoftCooldown <= 0 {
		cfg.SoftCooldown = 600 * time.Second // 软限流基数（连续触发按指数退避放大）
	}
	if cfg.RefreshSkew <= 0 {
		cfg.RefreshSkew = 10 * time.Minute
	}
	if cfg.PromptMode == "" {
		cfg.PromptMode = "custom" // 缺省 custom：网关自有提示词
	}
	if cfg.ModelPolicy == nil {
		cfg.ModelPolicy, _ = modelpolicy.Open("")
	}
	if cfg.History == nil {
		cfg.History, _ = conversation.Open(conversation.Options{})
	}
	if cfg.MaxBodyBytes <= 0 {
		cfg.MaxBodyBytes = 16 << 20
	}
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 8
	}
	h := &Handler{cfg: cfg, mux: http.NewServeMux(), slots: make(chan struct{}, cfg.MaxConcurrent)}
	h.bodyBudget = resource.NewBudget(cfg.MaxBodyBytes * 2)
	if cfg.MaxWorkingBytes <= 0 {
		cfg.MaxWorkingBytes = 256 << 20
	}
	h.workLimit = cfg.MaxWorkingBytes
	h.workBudget = resource.NewBudget(cfg.MaxWorkingBytes)
	h.mux.HandleFunc("POST /v1/chat/completions", h.chatCompletions)
	h.mux.HandleFunc("POST /v1/responses", h.responses)
	h.mux.HandleFunc("POST /responses", h.responses)
	h.mux.HandleFunc("GET /panel/api/capabilities", h.capabilities)
	h.mux.HandleFunc("GET /panel/api/resource", h.resourceStatus)
	h.mux.HandleFunc("GET /panel/api/model_policy", h.modelPolicyGet)
	h.mux.HandleFunc("POST /panel/api/model_policy", h.modelPolicySet)
	h.mux.HandleFunc("GET /panel/api/memory", h.memoryStatus)
	h.mux.HandleFunc("POST /panel/api/memory/clear", h.memoryClear)
	h.mux.HandleFunc("GET /v1/models", h.models)
	h.mux.HandleFunc("GET /status", h.status)
	h.mux.HandleFunc("GET /healthz", h.healthz)
	h.mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/panel/", http.StatusSeeOther) })
	if cfg.Panel != nil {
		h.mux.Handle("/panel/", cfg.Panel) // /panel → /panel/ 由 ServeMux 自动重定向
	}
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.LogsEnabled && (r.URL.Path == "/panel/api/logs" || r.URL.Path == "/panel/api/request_logs" || r.URL.Path == "/panel/api/request_metrics") {
		writeOpenAIError(w, 404, "feature_disabled", "request logging disabled")
		return
	}

	if r.Method == "POST" && (r.URL.Path == "/v1/chat/completions" || r.URL.Path == "/v1/responses" || r.URL.Path == "/responses") {
		next, cleanup, ok := h.admit(w, r)
		if !ok {
			return
		}
		r = next
		defer cleanup()
	}

	if h.cfg.RequestLog != nil && r.Method == http.MethodPost && (r.URL.Path == "/v1/chat/completions" || r.URL.Path == "/v1/responses" || r.URL.Path == "/responses") {
		trace := &requestTrace{path: r.URL.Path, id: telemetry.NewRequestID(), start: time.Now()}
		if h.loadLive().RecordClientInfo {
			trace.captureClientInfo(r)
		}
		r = r.WithContext(context.WithValue(r.Context(), requestTraceKey{}, trace))
		obs := &responseObserver{ResponseWriter: w}
		w.Header().Set("X-Request-Id", trace.id)
		h.cfg.RequestLog.Begin()
		defer func() {
			status := obs.status
			if status == 0 {
				status = http.StatusOK
			}
			h.cfg.RequestLog.Record(trace.event(status))
		}()
		h.mux.ServeHTTP(obs, r)
		return
	}
	h.mux.ServeHTTP(w, r)
}
