package upstream

import (
	"context"
	"crypto/sha256"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/logfmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const proxyCacheLimit = 32

// proxyCacheTTL 账号代理传输层空闲保活时长（2 分钟）：
// 闲置 2 分钟后自动执行 CloseIdleConnections 并剔除，主动释放操作系统 socket 与网络缓冲区物理内存。
const proxyCacheTTL = 2 * time.Minute

// One process-wide bounded cache avoids requiring changes to Client's public shape.
// Keys isolate clients, account UIDs and distinct JSON/SSE base transports.
var proxyTransports = struct {
	sync.Mutex
	entries map[proxyTransportKey]proxyTransportEntry
}{entries: make(map[proxyTransportKey]proxyTransportEntry)}

type proxyTransportKey struct {
	client *Client
	base   *http.Transport
	uid    string
}
type proxyTransportEntry struct {
	hash [32]byte
	rt   http.RoundTripper
	used time.Time
}
type proxyFailure struct {
	reason string
}

func (p proxyFailure) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	if p.reason != "" {
		return nil, errors.New(p.reason)
	}
	return nil, errors.New("egress proxy is not configured: direct VPS connection to upstream is strictly prohibited")
}

type failClosedDirectTransport struct {
	base http.RoundTripper
	uid  string
}

func (f failClosedDirectTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL == nil {
		return nil, errors.New("nil request url")
	}
	host := r.URL.Hostname()
	// 允许单测本地 loopback 与 RFC 2606 虚拟测试保留域名（.example, .invalid, .test），
	// 但对于任何真实上游（copilot.tencent.com, workbuddy.ai 及公网真实 IP/域名），
	// 绝对严禁发生未经代理的 VPS 直连！严格保持 Fail-Closed 熔断阻断！
	if host == "127.0.0.1" || host == "localhost" || host == "::1" ||
		strings.HasSuffix(host, ".example") ||
		strings.HasSuffix(host, ".invalid") ||
		strings.HasSuffix(host, ".test") {
		if f.base != nil {
			return f.base.RoundTrip(r)
		}
		return http.DefaultTransport.RoundTrip(r)
	}
	log.Printf("WARN: [upstream] egress fail-closed: account=%s host=%s blocked (no proxy configured)", logfmt.UID8(f.uid), host)
	return nil, errors.New("no egress proxy configured: direct VPS connection to external upstream is strictly prohibited")
}

func (f failClosedDirectTransport) CloseIdleConnections() {
	if ci, ok := f.base.(closeIdler); ok {
		ci.CloseIdleConnections()
	}
}

type safeProxyTransport struct {
	tr *http.Transport
	rt http.RoundTripper
}

func (s safeProxyTransport) target() http.RoundTripper {
	if s.rt != nil {
		return s.rt
	}
	if s.tr != nil {
		return s.tr
	}
	return nil
}

func (s safeProxyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	rt := s.target()
	if rt == nil {
		return nil, errors.New("account proxy transport is not initialized")
	}
	resp, err := rt.RoundTrip(r)
	if err != nil {
		if e := r.Context().Err(); e != nil {
			return nil, e
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, context.DeadlineExceeded
		}
		return nil, errors.New("account proxy connection failed")
	}
	return resp, nil
}

// CloseIdleConnections 确保账号级代理 Transport 的空闲连接在传输失败时能被主动回收
func (s safeProxyTransport) CloseIdleConnections() {
	roundTripCloseIdle(s.target())
}
func ValidateProxyURL(raw string) error { return auth.ValidateProxyURL(raw) }

// TLSProfileValue 返回客户端当前生效的 TLS 拟态档位（chrome_auto / go_h1）。
func (c *Client) TLSProfileValue() string {
	if c == nil {
		return TLSProfileChromeAuto
	}
	return c.effectiveTLSProfile()
}

