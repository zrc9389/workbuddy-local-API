package upstream

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"golang.org/x/net/http2"
)

func newSelfSignedTestCert(t *testing.T, dnsNames ...string) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 62))
	if err != nil {
		t.Fatalf("generate serial: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "utls-test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		DNSNames:              dnsNames,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse cert: %v", err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	tlsCert := tls.Certificate{
		Certificate: [][]byte{der},
		PrivateKey:  priv,
		Leaf:        cert,
	}
	return tlsCert, pool
}

type testTLSServer struct {
	addr         string
	directHits   atomic.Int64
	proxyOutAddr sync.Map // local TCP addr opened by test proxy -> struct{}
	srv          *http.Server
	ln           net.Listener
}

func startTestTLSServer(t *testing.T, cert tls.Certificate, enableH2 bool, handler http.Handler) *testTLSServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ts := &testTLSServer{
		addr: ln.Addr().String(),
		ln:   ln,
	}
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := ts.proxyOutAddr.Load(r.RemoteAddr); !ok {
			ts.directHits.Add(1)
		}
		handler.ServeHTTP(w, r)
	})
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
	}
	srv := &http.Server{
		Handler:   wrapped,
		TLSConfig: tlsCfg,
	}
	if enableH2 {
		if err := http2.ConfigureServer(srv, &http2.Server{}); err != nil {
			ln.Close()
			t.Fatalf("configure h2 server: %v", err)
		}
	} else {
		tlsCfg.NextProtos = []string{"http/1.1"}
		srv.TLSNextProto = make(map[string]func(*http.Server, *tls.Conn, http.Handler))
	}
	ts.srv = srv
	tlsLn := tls.NewListener(ln, tlsCfg)
	go func() {
		_ = srv.Serve(tlsLn)
	}()
	t.Cleanup(func() {
		_ = srv.Close()
		_ = ln.Close()
	})
	return ts
}

func bridgeConns(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(b, a)
		if cw, ok := b.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(a, b)
		if cw, ok := a.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
	}()
	wg.Wait()
	_ = a.Close()
	_ = b.Close()
}

type testConnectProxy struct {
	addr     string
	connects atomic.Int64
	ln       net.Listener
}

func startHTTPConnectProxy(t *testing.T, ts *testTLSServer, expectedHost, expectedUser, expectedPass string, proxyTLS *tls.Config) *testConnectProxy {
	t.Helper()
	rawLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("proxy listen: %v", err)
	}
	ln := rawLn
	if proxyTLS != nil {
		ln = tls.NewListener(rawLn, proxyTLS)
	}
	p := &testConnectProxy{
		addr: rawLn.Addr().String(),
		ln:   ln,
	}
	expectedAuth := ""
	if expectedUser != "" {
		expectedAuth = "Basic " + base64.StdEncoding.EncodeToString([]byte(expectedUser+":"+expectedPass))
	}

	go func() {
		for {
			clientConn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				br := bufio.NewReader(c)
				req, err := http.ReadRequest(br)
				if err != nil {
					return
				}
				if req.Method != http.MethodConnect {
					_, _ = io.WriteString(c, "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n")
					return
				}
				if expectedHost != "" && req.Host != expectedHost {
					_, _ = io.WriteString(c, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
					return
				}
				if expectedAuth != "" && req.Header.Get("Proxy-Authorization") != expectedAuth {
					_, _ = io.WriteString(c, "HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
					return
				}
				upConn, err := net.DialTimeout("tcp", ts.addr, 3*time.Second)
				if err != nil {
					_, _ = io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
					return
				}
				ts.proxyOutAddr.Store(upConn.LocalAddr().String(), struct{}{})
				p.connects.Add(1)
				if _, err := io.WriteString(c, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
					_ = upConn.Close()
					return
				}
				var clientSide net.Conn = c
				if br.Buffered() > 0 {
					clientSide = &bufferedConn{Conn: c, r: br}
				}
				bridgeConns(clientSide, upConn)
			}(clientConn)
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
	})
	return p
}

