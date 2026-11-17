package upstream

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

const (
	defaultEgressAcquireTimeout = 15 * time.Second
	defaultEgressMinSwitchGap   = 500 * time.Millisecond
)

// ErrEgressGuardTimeout 表示在 AcquireTimeout 内未能等到同出口被其他账号释放。
// 门禁严格执行 fail-closed：超时绝不放行请求，防止跨账号同出口 IP 并发触发上游风控。
var ErrEgressGuardTimeout = errors.New("egress guard acquire timeout: shared egress busy with another account")

// EgressGuardOptions 配置跨账号同出口并发门禁。
type EgressGuardOptions struct {
	// AcquireTimeout 等待同一出口被其他账号释放的最长时间；<=0 时回落默认 15s。
	AcquireTimeout time.Duration
	// MinSwitchGap 跨账号切换同一出口时的最小静默错峰间隔；
	// 0 使用默认 500ms；<0 表示不额外等待。
	MinSwitchGap time.Duration
	// Now 可选时钟注入（测试用）；nil 时使用 time.Now。
	Now func() time.Time
}

// DefaultEgressGuardOptions 返回生产默认配置。
func DefaultEgressGuardOptions() EgressGuardOptions {
	return EgressGuardOptions{
		AcquireTimeout: defaultEgressAcquireTimeout,
		MinSwitchGap:   defaultEgressMinSwitchGap,
	}
}

type egressWaiter struct {
	uid    string
	signal chan struct{}
}

type egressSlot struct {
	ownerUID    string
	activeCount int
	lastUID     string
	lastRelease time.Time
	waiters     []*egressWaiter
}

// EgressGuard 跨账号同出口 fail-closed 并发门禁：
//   - 同出口键 + 同账号：允许并发进入（activeCount++），完整保留单账号 max_in_flight 并发水位；
//   - 同出口键 + 不同账号：严格互斥串行，待前序账号全部在途请求释放（activeCount==0）
//     并经过 MinSwitchGap 错峰静默间隔后，按 FIFO 公平顺序轮到下一个账号进入；
//   - 不同出口键：完全并发互不干扰；
//   - 等待超时或 ctx 取消：严格 fail-closed 返回错误，绝不放行。
type EgressGuard struct {
	mu             sync.Mutex
	slots          map[string]*egressSlot
	acquireTimeout time.Duration
	minSwitchGap   time.Duration
	nowFn          func() time.Time
}

// NewEgressGuard 构造跨账号同出口并发门禁。
func NewEgressGuard(opts EgressGuardOptions) *EgressGuard {
	timeout := opts.AcquireTimeout
	if timeout <= 0 {
		timeout = defaultEgressAcquireTimeout
	}
	gap := opts.MinSwitchGap
	if gap == 0 {
		gap = defaultEgressMinSwitchGap
	} else if gap < 0 {
		gap = 0
	}
	nowFn := opts.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	return &EgressGuard{
		slots:          make(map[string]*egressSlot),
		acquireTimeout: timeout,
		minSwitchGap:   gap,
		nowFn:          nowFn,
	}
}

func (g *EgressGuard) now() time.Time {
	if g != nil && g.nowFn != nil {
		return g.nowFn()
	}
	return time.Now()
}

