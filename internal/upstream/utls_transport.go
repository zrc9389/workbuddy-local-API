package upstream

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/http2"
	xproxy "golang.org/x/net/proxy"
)

// bufferedConn 包装代理 CONNECT 握手后 bufio.Reader 中残留的预读字节，确保不丢弃任何 TLS 首包数据。
type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	return c.r.Read(p)
}

// utlsConnAdapter 将 *utls.UConn 适配为提供标准库 ConnectionState() tls.ConnectionState 的 net.Conn，
// 供 golang.org/x/net/http2 读取 NegotiatedProtocol 与填充 http.Response.TLS。
type utlsConnAdapter struct {
	*utls.UConn
}

func (c *utlsConnAdapter) ConnectionState() tls.ConnectionState {
	st := c.UConn.ConnectionState()
	return tls.ConnectionState{
		Version:                     st.Version,
		HandshakeComplete:           st.HandshakeComplete,
		DidResume:                   st.DidResume,
		CipherSuite:                 st.CipherSuite,
		NegotiatedProtocol:          st.NegotiatedProtocol,
		NegotiatedProtocolIsMutual:  st.NegotiatedProtocolIsMutual,
		ServerName:                  st.ServerName,
		PeerCertificates:            st.PeerCertificates,
		VerifiedChains:              st.VerifiedChains,
		SignedCertificateTimestamps: st.SignedCertificateTimestamps,
		OCSPResponse:                st.OCSPResponse,
		TLSUnique:                   st.TLSUnique,
		ECHAccepted:                 st.ECHAccepted,
	}
}

// cancelOnCloseBody 在响应 Body 关闭时释放派生上下文，避免在 SSE 流读取期间提前取消上下文。
type cancelOnCloseBody struct {
	io.ReadCloser
	once   sync.Once
	cancel context.CancelFunc
}

func (b *cancelOnCloseBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.cancel)
	return err
}

// contextDialerFunc 将 DialContext 适配为 golang.org/x/net/proxy.Dialer 与 proxy.ContextDialer。
type contextDialerFunc func(ctx context.Context, network, addr string) (net.Conn, error)

func (f contextDialerFunc) Dial(network, addr string) (net.Conn, error) {
	return f(context.Background(), network, addr)
}

func (f contextDialerFunc) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return f(ctx, network, addr)
}

type handoffEntry struct {
	conn  net.Conn
	proto string
	used  bool
}

type alpnSwitchError struct {
	proto string
	entry *handoffEntry
}

func (e *alpnSwitchError) Error() string {
	return "alpn negotiated protocol switched to " + e.proto
}

// shieldedReqBody 在首次 RoundTrip 可能触发 alpnSwitchError 重试期间暂缓关闭底层 req.Body，
// 防止 http.Transport / http2.Transport 在拨号返回 alpnSwitchError 后的错误清理路径提前 Close()
// 无 GetBody 的流式请求体；确认无需 ALPN 切换后立即解除屏蔽并忠实转发 Close()。
type shieldedReqBody struct {
	mu             sync.Mutex
	rc             io.ReadCloser
	shielded       bool
	closeRequested bool
	closed         bool
}

func newShieldedReqBody(rc io.ReadCloser) *shieldedReqBody {
	return &shieldedReqBody{rc: rc, shielded: true}
}

func (b *shieldedReqBody) Read(p []byte) (int, error) {
	return b.rc.Read(p)
}

func (b *shieldedReqBody) Close() error {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return nil
	}
	if b.shielded {
		b.closeRequested = true
		b.mu.Unlock()
		return nil
	}
	b.closed = true
	rc := b.rc
	b.mu.Unlock()
	return rc.Close()
}

func (b *shieldedReqBody) unshield(forceClose bool) {
	b.mu.Lock()
	b.shielded = false
	shouldClose := !b.closed && (b.closeRequested || forceClose)
	if shouldClose {
		b.closed = true
	}
	rc := b.rc
	b.mu.Unlock()
	if shouldClose {
		_ = rc.Close()
	}
}