func startSOCKS5TunnelProxy(t *testing.T, ts *testTLSServer, expectedHost, expectedUser, expectedPass string) *testConnectProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("socks5 listen: %v", err)
	}
	p := &testConnectProxy{
		addr: ln.Addr().String(),
		ln:   ln,
	}
	go func() {
		for {
			clientConn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				rd := bufio.NewReader(c)
				header := make([]byte, 2)
				if _, err := io.ReadFull(rd, header); err != nil || header[0] != 5 {
					return
				}
				methods := make([]byte, int(header[1]))
				if _, err := io.ReadFull(rd, methods); err != nil {
					return
				}
				if expectedUser != "" {
					_, _ = c.Write([]byte{5, 2})
					ah := make([]byte, 2)
					if _, err := io.ReadFull(rd, ah); err != nil {
						return
					}
					uBuf := make([]byte, int(ah[1]))
					if _, err := io.ReadFull(rd, uBuf); err != nil {
						return
					}
					pLen, err := rd.ReadByte()
					if err != nil {
						return
					}
					pBuf := make([]byte, int(pLen))
					if _, err := io.ReadFull(rd, pBuf); err != nil {
						return
					}
					if string(uBuf) != expectedUser || string(pBuf) != expectedPass {
						_, _ = c.Write([]byte{1, 1})
						return
					}
					_, _ = c.Write([]byte{1, 0})
				} else {
					_, _ = c.Write([]byte{5, 0})
				}

				reqHdr := make([]byte, 4)
				if _, err := io.ReadFull(rd, reqHdr); err != nil {
					return
				}
				if reqHdr[0] != 5 || reqHdr[1] != 1 || reqHdr[3] != 3 {
					// 强制校验 ATYP=3（远端域名解析）
					_, _ = c.Write([]byte{5, 8, 0, 1, 0, 0, 0, 0, 0, 0})
					return
				}
				hLen, err := rd.ReadByte()
				if err != nil {
					return
				}
				hostBuf := make([]byte, int(hLen))
				if _, err := io.ReadFull(rd, hostBuf); err != nil {
					return
				}
				portBuf := make([]byte, 2)
				if _, err := io.ReadFull(rd, portBuf); err != nil {
					return
				}
				if expectedHost != "" && string(hostBuf) != expectedHost {
					_, _ = c.Write([]byte{5, 2, 0, 1, 0, 0, 0, 0, 0, 0})
					return
				}

				upConn, err := net.DialTimeout("tcp", ts.addr, 3*time.Second)
				if err != nil {
					_, _ = c.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
					return
				}
				ts.proxyOutAddr.Store(upConn.LocalAddr().String(), struct{}{})
				p.connects.Add(1)
				if _, err := c.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0}); err != nil {
					_ = upConn.Close()
					return
				}
				var clientSide net.Conn = c
				if rd.Buffered() > 0 {
					clientSide = &bufferedConn{Conn: c, r: rd}
				}
				bridgeConns(clientSide, upConn)
			}(clientConn)
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
	})
	return p
}

func newTestClientWithRoots(roots *x509.CertPool) *Client {
	c := New()
	tr := c.HTTP.Transport.(*http.Transport)
	tr.TLSClientConfig = &tls.Config{RootCAs: roots}
	return c
}

