package upstream

import (
	"context"
	"crypto/sha256"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const proxyCacheLimit = 128
const proxyCacheTTL = 10 * time.Minute

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
	tr   *http.Transport
	used time.Time
}
type proxyFailure struct{}

func (proxyFailure) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	return nil, errors.New("account proxy configuration is invalid or unsupported by transport")
}

type safeProxyTransport struct{ tr *http.Transport }

func (s safeProxyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if s.tr == nil {
		return nil, errors.New("account proxy transport is not initialized")
	}
	resp, err := s.tr.RoundTrip(r)
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
	if s.tr != nil {
		s.tr.CloseIdleConnections()
	}
}
func ValidateProxyURL(raw string) error { return auth.ValidateProxyURL(raw) }
func (c *Client) ForgetTransport(uid string) {
	if c == nil {
		return
	}
	proxyTransports.Lock()
	defer proxyTransports.Unlock()
	for k, v := range proxyTransports.entries {
		if k.client == c && k.uid == uid {
			v.tr.CloseIdleConnections()
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
		// 账号未绑定出口时：执行默认直连通道 (Default Direct Transport)。
		// 保留 net/http 对 nil Transport 的默认语义，避免启用租约后
		// 因重新选择 transport 而把未绑定账号误判为未初始化。
		c.ForgetTransport(uid)
		if base.Transport != nil {
			return base.Transport
		}
		return http.DefaultTransport
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
	key := proxyTransportKey{c, tr, uid}
	hash := sha256.Sum256([]byte(raw))
	now := time.Now()
	proxyTransports.Lock()
	defer proxyTransports.Unlock()
	for k, v := range proxyTransports.entries {
		if now.Sub(v.used) > proxyCacheTTL {
			v.tr.CloseIdleConnections()
			delete(proxyTransports.entries, k)
		}
	}
	if v, ok := proxyTransports.entries[key]; ok {
		if v.hash == hash {
			v.used = now
			proxyTransports.entries[key] = v
			return safeProxyTransport{v.tr}
		}
		v.tr.CloseIdleConnections()
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
		proxyTransports.entries[oldest].tr.CloseIdleConnections()
		delete(proxyTransports.entries, oldest)
	}
	u, _ := url.Parse(raw)
	clone := tr.Clone()
	clone.Proxy = http.ProxyURL(u)
	clone.MaxIdleConns = 8
	clone.MaxIdleConnsPerHost = 4
	clone.MaxConnsPerHost = 8
	// Custom TLS dial hooks can bypass net/http's proxy machinery. Reject rather than leak direct.
	if clone.DialTLS != nil || clone.DialTLSContext != nil {
		return proxyFailure{}
	}
	proxyTransports.entries[key] = proxyTransportEntry{hash, clone, now}
	return safeProxyTransport{clone}
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
	if t.c == nil || t.c.AccountLease == nil {
		if t.next == nil {
			return nil, errors.New("underlying transport is not initialized")
		}
		return t.next.RoundTrip(r)
	}
	release, e := t.c.AccountLease(r.Context(), t.a)
	if e != nil {
		return nil, errors.New("managed account proxy unavailable")
	}
	if release == nil {
		release = func() {}
	}
	next := t.next
	// Choose the transport only after acquiring the account lease. A Meta bind
	// can complete between client construction and RoundTrip; re-reading the
	// account proxy here prevents that request from escaping via stale direct
	// transport or another account's route.
	if t.base != nil && t.c != nil {
		next = t.c.accountTransport(t.base, t.a)
	}
	if next == nil {
		release()
		return nil, errors.New("underlying transport is not initialized")
	}
	resp, e := next.RoundTrip(r)
	if e != nil {
		release()
		return nil, e
	}
	if resp.Body == nil {
		release()
	} else {
		resp.Body = &leasedBody{ReadCloser: resp.Body, release: release}
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
	if c == nil || c.AccountLease == nil {
		return next
	}
	return accountLeaseTransport{base: base, next: next, c: c, a: a}
}