// utlsProxyTransport 为单个账号独占的 uTLS + HTTP/2 拟态代理传输层：
//   - 明文 http:// 请求走每账号独立克隆的 h1PlainTr（经代理，保持兼容）；
//   - 加密 https:// 请求严格先穿透账号代理隧道（HTTP/HTTPS CONNECT 或 SOCKS5 远端解析），
//     再执行 utls.HelloChrome_Auto 握手，按 ALPN 协商结果零双重握手分发到独占的 h2Tr 或 h1TLSTr。
type utlsProxyTransport struct {
	proxyURL              *url.URL
	dialCtx               func(ctx context.Context, network, addr string) (net.Conn, error)
	baseTLSConfig         *tls.Config
	tlsHandshakeTimeout   time.Duration
	responseHeaderTimeout time.Duration

	h1PlainTr *http.Transport
	h2Tr      *http2.Transport
	h1TLSTr   *http.Transport

	mu         sync.Mutex
	protoCache map[string]string
	handoff    map[string][]*handoffEntry
}

func newUTLSProxyTransport(base *http.Transport, proxyURL *url.URL) (*utlsProxyTransport, error) {
	if proxyURL == nil {
		return nil, errors.New("proxy URL is nil")
	}
	scheme := strings.ToLower(strings.TrimSpace(proxyURL.Scheme))
	switch scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", proxyURL.Scheme)
	}
	if strings.TrimSpace(proxyURL.Hostname()) == "" {
		return nil, errors.New("proxy host is empty")
	}

	proxyCopy := *proxyURL
	if proxyURL.User != nil {
		uinfo := *proxyURL.User
		proxyCopy.User = &uinfo
	}

	dialCtx := newDialer().DialContext
	if base != nil && base.DialContext != nil {
		dialCtx = base.DialContext
	}

	var baseTLS *tls.Config
	if base != nil && base.TLSClientConfig != nil {
		baseTLS = base.TLSClientConfig.Clone()
	}

	hsTimeout := tlsHandshakeTimeout
	if base != nil && base.TLSHandshakeTimeout > 0 {
		hsTimeout = base.TLSHandshakeTimeout
	}

	var hdrTimeout time.Duration
	if base != nil && base.ResponseHeaderTimeout > 0 {
		hdrTimeout = base.ResponseHeaderTimeout
	}

	var h1PlainTr *http.Transport
	if base != nil {
		h1PlainTr = base.Clone()
	} else {
		h1PlainTr = newTransport()
	}
	h1PlainTr.Proxy = http.ProxyURL(&proxyCopy)
	h1PlainTr.MaxIdleConns = 4
	h1PlainTr.MaxIdleConnsPerHost = 2
	h1PlainTr.MaxConnsPerHost = 4
	h1PlainTr.IdleConnTimeout = idleConnTimeout
	h1PlainTr.DisableCompression = true

	u := &utlsProxyTransport{
		proxyURL:              &proxyCopy,
		dialCtx:               dialCtx,
		baseTLSConfig:         baseTLS,
		tlsHandshakeTimeout:   hsTimeout,
		responseHeaderTimeout: hdrTimeout,
		h1PlainTr:             h1PlainTr,
		protoCache:            make(map[string]string),
		handoff:               make(map[string][]*handoffEntry),
	}

	u.h2Tr = &http2.Transport{
		DialTLSContext:     u.dialH2TLSContext,
		DisableCompression: true,
		AllowHTTP:          false,
		ReadIdleTimeout:    h2ReadIdleTimeout,
		PingTimeout:        h2PingTimeout,
		IdleConnTimeout:    idleConnTimeout,
	}

	u.h1TLSTr = &http.Transport{
		Proxy: nil,
		DialContext: func(context.Context, string, string) (net.Conn, error) {
			return nil, errors.New("direct dial prohibited on uTLS HTTPS transport")
		},
		DialTLSContext:        u.dialH1TLSContext,
		TLSNextProto:          make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
		TLSHandshakeTimeout:   hsTimeout,
		MaxIdleConns:          4,
		MaxIdleConnsPerHost:   2,
		MaxConnsPerHost:       4,
		IdleConnTimeout:       idleConnTimeout,
		ResponseHeaderTimeout: hdrTimeout,
		DisableCompression:    true,
	}

	return u, nil
}