func TestUTLSHTTPConnectNegotiatesH2AndReusesPool(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "h2-upstream.test")
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Observed-Proto", r.Proto)
		_, _ = io.WriteString(w, "ok-"+r.Proto)
	}))
	proxy := startHTTPConnectProxy(t, ts, "h2-upstream.test:443", "alice", "s3cr3t", nil)

	c := newTestClientWithRoots(roots)
	a := &auth.Auth{UID: "utls-h2-connect", ProxyURL: "http://alice:s3cr3t@" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	for i := 1; i <= 2; i++ {
		req, err := http.NewRequest(http.MethodGet, "https://h2-upstream.test/v2/test", nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := c.DoAccount(req, a)
		if err != nil {
			t.Fatalf("req #%d failed: %v", i, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.Proto != "HTTP/2.0" {
			t.Fatalf("req #%d: expected HTTP/2.0, got %q", i, resp.Proto)
		}
		if resp.TLS == nil || resp.TLS.NegotiatedProtocol != "h2" {
			t.Fatalf("req #%d: expected resp.TLS ALPN=h2, got %+v", i, resp.TLS)
		}
		if string(body) != "ok-HTTP/2.0" {
			t.Fatalf("req #%d: unexpected body %q", i, string(body))
		}
	}

	if ts.directHits.Load() != 0 {
		t.Fatalf("expected 0 direct hits, got %d", ts.directHits.Load())
	}
	if got := proxy.connects.Load(); got != 1 {
		t.Fatalf("expected exactly 1 CONNECT tunnel (zero double handshake + H2 pool reuse), got %d", got)
	}

	// 错误凭据必须 fail-closed 且不能泄露代理密码
	bad := &auth.Auth{UID: "utls-h2-badauth", ProxyURL: "http://alice:topsecretpass@" + proxy.addr}
	defer c.ForgetTransport(bad.UID)
	req, _ := http.NewRequest(http.MethodGet, "https://h2-upstream.test/v2/test", nil)
	if _, err := c.DoAccount(req, bad); err == nil {
		t.Fatal("expected proxy auth failure, got nil")
	} else if strings.Contains(err.Error(), "topsecretpass") {
		t.Fatalf("proxy password leaked in error: %v", err)
	}
}

func TestUTLSHTTPSProxyNegotiatesH2(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "h2-over-https-proxy.test", "127.0.0.1")
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, r.Proto)
	}))
	proxyTLS := &tls.Config{
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{"http/1.1"},
	}
	proxy := startHTTPConnectProxy(t, ts, "h2-over-https-proxy.test:443", "puser", "ppass", proxyTLS)

	c := newTestClientWithRoots(roots)
	a := &auth.Auth{UID: "utls-https-proxy", ProxyURL: "https://puser:ppass@" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	req, _ := http.NewRequest(http.MethodGet, "https://h2-over-https-proxy.test/ping", nil)
	resp, err := c.DoAccount(req, a)
	if err != nil {
		t.Fatalf("https proxy + uTLS h2 failed: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.Proto != "HTTP/2.0" || string(body) != "HTTP/2.0" {
		t.Fatalf("expected HTTP/2.0, got proto=%q body=%q", resp.Proto, string(body))
	}
	if ts.directHits.Load() != 0 || proxy.connects.Load() != 1 {
		t.Fatalf("unexpected counts direct=%d connects=%d", ts.directHits.Load(), proxy.connects.Load())
	}
}

func TestUTLSH2SSELongStreamAndHeaderTimeout(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "sse-h2.test")
	var observedAcceptEncoding atomic.Value
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedAcceptEncoding.Store(r.Header.Get("Accept-Encoding"))
		if r.URL.Path == "/slow-headers" {
			select {
			case <-time.After(450 * time.Millisecond):
				w.WriteHeader(http.StatusOK)
			case <-r.Context().Done():
			}
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter does not implement http.Flusher")
			return
		}
		flusher.Flush()
		for i := 1; i <= 4; i++ {
			_, _ = fmt.Fprintf(w, "data: chunk-%d\n\n", i)
			flusher.Flush()
			if i < 4 {
				time.Sleep(85 * time.Millisecond)
			}
		}
	}))
	proxy := startHTTPConnectProxy(t, ts, "sse-h2.test:443", "", "", nil)

	c := newTestClientWithRoots(roots)
	// 响应头超时设短于总流耗时（200ms < 3*85ms=255ms），验证响应头到达后绝不误杀 SSE 长流
	c.HTTP.Transport.(*http.Transport).ResponseHeaderTimeout = 200 * time.Millisecond

	a := &auth.Auth{UID: "utls-sse-user", ProxyURL: "http://" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	t.Run("sse_stream_realtime_no_gzip_no_premature_cancel", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodPost, "https://sse-h2.test/v2/chat/completions", strings.NewReader(`{}`))
		resp, err := c.chatClientFor(a).Do(req)
		if err != nil {
			t.Fatalf("SSE request failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.Proto != "HTTP/2.0" {
			t.Fatalf("expected HTTP/2.0 for SSE, got %q", resp.Proto)
		}
		if ae, _ := observedAcceptEncoding.Load().(string); ae != "" {
			t.Fatalf("expected empty Accept-Encoding (DisableCompression), got %q", ae)
		}

		scanner := bufio.NewScanner(resp.Body)
		var chunks []string
		var arrivalTimes []time.Time
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") {
				chunks = append(chunks, line)
				arrivalTimes = append(arrivalTimes, time.Now())
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("SSE scan error: %v", err)
		}
		if len(chunks) != 4 {
			t.Fatalf("expected 4 SSE chunks, got %d (%v)", len(chunks), chunks)
		}
		for i, want := range []string{"data: chunk-1", "data: chunk-2", "data: chunk-3", "data: chunk-4"} {
			if chunks[i] != want {
				t.Fatalf("chunk %d: want %q, got %q", i, want, chunks[i])
			}
		}
		// 首条与末条到达时间差应明显大于单步间隔，证明逐条实时流出而非整包缓冲
		if span := arrivalTimes[3].Sub(arrivalTimes[0]); span < 150*time.Millisecond {
			t.Fatalf("expected incremental streaming across >=150ms, got %v", span)
		}
	})

	t.Run("header_timeout_enforced_before_headers", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, "https://sse-h2.test/slow-headers", nil)
		_, err := c.chatClientFor(a).Do(req)
		if err == nil {
			t.Fatal("expected response header timeout error, got nil")
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected context.DeadlineExceeded, got %v", err)
		}
	})
}