// Acquire 为 (key, uid) 获取出口使用权，返回幂等的 release 释放函数。
//   - key 为空：不施加跨账号出口互斥，直接返回空 release（仍尊重已取消的 ctx）。
//   - 等待期间支持 ctx.Done() 与 AcquireTimeout 提前中止，严格 fail-closed。
func (g *EgressGuard) Acquire(ctx context.Context, key, uid string) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if g == nil || strings.TrimSpace(key) == "" {
		return func() {}, nil
	}
	if uid == "" {
		uid = "__anonymous__"
	}

	makeRelease := func() func() {
		var once sync.Once
		return func() {
			once.Do(func() {
				g.release(key, uid)
			})
		}
	}

	// 快速路径：检查是否可直接获取。
	g.mu.Lock()
	now := g.now()
	g.cleanupExpiredLocked(now)
	slot := g.slots[key]
	if slot == nil {
		slot = &egressSlot{
			ownerUID:    uid,
			activeCount: 1,
		}
		g.slots[key] = slot
		g.mu.Unlock()
		return makeRelease(), nil
	}
	// 同账号在途重入：直接递增 activeCount，保留单账号 max_in_flight 并发能力。
	if slot.activeCount > 0 && slot.ownerUID == uid {
		slot.activeCount++
		g.mu.Unlock()
		return makeRelease(), nil
	}
	// 槽位空闲且无排队者，检查是否满足跨账号切换最小间隔。
	if slot.activeCount == 0 && len(slot.waiters) == 0 {
		if slot.lastUID == "" || slot.lastUID == uid || g.minSwitchGap <= 0 || now.Sub(slot.lastRelease) >= g.minSwitchGap {
			slot.ownerUID = uid
			slot.activeCount = 1
			g.mu.Unlock()
			return makeRelease(), nil
		}
	}

	// 慢路径：加入 FIFO 等待队列。
	w := &egressWaiter{
		uid:    uid,
		signal: make(chan struct{}, 1),
	}
	slot.waiters = append(slot.waiters, w)
	// 若自己成为队头且当前槽位已空闲（例如仅需等待 MinSwitchGap），立即可进入循环检查。
	notifyHeadLocked(slot)
	g.mu.Unlock()

	deadline := time.NewTimer(g.acquireTimeout)
	defer deadline.Stop()

	for {
		g.mu.Lock()
		if err := ctx.Err(); err != nil {
			g.removeWaiterLocked(key, slot, w)
			g.mu.Unlock()
			return nil, err
		}

		isHead := len(slot.waiters) > 0 && slot.waiters[0] == w
		if isHead {
			if slot.activeCount > 0 && slot.ownerUID == uid {
				// 队头且与当前持有者同账号（例如同账号连续两个等待者被依次唤醒）。
				slot.waiters = slot.waiters[1:]
				slot.activeCount++
				notifyHeadLocked(slot)
				g.mu.Unlock()
				return makeRelease(), nil
			}
			if slot.activeCount == 0 {
				var gapRemain time.Duration
				if g.minSwitchGap > 0 && slot.lastUID != "" && slot.lastUID != uid {
					elapsed := g.now().Sub(slot.lastRelease)
					if elapsed < g.minSwitchGap {
						gapRemain = g.minSwitchGap - elapsed
					}
				}
				if gapRemain <= 0 {
					slot.waiters = slot.waiters[1:]
					slot.ownerUID = uid
					slot.activeCount = 1
					notifyHeadLocked(slot)
					g.mu.Unlock()
					return makeRelease(), nil
				}
				// 仅差跨账号切换静默间隔：保持队头位置，等待 gapRemain（支持 ctx 与总超时打断）。
				g.mu.Unlock()
				gapTimer := time.NewTimer(gapRemain)
				select {
				case <-gapTimer.C:
					// 回到循环顶部重新校验墙钟与状态，避免 timer 提前微秒级唤醒。
					continue
				case <-ctx.Done():
					gapTimer.Stop()
					g.mu.Lock()
					g.removeWaiterLocked(key, slot, w)
					g.mu.Unlock()
					return nil, ctx.Err()
				case <-deadline.C:
					gapTimer.Stop()
					g.mu.Lock()
					g.removeWaiterLocked(key, slot, w)
					g.mu.Unlock()
					return nil, ErrEgressGuardTimeout
				}
			}
		}
		g.mu.Unlock()

		// 非队头或槽位仍被其他账号占用：等待唤醒信号、ctx 取消或总超时。
		select {
		case <-w.signal:
		case <-ctx.Done():
			g.mu.Lock()
			g.removeWaiterLocked(key, slot, w)
			g.mu.Unlock()
			return nil, ctx.Err()
		case <-deadline.C:
			g.mu.Lock()
			g.removeWaiterLocked(key, slot, w)
			g.mu.Unlock()
			return nil, ErrEgressGuardTimeout
		}
	}
}