func (u *utlsProxyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil || req.URL == nil {
		return nil, errors.New("nil request or url")
	}
	switch strings.ToLower(req.URL.Scheme) {
	case "http":
		return u.h1PlainTr.RoundTrip(req)
	case "https":
		// 经代理 + uTLS 拟态发送
	default:
		return nil, fmt.Errorf("unsupported request scheme %q", req.URL.Scheme)
	}

	authority := canonicalAuthority(req.URL)
	proto, known := u.getProto(authority)
	if !known {
		conn, alpn, err := u.dialUTLS(req.Context(), authority)
		if err != nil {
			if req.Body != nil {
				_ = req.Body.Close()
			}
			return nil, err
		}
		if alpn == "h2" {
			proto = "h2"
		} else {
			proto = "http/1.1"
		}
		u.setProto(authority, proto)
		entry := u.putHandoff(authority, proto, conn)
		defer u.releaseUnusedHandoff(authority, entry)
	}

	firstReq := req
	var bodyShield *shieldedReqBody
	if req.Body != nil && req.Body != http.NoBody {
		reqCopy := *req
		bodyShield = newShieldedReqBody(req.Body)
		reqCopy.Body = bodyShield
		firstReq = &reqCopy
	}

	if proto == "h2" {
		resp, err := u.roundTripH2(firstReq)
		var sw *alpnSwitchError
		if errors.As(err, &sw) && sw.proto == "http/1.1" {
			defer u.releaseUnusedHandoff(authority, sw.entry)
			return u.h1TLSTr.RoundTrip(req)
		}
		if bodyShield != nil {
			bodyShield.unshield(err != nil)
		}
		return resp, err
	}

	resp, err := u.h1TLSTr.RoundTrip(firstReq)
	var sw *alpnSwitchError
	if errors.As(err, &sw) && sw.proto == "h2" {
		defer u.releaseUnusedHandoff(authority, sw.entry)
		return u.roundTripH2(req)
	}
	if bodyShield != nil {
		bodyShield.unshield(err != nil)
	}
	return resp, err
}