func TestUTLSFallbackToHTTP11WhenServerLacksH2(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "h1-only.test")
	ts := startTestTLSServer(t, cert, false, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "h1-ok-"+r.Proto)
	}))
	proxy := startHTTPConnectProxy(t, ts, "h1-only.test:443", "", "", nil)

	c := newTestClientWithRoots(roots)
	a := &auth.Auth{UID: "utls-h1-fallback", ProxyURL: "http://" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	for i := 1; i <= 2; i++ {
		req, _ := http.NewRequest(http.MethodGet, "https://h1-only.test/check", nil)
		resp, err := c.DoAccount(req, a)
		if err != nil {
			t.Fatalf("req #%d failed: %v", i, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.Proto != "HTTP/1.1" || string(body) != "h1-ok-HTTP/1.1" {
			t.Fatalf("req #%d: expected HTTP/1.1 fallback, got proto=%q body=%q", i, resp.Proto, string(body))
		}
	}
	if ts.directHits.Load() != 0 {
		t.Fatalf("expected 0 direct hits, got %d", ts.directHits.Load())
	}
	if got := proxy.connects.Load(); got != 1 {
		t.Fatalf("expected 1 CONNECT tunnel (zero double handshake + H1 keep-alive reuse), got %d", got)
	}
}

func TestUTLSSOCKS5ProxyNegotiatesH2RemoteDNS(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "socks5-h2.test")
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "socks5-"+r.Proto)
	}))
	proxy := startSOCKS5TunnelProxy(t, ts, "socks5-h2.test", "suser", "spass")

	c := newTestClientWithRoots(roots)
	a := &auth.Auth{UID: "utls-socks5-h2", ProxyURL: "socks5://suser:spass@" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	req, _ := http.NewRequest(http.MethodGet, "https://socks5-h2.test/v2/models", nil)
	resp, err := c.DoAccount(req, a)
	if err != nil {
		t.Fatalf("socks5 uTLS h2 request failed: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.Proto != "HTTP/2.0" || string(body) != "socks5-HTTP/2.0" {
		t.Fatalf("expected HTTP/2.0 over SOCKS5, got proto=%q body=%q", resp.Proto, string(body))
	}
	if ts.directHits.Load() != 0 || proxy.connects.Load() != 1 {
		t.Fatalf("unexpected direct=%d connects=%d", ts.directHits.Load(), proxy.connects.Load())
	}
}

func TestUTLSTLSProfileGoH1FallbackAndHotSwitch(t *testing.T) {
	if got := NormalizeTLSProfile(""); got != TLSProfileChromeAuto {
		t.Fatalf("NormalizeTLSProfile(\"\") = %q", got)
	}
	if got := NormalizeTLSProfile("CHROME_AUTO"); got != TLSProfileChromeAuto {
		t.Fatalf("NormalizeTLSProfile(\"CHROME_AUTO\") = %q", got)
	}
	if got := NormalizeTLSProfile(" go_h1 "); got != TLSProfileGoH1 {
		t.Fatalf("NormalizeTLSProfile(\" go_h1 \") = %q", got)
	}
	if got := NormalizeTLSProfile("unknown"); got != TLSProfileChromeAuto {
		t.Fatalf("NormalizeTLSProfile(\"unknown\") = %q", got)
	}

	cert, roots := newSelfSignedTestCert(t, "profile-switch.test")
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, r.Proto)
	}))
	proxy := startHTTPConnectProxy(t, ts, "profile-switch.test:443", "", "", nil)

	c := newTestClientWithRoots(roots)
	a := &auth.Auth{UID: "utls-profile-switch", ProxyURL: "http://" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	// 1. 默认 "" -> chrome_auto -> HTTP/2.0
	t1 := c.transportFor(a)
	req, _ := http.NewRequest(http.MethodGet, "https://profile-switch.test/1", nil)
	resp, err := c.DoAccount(req, a)
	if err != nil {
		t.Fatalf("default chrome_auto failed: %v", err)
	}
	resp.Body.Close()
	if resp.Proto != "HTTP/2.0" {
		t.Fatalf("expected HTTP/2.0 in chrome_auto, got %q", resp.Proto)
	}

	// 2. 热切换到 go_h1 -> 缓存失效，降级回 Go HTTP/1.1
	c.TLSProfile = TLSProfileGoH1
	t2 := c.transportFor(a)
	if t1 == t2 {
		t.Fatal("expected cache invalidation when switching TLSProfile to go_h1")
	}
	req, _ = http.NewRequest(http.MethodGet, "https://profile-switch.test/2", nil)
	resp, err = c.DoAccount(req, a)
	if err != nil {
		t.Fatalf("go_h1 fallback failed: %v", err)
	}
	resp.Body.Close()
	if resp.Proto != "HTTP/1.1" {
		t.Fatalf("expected HTTP/1.1 in go_h1, got %q", resp.Proto)
	}

	// 3. 热切回 chrome_auto -> 重新走 uTLS HTTP/2.0
	c.TLSProfile = TLSProfileChromeAuto
	t3 := c.transportFor(a)
	if t2 == t3 {
		t.Fatal("expected cache invalidation when switching TLSProfile back to chrome_auto")
	}
	req, _ = http.NewRequest(http.MethodGet, "https://profile-switch.test/3", nil)
	resp, err = c.DoAccount(req, a)
	if err != nil {
		t.Fatalf("switch back to chrome_auto failed: %v", err)
	}
	resp.Body.Close()
	if resp.Proto != "HTTP/2.0" {
		t.Fatalf("expected HTTP/2.0 after switching back, got %q", resp.Proto)
	}
	if ts.directHits.Load() != 0 {
		t.Fatalf("direct leak detected: %d", ts.directHits.Load())
	}
}

