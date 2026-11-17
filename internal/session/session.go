// Package session 会话粘性路由：同一会话（conversationId / metadata 键）尽量绑定同一账号。
//
// 设计参考 antigravityProxyGo internal/session（fast-path RLock / 双段分配 / TTL / 持久化），
// 但改为纯内存 + redisstore 异步镜像：
//   - 命中走 RLock 快查（绝大多数请求已绑定）；
//   - 未命中/失效走写锁 re-check 后分配，避免同 key 并发重复分配（TOCTOU 防护）；
//   - 分配优先"空闲账号"（未绑定任何会话的可用号）走 Pool SWRR，其次全池 SWRR；
//   - LastActive 滚动续期，带最大轮数上限防僵化；TTL 过期由后台 GC 或快路径惰性过期清理；
//   - 每次绑定变更 fire-and-forget 镜像到 redisstore（防重启丢粘性）。
package session

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/redisstore"
)

// entry 单条会话绑定。
type entry struct {
	uid        string
	lastActive time.Time
	turns      int  // 累计服务轮数（防单号无限连击打穿）
	isDerived  bool // 是否为内容哈希派生键
}

// Config 路由依赖；Available 返回"可用账号"（healthy 且未占满在途）的有序 uid 列表，
// 由 pool.AvailableUIDs 提供。Store 可为 redisstore.Noop（纯内存）。
type Config struct {
	LocalPath  string
	MaxEntries int
	TTL        time.Duration
	// DerivedTTL 派生兜底会话（d- 前缀）TTL，默认 5m。
	DerivedTTL time.Duration
	// MaxTurns 显式会话最大轮数上限，默认 10 轮。
	MaxTurns int
	// MaxDerivedTurns 派生兜底会话最大轮数上限，默认 5 轮。
	MaxDerivedTurns int
	GCInterval      time.Duration
	Store           redisstore.Store
	Available       func() []string
	// AvailableForModel 按请求模型返回"在该模型上可用"的账号（healthy 且未占满在途，
	// 且未被该模型限流/限额）。nil 时回落 Available（无模型维度，行为与引入前一致）。
	//
	// 为什么粘性需要模型维度：绑定只记 uid，而同一个会话可能换模型。账号被 6004
	// 模型级限额后对**其他模型**仍可用，此时若只按账号级可用性
	// 校验，会话会被钉在这个号上反复失败——正是"限额后换不动号"的观感来源。
	AvailableForModel func(model string) []string
	// PickBest 按请求模型使用 SWRR 从候选账号集合中挑选当前最优健康账号（取代静态哈希取模）。
	PickBest func(model string, candidates []string) string
}

// Router 会话粘性路由器。
type Router struct {
	diskMu  sync.Mutex
	mu      sync.RWMutex
	entries map[string]entry
	cfg     Config
	stop    chan struct{}
}

// New 构建路由器。若 cfg.Store 为 nil 则用 Noop（纯内存）；cfg.Available 为 nil 视为空池。
// TTL/GCInterval 非正取默认（30m / 5m）——main 从 config 解析后传入，这里兜底。
func New(cfg Config) *Router {
	if cfg.MaxEntries > 4096 {
		cfg.MaxEntries = 4096
	}
	if cfg.MaxEntries <= 0 {
		cfg.MaxEntries = 4096
	}
	if cfg.Store == nil {
		cfg.Store = redisstore.Noop{}
	}
	if cfg.TTL <= 0 {
		cfg.TTL = 30 * time.Minute
	}
	if cfg.DerivedTTL <= 0 || cfg.DerivedTTL > cfg.TTL {
		if cfg.TTL < 5*time.Minute {
			cfg.DerivedTTL = cfg.TTL
		} else {
			cfg.DerivedTTL = 5 * time.Minute
		}
	}
	if cfg.MaxTurns <= 0 {
		cfg.MaxTurns = 10
	}
	if cfg.MaxDerivedTurns <= 0 {
		cfg.MaxDerivedTurns = 5
	}
	if cfg.GCInterval <= 0 {
		cfg.GCInterval = 5 * time.Minute
	}
	return &Router{entries: map[string]entry{}, cfg: cfg}
}

