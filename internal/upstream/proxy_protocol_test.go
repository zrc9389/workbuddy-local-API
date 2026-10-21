package upstream

import (
	"bufio"
	"crypto/x509"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPSProxyAndChatClientPreserveTransportPolicy(t *testing.T) {
	proxy := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !r.URL.IsAbs() {
			t.Error("expected absolute proxy URL")
		}
		if r.Header.Get("Proxy-Authorization") == "" {
			t.Error("proxy authentication missing")
		}
		w.Write([]byte("secure-proxy"))
	}))
	defer proxy.Close()
	c := New()
	tr := c.HTTP.Transport.(*http.Transport)
	roots := x509.NewCertPool()
	roots.AddCert(proxy.Certificate())
	tr.TLSClientConfig = proxy.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	tr.TLSClientConfig.RootCAs = roots
	a := &auth.Auth{UID: "https", ProxyURL: strings.Replace(proxy.URL, "https://", "https://user:password@", 1)}
	req, _ := http.NewRequest("GET", "http://unresolvable.invalid/", nil)
	resp, err := c.DoAccount(req, a)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "secure-proxy" {
		t.Fatal("wrong proxy")
	}
	chat := c.chatClientFor(a)
	if chat.Timeout != c.ChatHTTP.Timeout {
		t.Fatal("chat timeout changed")
	}
	if chat.Transport == nil {
		t.Fatal("missing chat proxy")
	}
	c.ForgetTransport(a.UID)
}
func TestSOCKS5ProxyRemoteDNSAndAuthentication(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	done := make(chan error, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(3 * time.Second))
		rd := bufio.NewReader(conn)
		fail := func(err error) { done <- err }
		header := make([]byte, 2)
		if _, err = io.ReadFull(rd, header); err != nil {
			fail(err)
			return
		}
		methods := make([]byte, int(header[1]))
		if _, err = io.ReadFull(rd, methods); err != nil {
			fail(err)
			return
		}
		conn.Write([]byte{5, 2})
		authHeader := make([]byte, 2)
		if _, err = io.ReadFull(rd, authHeader); err != nil {
			fail(err)
			return
		}
		user := make([]byte, int(authHeader[1]))
		io.ReadFull(rd, user)
		n, _ := rd.ReadByte()
		pass := make([]byte, int(n))
		io.ReadFull(rd, pass)
		if string(user) != "user" || string(pass) != "password" {
			fail(io.ErrUnexpectedEOF)
			return
		}
		conn.Write([]byte{1, 0})
		request := make([]byte, 4)
		if _, err = io.ReadFull(rd, request); err != nil {
			fail(err)
			return
		}
		if request[3] != 3 {
			fail(io.ErrUnexpectedEOF)
			return
		}
		n, _ = rd.ReadByte()
		host := make([]byte, int(n))
		io.ReadFull(rd, host)
		port := make([]byte, 2)
		io.ReadFull(rd, port)
		if string(host) != "unresolvable.invalid" {
			fail(io.ErrUnexpectedEOF)
			return
		}
		conn.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 80})
		r, err := http.ReadRequest(rd)
		if err != nil {
			fail(err)
			return
		}
		r.Body.Close()
		_, err = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nsocks")
		done <- err
	}()
	c := New()
	a := &auth.Auth{UID: "socks", ProxyURL: "socks5://user:password@" + ln.Addr().String()}
	req, _ := http.NewRequest("GET", "http://unresolvable.invalid/", nil)
	resp, err := c.DoAccount(req, a)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "socks" {
		t.Fatal(string(b))
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	c.ForgetTransport(a.UID)
}
func TestConfiguredProxyRejectsOpaqueTransport(t *testing.T) {
	var called bool
	c := New()
	c.HTTP.Transport = proxyOpaqueRoundTrip(func(r *http.Request) (*http.Response, error) { called = true; return nil, nil })
	a := &auth.Auth{UID: "opaque", ProxyURL: "http://localhost:8080"}
	req, _ := http.NewRequest("GET", "http://unresolvable.invalid", nil)
	if _, err := c.DoAccount(req, a); err == nil || called {
		t.Fatal("custom transport bypassed proxy")
	}
}

type proxyOpaqueRoundTrip func(*http.Request) (*http.Response, error)

func (f proxyOpaqueRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