// NewProxyRoundTripper 构造独立代理传输层（供 panel OAuth 登录等外部调用方复用）：
// tlsProfile != "go_h1" 时默认采用 uTLS HelloChrome_Auto + HTTP/2 代理传输层，
// 否则回落标准 Go http.Transport。
func NewProxyRoundTripper(proxyURL, tlsProfile string) (http.RoundTripper, error) {
	raw := strings.TrimSpace(proxyURL)
	if err := auth.ValidateProxyURL(raw); err != nil {
		return nil, err
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	profile := strings.ToLower(strings.TrimSpace(tlsProfile))
	if profile == TLSProfileGoH1 {
		tr := newTransport()
		tr.Proxy = http.ProxyURL(u)
		tr.MaxIdleConns = 4
		tr.MaxIdleConnsPerHost = 2
		tr.MaxConnsPerHost = 4
		tr.IdleConnTimeout = idleConnTimeout
		return tr, nil
	}
	return newUTLSProxyTransport(newTransport(), u)
}
func (c *Client) ForgetTransport(uid string) {
	if c == nil {
		return
	}
	proxyTransports.Lock()
	defer proxyTransports.Unlock()
	for k, v := range proxyTransports.entries {
		if k.client == c && k.uid == uid {
			roundTripCloseIdle(v.rt)
			delete(proxyTransports.entries, k)
		}
	}
}
func (c *Client) transportFor(a *auth.Auth) http.RoundTripper {
	if c == nil {
		return proxyFailure{}
	}
	return c.accountTransport(c.HTTP, a)
}
func (c *Client) accountTransport(base *http.Client, a *auth.Auth) http.RoundTripper {
	if base == nil || c == nil {
		return proxyFailure{}
	}
	raw := ""
	uid := ""
	if a != nil {
		raw = strings.TrimSpace(a.ProxyURLValue())
		uid = a.UID
	}
	if raw == "" {
		def := c.DefaultProxy()
		if def != "" {
			raw = def
		} else {
			c.ForgetTransport(uid)
			// 若 base.Transport 是非网络测试 Mock（如单测中的自定义 RoundTripper），则直接放行供单测断言；
			// 若是真实的生产网络 Transport（*http.Transport）或 DefaultTransport，则绝对禁止向公网外部上游直连，
			// 挂载 failClosedDirectTransport 实施严格的熔断防御拦截！
			if _, isNetTr := base.Transport.(*http.Transport); !isNetTr && base.Transport != nil {
				return base.Transport
			}
			var baseTr http.RoundTripper = http.DefaultTransport
			if base.Transport != nil {
				baseTr = base.Transport
			}
			return failClosedDirectTransport{base: baseTr, uid: uid}
		}
	}
	if auth.ValidateProxyURL(raw) != nil {
		// 显式配置了出口但格式非法时：拒绝静默直连外泄，严格保持 Fail-Closed
		return proxyFailure{}
	}
	tr, ok := base.Transport.(*http.Transport)
	if !ok {
		if base.Transport == nil {
			tr = http.DefaultTransport.(*http.Transport)
		} else {
			return proxyFailure{}
		}
	}
	// Custom TLS dial hooks can bypass proxy machinery. Reject on base tr before building any proxy transport.
	if tr.DialTLS != nil || tr.DialTLSContext != nil {
		return proxyFailure{}
	}
	profile := c.effectiveTLSProfile()
	key := proxyTransportKey{c, tr, uid}
	hash := sha256.Sum256([]byte(profile + "\x00" + raw))
	now := time.Now()
	proxyTransports.Lock()
	defer proxyTransports.Unlock()
	for k, v := range proxyTransports.entries {
		if now.Sub(v.used) > proxyCacheTTL {
			roundTripCloseIdle(v.rt)
			delete(proxyTransports.entries, k)
		}
	}
	if v, ok := proxyTransports.entries[key]; ok {
		if v.hash == hash {
			v.used = now
			proxyTransports.entries[key] = v
			return safeProxyTransport{rt: v.rt}
		}
		roundTripCloseIdle(v.rt)
		delete(proxyTransports.entries, key)
	}
	if len(proxyTransports.entries) >= proxyCacheLimit {
		var oldest proxyTransportKey
		var at time.Time
		for k, v := range proxyTransports.entries {
			if at.IsZero() || v.used.Before(at) {
				oldest = k
				at = v.used
			}
		}
		roundTripCloseIdle(proxyTransports.entries[oldest].rt)
		delete(proxyTransports.entries, oldest)
	}
	u, _ := url.Parse(raw)
	var rt http.RoundTripper
	if profile == TLSProfileGoH1 {
		clone := tr.Clone()
		clone.Proxy = http.ProxyURL(u)
		// 温和收拢空闲连接池：避免单机私有部署闲置时持有过多死连接与缓冲
		clone.MaxIdleConns = 4
		clone.MaxIdleConnsPerHost = 2
		clone.MaxConnsPerHost = 4
		clone.IdleConnTimeout = idleConnTimeout
		rt = clone
	} else {
		ut, err := newUTLSProxyTransport(tr, u)
		if err != nil {
			return proxyFailure{}
		}
		rt = ut
	}
	proxyTransports.entries[key] = proxyTransportEntry{hash, rt, now}
	return safeProxyTransport{rt: rt}
}
func (c *Client) jsonDo(req *http.Request, a *auth.Auth) (*http.Response, error) {
	if c == nil || c.HTTP == nil {
		return nil, errors.New("upstream client not initialized")
	}
	cp := *c.HTTP
	baseTransport := c.accountTransport(c.HTTP, a)
	cp.Transport = c.withAccountLease(c.HTTP, baseTransport, a)
	return cp.Do(req)
}

// DoAccount is shared by manual egress probes and non-streaming upstream requests.
func (c *Client) DoAccount(req *http.Request, a *auth.Auth) (*http.Response, error) {
	return c.jsonDo(req, a)
}
func (c *Client) chatClientFor(a *auth.Auth) *http.Client {
	if c == nil {
		return &http.Client{Transport: proxyFailure{}}
	}
	base := c.ChatHTTP
	if base == nil {
		base = c.HTTP
	}
	if base == nil {
		return &http.Client{Transport: proxyFailure{}}
	}
	cp := *base
	baseTransport := c.accountTransport(base, a)
	cp.Transport = c.withAccountLease(base, baseTransport, a)
	return &cp
}

type leasedBody struct {
	io.ReadCloser
	once    sync.Once
	release func()
}

func (b *leasedBody) Close() error { e := b.ReadCloser.Close(); b.once.Do(b.release); return e }

type accountLeaseTransport struct {
	base *http.Client
	next http.RoundTripper
	c    *Client
	a    *auth.Auth
}

func (t accountLeaseTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if t.c == nil || (t.c.AccountLease == nil && t.c.EgressGuard == nil) {
		if t.next == nil {
			return nil, errors.New("underlying transport is not initialized")
		}
		return t.next.RoundTrip(r)
	}

	leaseRelease := func() {}
	if t.c.AccountLease != nil {
		release, e := t.c.AccountLease(r.Context(), t.a)
		if e != nil {
			uid := ""
			if t.a != nil {
				uid = logfmt.UID8(t.a.UID)
			}
			log.Printf("WARN: [upstream] account lease acquire failed: account=%s err=%v", uid, e)
			return nil, errors.New("managed account proxy unavailable")
		}
		if release != nil {
			leaseRelease = release
		}
	}

	next := t.next
	// Choose the transport only after acquiring the account lease. A Meta bind
	// can complete between client construction and RoundTrip; re-reading the
	// account proxy here prevents that request from escaping via stale direct
	// transport or another account's route.
	if t.c.AccountLease != nil && t.base != nil {
		next = t.c.accountTransport(t.base, t.a)
	}
	if next == nil {
		leaseRelease()
		return nil, errors.New("underlying transport is not initialized")
	}

	egressRelease := func() {}
	if t.c.EgressGuard != nil {
		if key := t.c.egressKeyFor(t.a); key != "" {
			uid := ""
			if t.a != nil {
				uid = t.a.UID
			}
			rel, e := t.c.EgressGuard.Acquire(r.Context(), key, uid)
			if e != nil {
				leaseRelease()
				log.Printf("WARN: [upstream] egress guard blocked: account=%s key=%s err=%v", logfmt.UID8(uid), key, e)
				return nil, e
			}
			if rel != nil {
				egressRelease = rel
			}
		}
	}

	releaseAll := func() {
		egressRelease()
		leaseRelease()
	}

	if t.c.AccountLease != nil && t.a != nil && r.URL != nil {
		proxyURL := strings.TrimSpace(t.a.ProxyURLValue())
		if proxyURL == "" {
			proxyURL = t.c.DefaultProxy()
		}
		if proxyURL != "" {
			log.Printf("[upstream] leased egress: account=%s egress=%s target=%s", logfmt.UID8(t.a.UID), proxyURL, r.URL.Host)
		}
	}

	resp, e := next.RoundTrip(r)
	if e != nil {
		releaseAll()
		return nil, e
	}
	if resp.Body == nil {
		releaseAll()
	} else {
		resp.Body = &leasedBody{ReadCloser: resp.Body, release: releaseAll}
	}
	return resp, nil
}

// CloseIdleConnections 将关闭空闲连接信号透传至底层 Transport
func (t accountLeaseTransport) CloseIdleConnections() {
	if ci, ok := t.next.(closeIdler); ok {
		ci.CloseIdleConnections()
	}
}

func (c *Client) withAccountLease(base *http.Client, next http.RoundTripper, a *auth.Auth) http.RoundTripper {
	if c == nil || (c.AccountLease == nil && c.EgressGuard == nil) {
		return next
	}
	return accountLeaseTransport{base: base, next: next, c: c, a: a}
}