// StartGC 启动后台 GC goroutine（幂等）。进程退出时调 StopGC。
//
// stop channel 必须在启 goroutine 前捕获到**局部变量**：goroutine 在 select 里
// 每轮重新求值 r.stop 是无锁读，而 StopGC 持写锁把它置 nil——既是数据竞争
// （-race 可复现），又会在读到 nil 后让该 case 永久阻塞（nil channel 永不就绪），
// 于是关停彻底失效：goroutine 再也不会退出，ticker 无限触发 gcOnce（goroutine
// 泄漏 + 关停后仍持续 GC）。捕获局部变量后，close(stop) 与 select 观测的是同一个
// channel，StopGC 一定能让 goroutine 退出。
func (r *Router) StartGC() {
	r.mu.Lock()
	if r.stop != nil {
		r.mu.Unlock()
		return
	}
	stop := make(chan struct{})
	r.stop = stop
	r.mu.Unlock()

	go func() {
		t := time.NewTicker(r.cfg.GCInterval)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				r.gcOnce(time.Now())
				if err := r.FlushLocal(); err != nil {
					log.Printf("[session] persist binding: %v", err)
				}
			}
		}
	}()
}

// StopGC 停止后台 GC（幂等）。
func (r *Router) StopGC() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stop != nil {
		close(r.stop)
		r.stop = nil
	}
}

// LoadFromStore 启动时从 redisstore 恢复绑定（内存覆盖本地，读操作仅此处发生）。
// 已有本地绑定被保留——Redis 仅为恢复备份，本地一旦建立即为权威。
func (r *Router) LoadFromStore() {
	binds := r.cfg.Store.LoadBinds()
	if len(binds) == 0 {
		return
	}
	now := time.Now()
	r.mu.Lock()
	loaded := 0
	for key, uid := range binds {
		if len(key) > 2048 || key == "" || len(uid) > 128 || uid == "" {
			continue
		}
		if _, exists := r.entries[key]; exists {
			continue
		}
		r.entries[key] = entry{
			uid:        uid,
			lastActive: now,
			turns:      1,
			isDerived:  isDerivedKey(key),
		}
		r.trimLocked()
		loaded++
	}
	r.mu.Unlock()
	if loaded > 0 {
		log.Printf("[session] 从 Redis 恢复 %d 条粘性会话绑定", loaded)
	}
}

func (r *Router) ttlFor(key string) time.Duration {
	if isDerivedKey(key) && r.cfg.DerivedTTL > 0 {
		return r.cfg.DerivedTTL
	}
	return r.cfg.TTL
}

func (r *Router) maxTurnsFor(key string) int {
	if isDerivedKey(key) {
		if r.cfg.MaxDerivedTurns > 0 {
			return r.cfg.MaxDerivedTurns
		}
		return 5
	}
	if r.cfg.MaxTurns > 0 {
		return r.cfg.MaxTurns
	}
	return 10
}

func (r *Router) isEntryValid(key string, e entry, now time.Time) bool {
	ttl := r.ttlFor(key)
	if now.Sub(e.lastActive) > ttl {
		return false
	}
	maxTurns := r.maxTurnsFor(key)
	if maxTurns > 0 && e.turns >= maxTurns {
		return false
	}
	return true
}

// Resolve 返回会话 key 应绑定的账号 uid，ok=false 表示当前无可用账号。
// 无模型维度（等价于 ResolveForModel(key, "")），保留给不关心模型的调用方。
func (r *Router) Resolve(key string) (string, bool) {
	return r.ResolveForModel(key, "")
}

// ResolveForModel 返回会话 key 在该模型上应绑定的账号 uid。
// 命中且账号在该模型可用且未达轮数/TTL上限 → 滚动 lastActive 并直接返回；
// 否则（绑定号已冷却/占满/被该模型限流/超轮数）走重新分配。
func (r *Router) ResolveForModel(key, model string) (string, bool) {
	if key == "" || len(key) > 2048 {
		return "", false
	}
	now := time.Now()
	available := r.availableSet(model)

	// ── Fast path: RLock 快查 ──────────────────────────────
	r.mu.RLock()
	e, found := r.entries[key]
	r.mu.RUnlock()
	if found && r.isEntryValid(key, e, now) {
		if available[e.uid] {
			r.touch(key, e.uid, now)
			return e.uid, true
		}
		// 绑定号已冷却/占满 → 失效，落入慢路径重分配。
	}

	// ── Slow path: 写锁 re-check 后分配 ────────────────────
	r.mu.Lock()
	defer r.mu.Unlock()

	// re-check：并发同 key 可能已被其他 goroutine 分配好。
	var prevUID string
	if e2, found2 := r.entries[key]; found2 {
		if r.isEntryValid(key, e2, now) && available[e2.uid] {
			e2.turns++
			e2.lastActive = now
			r.entries[key] = e2
			return e2.uid, true
		}
		prevUID = e2.uid
		delete(r.entries, key) // 失效/超限：清掉再分配
	}

	uids := r.availableSlice(model)
	if len(uids) == 0 {
		return "", false
	}

	// 双段策略：优先"空闲账号"（未被任何会话绑定的可用号），其次全池。
	bound := map[string]bool{}
	for _, v := range r.entries {
		bound[v.uid] = true
	}
	var idle []string
	for _, u := range uids {
		if !bound[u] {
			idle = append(idle, u)
		}
	}
	pool2 := idle
	if len(pool2) == 0 {
		pool2 = uids
	}

	// 优先走 Pool SWRR 平滑挑选，若未注入则安全回退哈希取模
	var uid string
	if r.cfg.PickBest != nil {
		uid = r.cfg.PickBest(model, pool2)
	}
	if uid == "" {
		uid = pool2[hashIndex(key, len(pool2))]
	}

	r.entries[key] = entry{
		uid:        uid,
		lastActive: now,
		turns:      1,
		isDerived:  isDerivedKey(key),
	}
	r.trimLocked()
	if prevUID != "" && prevUID != uid {
		r.cfg.Store.DelBind(key)
	}
	r.cfg.Store.SetBind(key, uid, r.ttlFor(key))
	return uid, true
}