// roundTripH2 在响应头到达前施加 responseHeaderTimeout 保护；
// 响应头到达后立刻停表且不取消上下文，直到 resp.Body.Close() 才释放派生上下文，绝不掐断 SSE 长流。
func (u *utlsProxyTransport) roundTripH2(req *http.Request) (*http.Response, error) {
	timeout := u.responseHeaderTimeout
	if timeout <= 0 {
		return u.h2Tr.RoundTrip(req)
	}

	ctx, cancel := context.WithCancel(req.Context())
	var (
		mu       sync.Mutex
		done     bool
		timedOut bool
	)
	timer := time.AfterFunc(timeout, func() {
		mu.Lock()
		if !done {
			timedOut = true
			cancel()
		}
		mu.Unlock()
	})

	resp, err := u.h2Tr.RoundTrip(req.WithContext(ctx))

	mu.Lock()
	done = true
	wasTimedOut := timedOut
	mu.Unlock()
	timer.Stop()

	if err != nil {
		cancel()
		if wasTimedOut && req.Context().Err() == nil {
			return nil, context.DeadlineExceeded
		}
		return nil, err
	}
	if wasTimedOut {
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		cancel()
		return nil, context.DeadlineExceeded
	}
	if resp.Body == nil {
		cancel()
		return resp, nil
	}
	resp.Body = &cancelOnCloseBody{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}

func (u *utlsProxyTransport) dialH2TLSContext(ctx context.Context, _, addr string, _ *tls.Config) (net.Conn, error) {
	authority := canonicalAddr(addr)
	if conn := u.takeHandoff(authority, "h2"); conn != nil {
		return conn, nil
	}
	conn, alpn, err := u.dialUTLS(ctx, authority)
	if err != nil {
		return nil, err
	}
	if alpn == "h2" {
		u.setProto(authority, "h2")
		return conn, nil
	}
	// 重连时服务端意外降级为非 h2：缓存并交接给 h1TLSTr，零双重握手回落
	u.setProto(authority, "http/1.1")
	entry := u.putHandoff(authority, "http/1.1", conn)
	return nil, &alpnSwitchError{proto: "http/1.1", entry: entry}
}

func (u *utlsProxyTransport) dialH1TLSContext(ctx context.Context, _, addr string) (net.Conn, error) {
	authority := canonicalAddr(addr)
	if conn := u.takeHandoff(authority, "http/1.1"); conn != nil {
		return conn, nil
	}
	conn, alpn, err := u.dialUTLS(ctx, authority)
	if err != nil {
		return nil, err
	}
	if alpn != "h2" {
		u.setProto(authority, "http/1.1")
		return conn, nil
	}
	// 重连时服务端升级为 h2：缓存并交接给 h2Tr，避免将 h2 ALPN 连接交给 HTTP/1.1 解析器
	u.setProto(authority, "h2")
	entry := u.putHandoff(authority, "h2", conn)
	return nil, &alpnSwitchError{proto: "h2", entry: entry}
}

// dialUTLS 强制先经账号代理建立隧道，再在隧道上执行 uTLS HelloChrome_Auto 握手。
func (u *utlsProxyTransport) dialUTLS(ctx context.Context, authority string) (net.Conn, string, error) {
	rawConn, err := u.dialProxyTunnel(ctx, authority)
	if err != nil {
		return nil, "", err
	}

	serverName := extractHost(authority)
	ucfg := &utls.Config{
		ServerName: serverName,
	}
	if u.baseTLSConfig != nil {
		ucfg.RootCAs = u.baseTLSConfig.RootCAs
		ucfg.InsecureSkipVerify = u.baseTLSConfig.InsecureSkipVerify
		ucfg.MinVersion = u.baseTLSConfig.MinVersion
		ucfg.MaxVersion = u.baseTLSConfig.MaxVersion
	}

	timeout := u.tlsHandshakeTimeout
	if timeout <= 0 {
		timeout = tlsHandshakeTimeout
	}
	hCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// 保持 HelloChrome_Auto 原生 ClientHello（含 ["h2", "http/1.1"] ALPN），绝不篡改/删减扩展列表。
	uconn := utls.UClient(rawConn, ucfg, utls.HelloChrome_Auto)
	if err := uconn.HandshakeContext(hCtx); err != nil {
		_ = rawConn.Close()
		return nil, "", err
	}

	alpn := uconn.ConnectionState().NegotiatedProtocol
	return &utlsConnAdapter{UConn: uconn}, alpn, nil
}

// dialProxyTunnel 按账号代理协议建立至 targetAddr 的隧道连接；绝不允许任何直连公网回退。
func (u *utlsProxyTransport) dialProxyTunnel(ctx context.Context, targetAddr string) (net.Conn, error) {
	if strings.ContainsAny(targetAddr, "\r\n \t") {
		return nil, errors.New("invalid target address")
	}
	scheme := strings.ToLower(u.proxyURL.Scheme)
	switch scheme {
	case "http", "https":
		return u.dialHTTPConnectTunnel(ctx, scheme, targetAddr)
	case "socks5", "socks5h":
		return u.dialSOCKS5Tunnel(ctx, targetAddr)
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", u.proxyURL.Scheme)
	}
}

func (u *utlsProxyTransport) dialHTTPConnectTunnel(ctx context.Context, scheme, targetAddr string) (net.Conn, error) {
	proxyHost := u.proxyURL.Hostname()
	proxyPort := u.proxyURL.Port()
	if proxyPort == "" {
		if scheme == "https" {
			proxyPort = "443"
		} else {
			proxyPort = "80"
		}
	}
	proxyAddr := net.JoinHostPort(proxyHost, proxyPort)

	rawConn, err := u.dialCtx(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, err
	}

	if scheme == "https" {
		var pcfg *tls.Config
		if u.baseTLSConfig != nil {
			pcfg = u.baseTLSConfig.Clone()
		} else {
			pcfg = &tls.Config{}
		}
		if pcfg.ServerName == "" {
			pcfg.ServerName = proxyHost
		}
		// 与代理自身协商 HTTP/1.1 以发送标准 CONNECT 隧道请求
		pcfg.NextProtos = []string{"http/1.1"}
		tlsConn := tls.Client(rawConn, pcfg)
		hCtx, hCancel := context.WithTimeout(ctx, u.tlsHandshakeTimeout)
		hsErr := tlsConn.HandshakeContext(hCtx)
		hCancel()
		if hsErr != nil {
			_ = rawConn.Close()
			return nil, hsErr
		}
		rawConn = tlsConn
	}

	connectDeadline := time.Now().Add(dialTimeout + u.tlsHandshakeTimeout)
	if dl, ok := ctx.Deadline(); ok && dl.Before(connectDeadline) {
		connectDeadline = dl
	}
	_ = rawConn.SetDeadline(connectDeadline)
	stopWatch := context.AfterFunc(ctx, func() {
		_ = rawConn.SetDeadline(time.Now())
	})

	var sb strings.Builder
	sb.WriteString("CONNECT ")
	sb.WriteString(targetAddr)
	sb.WriteString(" HTTP/1.1\r\nHost: ")
	sb.WriteString(targetAddr)
	sb.WriteString("\r\n")
	if u.proxyURL.User != nil {
		user := u.proxyURL.User.Username()
		pass, _ := u.proxyURL.User.Password()
		cred := base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
		sb.WriteString("Proxy-Authorization: Basic ")
		sb.WriteString(cred)
		sb.WriteString("\r\n")
	}
	sb.WriteString("\r\n")

	if _, err := io.WriteString(rawConn, sb.String()); err != nil {
		canceled := !stopWatch()
		_ = rawConn.Close()
		if canceled && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}

	br := bufio.NewReader(rawConn)
	resp, err := http.ReadResponse(br, &http.Request{Method: http.MethodConnect})
	canceled := !stopWatch()
	if err != nil {
		_ = rawConn.Close()
		if canceled && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	if canceled && ctx.Err() != nil {
		_ = rawConn.Close()
		return nil, ctx.Err()
	}
	if resp.StatusCode != http.StatusOK {
		_ = rawConn.Close()
		return nil, fmt.Errorf("proxy CONNECT rejected with status %d", resp.StatusCode)
	}

	_ = rawConn.SetDeadline(time.Time{})
	if br.Buffered() > 0 {
		return &bufferedConn{Conn: rawConn, r: br}, nil
	}
	return rawConn, nil
}

func (u *utlsProxyTransport) dialSOCKS5Tunnel(ctx context.Context, targetAddr string) (net.Conn, error) {
	proxyHost := u.proxyURL.Hostname()
	proxyPort := u.proxyURL.Port()
	if proxyPort == "" {
		proxyPort = "1080"
	}
	proxyAddr := net.JoinHostPort(proxyHost, proxyPort)

	var sAuth *xproxy.Auth
	if u.proxyURL.User != nil {
		pass, _ := u.proxyURL.User.Password()
		sAuth = &xproxy.Auth{
			User:     u.proxyURL.User.Username(),
			Password: pass,
		}
	}

	d, err := xproxy.SOCKS5("tcp", proxyAddr, sAuth, contextDialerFunc(u.dialCtx))
	if err != nil {
		return nil, err
	}
	if cd, ok := d.(xproxy.ContextDialer); ok {
		return cd.DialContext(ctx, "tcp", targetAddr)
	}
	return d.Dial("tcp", targetAddr)
}

func (u *utlsProxyTransport) getProto(authority string) (string, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	p, ok := u.protoCache[authority]
	return p, ok
}

func (u *utlsProxyTransport) setProto(authority, proto string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.protoCache[authority] = proto
}

func (u *utlsProxyTransport) putHandoff(authority, proto string, conn net.Conn) *handoffEntry {
	entry := &handoffEntry{conn: conn, proto: proto}
	u.mu.Lock()
	u.handoff[authority] = append(u.handoff[authority], entry)
	u.mu.Unlock()
	return entry
}

func (u *utlsProxyTransport) takeHandoff(authority, proto string) net.Conn {
	u.mu.Lock()
	defer u.mu.Unlock()
	list := u.handoff[authority]
	for i, entry := range list {
		if entry.proto == proto && !entry.used {
			entry.used = true
			if len(list) == 1 {
				delete(u.handoff, authority)
			} else {
				u.handoff[authority] = append(list[:i], list[i+1:]...)
			}
			return entry.conn
		}
	}
	return nil
}

func (u *utlsProxyTransport) releaseUnusedHandoff(authority string, target *handoffEntry) {
	if target == nil {
		return
	}
	var toClose net.Conn
	u.mu.Lock()
	if !target.used {
		target.used = true
		toClose = target.conn
		list := u.handoff[authority]
		for i, entry := range list {
			if entry == target {
				if len(list) == 1 {
					delete(u.handoff, authority)
				} else {
					u.handoff[authority] = append(list[:i], list[i+1:]...)
				}
				break
			}
		}
	}
	u.mu.Unlock()
	if toClose != nil {
		_ = toClose.Close()
	}
}

// CloseIdleConnections 清空该账号独占的 HTTP/2、HTTPS/1.1 与明文 HTTP/1.1 空闲连接池，
// 关闭任何尚未取走的交接连接并重置 ALPN 协议缓存。
func (u *utlsProxyTransport) CloseIdleConnections() {
	if u == nil {
		return
	}
	if u.h2Tr != nil {
		u.h2Tr.CloseIdleConnections()
	}
	if u.h1TLSTr != nil {
		u.h1TLSTr.CloseIdleConnections()
	}
	if u.h1PlainTr != nil {
		u.h1PlainTr.CloseIdleConnections()
	}

	var toClose []net.Conn
	u.mu.Lock()
	for _, list := range u.handoff {
		for _, entry := range list {
			if !entry.used && entry.conn != nil {
				entry.used = true
				toClose = append(toClose, entry.conn)
			}
		}
	}
	u.handoff = make(map[string][]*handoffEntry)
	u.protoCache = make(map[string]string)
	u.mu.Unlock()

	for _, c := range toClose {
		_ = c.Close()
	}
}

func canonicalAuthority(u *url.URL) string {
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		if strings.EqualFold(u.Scheme, "http") {
			port = "80"
		} else {
			port = "443"
		}
	}
	return net.JoinHostPort(strings.ToLower(host), port)
}

func canonicalAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		host = strings.TrimPrefix(strings.TrimSuffix(addr, "]"), "[")
		port = "443"
	}
	if port == "" {
		port = "443"
	}
	return net.JoinHostPort(strings.ToLower(host), port)
}

func extractHost(authority string) string {
	host, _, err := net.SplitHostPort(authority)
	if err != nil {
		return strings.TrimPrefix(strings.TrimSuffix(authority, "]"), "[")
	}
	return strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
}