func TestUTLSCloseIdleAndForgetTransport(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "close-idle.test")
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	proxy := startHTTPConnectProxy(t, ts, "close-idle.test:443", "", "", nil)

	c := newTestClientWithRoots(roots)
	a := &auth.Auth{UID: "utls-close-idle", ProxyURL: "http://" + proxy.addr}
	defer c.ForgetTransport(a.UID)

	doReq := func() {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, "https://close-idle.test/ping", nil)
		resp, err := c.DoAccount(req, a)
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		_, _ = io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.Proto != "HTTP/2.0" {
			t.Fatalf("expected HTTP/2.0, got %q", resp.Proto)
		}
	}

	doReq()
	doReq()
	if got := proxy.connects.Load(); got != 1 {
		t.Fatalf("expected 1 pooled H2 tunnel before CloseIdle, got %d", got)
	}

	// 模拟传输错误后触发 roundTripCloseIdle：空闲 H2 连接与协议缓存应全部清空
	rt1 := c.transportFor(a)
	roundTripCloseIdle(rt1)

	doReq()
	if got := proxy.connects.Load(); got != 2 {
		t.Fatalf("expected fresh tunnel after roundTripCloseIdle, got %d", got)
	}

	// ForgetTransport 应清池并销毁缓存实例
	c.ForgetTransport(a.UID)
	rt2 := c.transportFor(a)
	if rt1 == rt2 {
		t.Fatal("expected new transport instance after ForgetTransport")
	}

	doReq()
	if got := proxy.connects.Load(); got != 3 {
		t.Fatalf("expected fresh tunnel after ForgetTransport, got %d", got)
	}
}