// touch 滚动 lastActive 并累加轮数，异步镜像到 redisstore。
func (r *Router) touch(key, uid string, now time.Time) {
	r.mu.Lock()
	e, ok := r.entries[key]
	// Never resurrect a binding concurrently invalidated or changed by a failure.
	if !ok || e.uid != uid {
		r.mu.Unlock()
		return
	}
	e.turns++
	e.lastActive = now
	r.entries[key] = e
	r.mu.Unlock()
	r.cfg.Store.SetBind(key, uid, r.ttlFor(key))
}

// Bind 显式把会话 key 绑定到 uid（幂等覆盖旧值），并异步镜像到 redisstore。
// 供"粘性跟随最终成功号"用：请求成功返回前，把会话重绑到实际成功的账号，让多轮对话下一跳稳定
// 收敛到"对该会话持续成功的号"（对齐 antigravity 语义）。空 key 直接返回（无会话则不绑）。
func (r *Router) Bind(key, uid string) {
	if key == "" || len(key) > 2048 || uid == "" || len(uid) > 128 {
		return
	}
	now := time.Now()
	r.mu.Lock()
	prev, exists := r.entries[key]
	turns := 1
	if exists && prev.uid == uid {
		turns = prev.turns
	}
	r.entries[key] = entry{
		uid:        uid,
		lastActive: now,
		turns:      turns,
		isDerived:  isDerivedKey(key),
	}
	r.trimLocked()
	r.mu.Unlock()
	r.cfg.Store.SetBind(key, uid, r.ttlFor(key))
}

// DeleteAccount removes all sticky bindings for uid and synchronously persists
// the local snapshot. Redis mirrors are invalidated after the in-memory swap.
func (r *Router) DeleteAccount(uid string) error {
	if r == nil || uid == "" {
		return nil
	}
	r.mu.Lock()
	removed := make([]string, 0)
	for key, value := range r.entries {
		if value.uid == uid {
			delete(r.entries, key)
			removed = append(removed, key)
		}
	}
	r.mu.Unlock()
	for _, key := range removed {
		r.cfg.Store.DelBind(key)
	}
	return r.FlushLocal()
}

// Unbind 解除会话绑定（请求失败时调用，让该会话下次重新分配）。返回是否存在。
func (r *Router) Unbind(key string) bool {
	r.mu.Lock()
	_, found := r.entries[key]
	if found {
		delete(r.entries, key)
	}
	r.mu.Unlock()
	if found {
		r.cfg.Store.DelBind(key)
	}
	return found
}

// Count 返回当前绑定数（供 /status 观测）。
func (r *Router) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.entries)
}

// gcOnce 清理 TTL 过期或达到轮数上限的绑定，并镜像删除。
func (r *Router) gcOnce(now time.Time) int {
	r.mu.Lock()
	var expiredKeys []string
	for key, e := range r.entries {
		if !r.isEntryValid(key, e, now) {
			expiredKeys = append(expiredKeys, key)
		}
	}
	for _, key := range expiredKeys {
		delete(r.entries, key)
	}
	r.mu.Unlock()
	for _, key := range expiredKeys {
		r.cfg.Store.DelBind(key)
	}
	return len(expiredKeys)
}

// availableSet 把 AvailableForModel(model) 的有序列表转集合（快路径命中校验用）。
func (r *Router) availableSet(model string) map[string]bool {
	uids := r.availableSlice(model)
	set := make(map[string]bool, len(uids))
	for _, u := range uids {
		set[u] = true
	}
	return set
}

// availableSlice 安全调用 AvailableForModel；未注入时回落 Available（nil 视空池）。
func (r *Router) availableSlice(model string) []string {
	if r.cfg.AvailableForModel != nil {
		return r.cfg.AvailableForModel(model)
	}
	if r.cfg.Available == nil {
		return nil
	}
	return r.cfg.Available()
}