func (g *EgressGuard) release(key, uid string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	slot, ok := g.slots[key]
	if !ok || slot.activeCount <= 0 {
		return
	}
	slot.activeCount--
	if slot.activeCount == 0 {
		slot.lastUID = slot.ownerUID
		slot.ownerUID = ""
		slot.lastRelease = g.now()
		if len(slot.waiters) > 0 {
			notifyHeadLocked(slot)
		} else if g.minSwitchGap <= 0 {
			delete(g.slots, key)
		}
	}
	g.cleanupExpiredLocked(g.now())
}

func (g *EgressGuard) removeWaiterLocked(key string, slot *egressSlot, target *egressWaiter) {
	for i, w := range slot.waiters {
		if w == target {
			copy(slot.waiters[i:], slot.waiters[i+1:])
			slot.waiters[len(slot.waiters)-1] = nil
			slot.waiters = slot.waiters[:len(slot.waiters)-1]
			break
		}
	}
	if len(slot.waiters) > 0 {
		notifyHeadLocked(slot)
	} else if slot.activeCount == 0 && (g.minSwitchGap <= 0 || g.now().Sub(slot.lastRelease) >= g.minSwitchGap) {
		if cur, ok := g.slots[key]; ok && cur == slot {
			delete(g.slots, key)
		}
	}
}

func (g *EgressGuard) cleanupExpiredLocked(now time.Time) {
	if len(g.slots) == 0 {
		return
	}
	for k, slot := range g.slots {
		if slot.activeCount == 0 && len(slot.waiters) == 0 {
			if g.minSwitchGap <= 0 || now.Sub(slot.lastRelease) >= g.minSwitchGap {
				delete(g.slots, k)
			}
		}
	}
}

func notifyHeadLocked(slot *egressSlot) {
	if len(slot.waiters) == 0 {
		return
	}
	head := slot.waiters[0]
	if slot.activeCount == 0 || slot.ownerUID == head.uid {
		select {
		case head.signal <- struct{}{}:
		default:
		}
	}
}

// normalizeExitIPKey 将出口 IP 归一化为 "ip:<canonical>"；空串返回 ""。
func normalizeExitIPKey(raw string) string {
	ipStr := strings.TrimSpace(raw)
	if ipStr == "" {
		return ""
	}
	if ip := net.ParseIP(ipStr); ip != nil {
		return "ip:" + ip.String()
	}
	return "ip:" + strings.ToLower(ipStr)
}

// normalizeProxyKey 将代理 URL 归一化为 "proxy:<scheme>://<host>:<port><path>"：
//   - 统一小写 scheme/host、补齐常见协议默认端口、去除尾斜杠；
//   - 剥离 userinfo 凭据（既保证安全不外泄密码，又在未知 exit_ip 时对同网关地址保守互斥）；
//   - 非法 URL 回落为摘要键，绝不泄露原始凭据串。
func normalizeProxyKey(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		sum := sha256.Sum256([]byte(s))
		return "proxy:raw:" + hex.EncodeToString(sum[:8])
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" {
		switch scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		case "socks5", "socks5h":
			port = "1080"
		}
	}
	hostPort := host
	if port != "" {
		hostPort = net.JoinHostPort(host, port)
	}
	path := strings.TrimRight(u.Path, "/")
	return "proxy:" + scheme + "://" + hostPort + path
}

// egressKeyFor 计算账号的出口并发门禁键：
// 优先级：已探测缓存 exit_ip（ExitIPResolver） > 账号 ProxyURL > Client.DefaultProxy()。
// 均为空时返回 ""（单测直连本地场景不施加跨号互斥；公网无代理已由 failClosedDirectTransport 阻断）。
func (c *Client) egressKeyFor(a *auth.Auth) string {
	if c == nil {
		return ""
	}
	if c.ExitIPResolver != nil && a != nil {
		if k := normalizeExitIPKey(c.ExitIPResolver(a)); k != "" {
			return k
		}
	}
	raw := ""
	if a != nil {
		raw = strings.TrimSpace(a.ProxyURLValue())
	}
	if raw == "" {
		raw = strings.TrimSpace(c.DefaultProxy())
	}
	return normalizeProxyKey(raw)
}