func TestUTLSPerAccountPoolIsolation(t *testing.T) {
	cert, roots := newSelfSignedTestCert(t, "iso-pool.test")
	ts := startTestTLSServer(t, cert, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	proxy := startHTTPConnectProxy(t, ts, "iso-pool.test:443", "", "", nil)

	c := newTestClientWithRoots(roots)
	acctA := &auth.Auth{UID: "acct-alpha", ProxyURL: "http://" + proxy.addr}
	acctB := &auth.Auth{UID: "acct-beta", ProxyURL: "http://" + proxy.addr}
	defer c.ForgetTransport(acctA.UID)
	defer c.ForgetTransport(acctB.UID)

	trA, okA := c.transportFor(acctA).(safeProxyTransport)
	trB, okB := c.transportFor(acctB).(safeProxyTransport)
	if !okA || !okB {
		t.Fatalf("expected safeProxyTransport for both accounts, got %T and %T", c.transportFor(acctA), c.transportFor(acctB))
	}
	utA, okA := trA.rt.(*utlsProxyTransport)
	utB, okB := trB.rt.(*utlsProxyTransport)
	if !okA || !okB {
		t.Fatalf("expected *utlsProxyTransport for both accounts, got %T and %T", trA.rt, trB.rt)
	}
	if utA == utB {
		t.Fatal("accounts must not share *utlsProxyTransport")
	}
	if utA.h2Tr == utB.h2Tr {
		t.Fatal("accounts must not share *http2.Transport")
	}
	if utA.h1TLSTr == utB.h1TLSTr || utA.h1PlainTr == utB.h1PlainTr {
		t.Fatal("accounts must not share *http.Transport pools")
	}

	for _, a := range []*auth.Auth{acctA, acctB} {
		req, _ := http.NewRequest(http.MethodGet, "https://iso-pool.test/v2/chat", nil)
		resp, err := c.DoAccount(req, a)
		if err != nil {
			t.Fatalf("account %s request failed: %v", a.UID, err)
		}
		resp.Body.Close()
		if resp.Proto != "HTTP/2.0" {
			t.Fatalf("account %s expected HTTP/2.0, got %q", a.UID, resp.Proto)
		}
	}
	if got := proxy.connects.Load(); got != 2 {
		t.Fatalf("expected 2 isolated proxy tunnels (1 per account), got %d", got)
	}
}

func TestUTLSFailClosedNoProxyAndRejectsCustomDialTLS(t *testing.T) {
	c := New() // 默认 chrome_auto，无代理
	a := &auth.Auth{UID: "no-proxy-utls", ProxyURL: ""}

	for _, target := range []string{
		"https://copilot.tencent.com/v2/chat/completions",
		"https://www.workbuddy.ai/v2/chat/completions",
		"http://1.1.1.1/test",
	} {
		req, _ := http.NewRequest(http.MethodPost, target, nil)
		_, err := c.DoAccount(req, a)
		if err == nil || !strings.Contains(err.Error(), "strictly prohibited") {
			t.Fatalf("target %s must be blocked by failClosedDirectTransport, got err=%v", target, err)
		}
	}

	// 验证自定义 DialTLSContext 在默认 chrome_auto 下仍被严格拒绝，不会绕过代理检查
	c2 := New()
	tr := c2.HTTP.Transport.(*http.Transport)
	tr.DialTLSContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		t.Error("custom DialTLSContext must never be invoked")
		return nil, errors.New("should not run")
	}
	a2 := &auth.Auth{UID: "custom-dialtls", ProxyURL: "http://127.0.0.1:8080"}
	req, _ := http.NewRequest(http.MethodGet, "https://copilot.tencent.com/v2/test", nil)
	if _, err := c2.DoAccount(req, a2); err == nil {
		t.Fatal("expected proxyFailure when base transport has custom DialTLSContext")
	}
}