func expired(e entry, now time.Time, ttl time.Duration) bool {
	return now.Sub(e.lastActive) > ttl
}

// hashIndex FNV-1a 哈希取模（antigravity 双段分配的稳定散列）。
func hashIndex(key string, n int) int {
	var h uint32 = 2166136261
	for i := 0; i < len(key); i++ {
		h ^= uint32(key[i])
		h *= 16777619
	}
	return int(h % uint32(n))
}

// ExtractKey 从请求体提取会话键；按下列顺序依次尝试，找不到时回退到
// 内容派生的稳定键（见 deriveKey），仍为空则返回空串（绝不失败）。
//  1. metadata.conversation_id
//  2. metadata.conversationId
//  3. conversation_id
//  4. conversationId
//  5. prompt_cache_key（OpenAI 前缀缓存键，见下）
//  6. 派生键：system 提示词 + 首条用户消息的哈希（客户端不发会话 id 时的回退，
//     带 user_id 的请求不派生——见下方契约说明）
func ExtractKey(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		return ""
	}
	if meta, ok := obj["metadata"].(map[string]any); ok {
		if v := strOrEmpty(meta["conversation_id"]); v != "" {
			return v
		}
		if v := strOrEmpty(meta["conversationId"]); v != "" {
			return v
		}
	}
	if v := strOrEmpty(obj["conversation_id"]); v != "" {
		return v
	}
	if v := strOrEmpty(obj["conversationId"]); v != "" {
		return v
	}
	if v := strOrEmpty(obj["prompt_cache_key"]); v != "" {
		return v
	}
	if hasUserIDKey(obj) {
		return ""
	}
	return deriveKey(obj)
}

// hasUserIDKey 报告已解析 body 是否携带 user 维度标识（metadata.user_id 或顶层
// user_id，非空字符串才算）。只用于派生回退闸（ExtractKey）；解析失败按无处理。
func hasUserIDKey(obj map[string]any) bool {
	if meta, ok := obj["metadata"].(map[string]any); ok {
		if strOrEmpty(meta["user_id"]) != "" {
			return true
		}
	}
	return strOrEmpty(obj["user_id"]) != ""
}

// derivedKeyPrefix 派生键前缀，与显式会话 id 的命名空间隔离：
// 即便客户端恰好传了形如 "d-<hex>" 的显式 id 也不至于与派生键混淆（显式 id 优先返回）。
const derivedKeyPrefix = "d-"

func isDerivedKey(key string) bool {
	return strings.HasPrefix(key, derivedKeyPrefix)
}

// deriveKey 从消息内容派生稳定会话键：SHA-256(system 文本 + 首条 user 文本) 前 16 字节。
func deriveKey(obj map[string]any) string {
	msgs, ok := obj["messages"].([]any)
	if !ok || len(msgs) == 0 {
		return ""
	}
	systemText, firstUserText := "", ""
	for _, m := range msgs {
		msg, ok := m.(map[string]any)
		if !ok {
			continue
		}
		text := messageText(msg["content"])
		switch strOrEmpty(msg["role"]) {
		case "system", "developer":
			if systemText == "" {
				systemText = text
			}
		case "user":
			if firstUserText == "" {
				firstUserText = userContentSignature(msg["content"])
			}
		}
		if firstUserText != "" && systemText != "" {
			break
		}
	}
	if firstUserText == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(systemText + "\x00" + firstUserText))
	return derivedKeyPrefix + hex.EncodeToString(sum[:16])
}

func userContentSignature(content any) string {
	raw, err := json.Marshal(content)
	if err != nil {
		return ""
	}
	st := strings.TrimSpace(string(raw))
	if st == "" || st == "null" {
		return ""
	}
	if st[0] == '"' {
		var str string
		if json.Unmarshal(raw, &str) != nil {
			return ""
		}
		return str
	}
	if st[0] != '[' {
		return ""
	}
	var parts []json.RawMessage
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var b strings.Builder
	hasNonText := false
	for _, pr := range parts {
		var p struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(pr, &p) != nil {
			return ""
		}
		if p.Type == "" || p.Type == "text" {
			b.WriteString(p.Text)
			continue
		}
		hasNonText = true
		b.WriteString("\n[" + p.Type + "]\n")
	}
	out := b.String()
	if !hasNonText {
		return out
	}
	return strings.TrimSpace(out)
}

func messageText(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case []any:
		var sb strings.Builder
		for _, part := range v {
			if p, ok := part.(map[string]any); ok {
				sb.WriteString(strOrEmpty(p["text"]))
			}
		}
		return sb.String()
	}
	return ""
}

func strOrEmpty(v any) string {
	s, _ := v.(string)
	return s
}
