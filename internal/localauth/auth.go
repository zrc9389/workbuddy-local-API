// Package localauth is the only HTTP trust boundary. Chat is local and keyless;
// management uses a password session. Forwarded headers never grant local access.
package localauth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const iterations = 600000
const cookieName = "wb_local_session"
const sessionLifetime = 24 * time.Hour

type passwordRecord struct {
	Salt    string `json:"salt"`
	Hash    string `json:"hash"`
	Default bool   `json:"default_password"`
}
type session struct {
	CSRF    string
	Expires time.Time
}
type Auth struct {
	mu       sync.Mutex
	path     string
	record   passwordRecord
	sessions map[string]session
	attempts []time.Time
	preload  *PreloadManager
}

func ValidateListen(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("listen requires a loopback IP and port: %w", err)
	}
	ip := net.ParseIP(host)
	n, e := strconv.Atoi(port)
	if ip == nil || !ip.IsLoopback() || e != nil || n < 1 || n > 65535 {
		return errors.New("listen must be 127.0.0.1:port or [::1]:port (no wildcard or hostname)")
	}
	return nil
}
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func derive(password string, salt []byte) []byte {
	b, err := pbkdf2.Key(sha256.New, password, salt, iterations, 32)
	if err != nil {
		panic(err)
	}
	return b
}
func New(path string) (*Auth, error) {
	a := &Auth{path: path, sessions: map[string]session{}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		// No bootstrap password is stored. The first non-empty password supplied
		// through /auth/login becomes the credential; empty input is rejected.
		err = a.setUnconfiguredRecord()
	} else if err == nil {
		err = json.Unmarshal(b, &a.record)
		if err == nil {
			salt, e := hex.DecodeString(a.record.Salt)
			hash, e2 := hex.DecodeString(a.record.Hash)
			if e != nil || e2 != nil || len(salt) != 32 || len(hash) != 32 {
				err = errors.New("invalid password record; use offline reset")
			}
		}
	}
	if err != nil {
		return nil, err
	}
	a.preload = NewPreloadManager(a)
	return a, nil
}

// Reset is an explicit local CLI operation. It clears the configured password
// and requires the next login to establish a new non-empty password.
func Reset(path string) error { return (&Auth{path: path}).setUnconfiguredRecord() }

func (a *Auth) setUnconfiguredRecord() error {
	// Hash an unguessable random sentinel, never a built-in/default password.
	sentinel := randomToken() + randomToken()
	return a.setPasswordRecord(sentinel, true)
}

func (a *Auth) setPassword(p string) error {
	return a.setPasswordRecord(p, false)
}

func (a *Auth) setPasswordRecord(p string, isDefault bool) error {
	salt := randomToken()
	raw, _ := hex.DecodeString(salt)
	rec := passwordRecord{salt, hex.EncodeToString(derive(p, raw)), isDefault}
	b, _ := json.Marshal(rec)
	if err := os.MkdirAll(filepath.Dir(a.path), 0700); err != nil {
		return err
	}
	tmp := a.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err != nil {
		return err
	}
	if ce != nil {
		return ce
	}
	if err = os.Rename(tmp, a.path); err != nil {
		return err
	}
	a.record = rec
	a.sessions = map[string]session{}
	return nil
}
func (a *Auth) matches(p string) bool {
	salt, _ := hex.DecodeString(a.record.Salt)
	want, _ := hex.DecodeString(a.record.Hash)
	return subtle.ConstantTimeCompare(derive(p, salt), want) == 1
}
func jsonReply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	b, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "could not encode response", 500)
		return
	}
	b = append(b, '\n')
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
func deny(w http.ResponseWriter, status int, msg string) {
	jsonReply(w, status, map[string]any{"error": msg, "message": msg})
}
func isWrite(r *http.Request) bool {
	return r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
}
func localBoundary(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		denyRequest(w, r, 403, "loopback connections only")
		return false
	}
	host = r.Host
	if strings.Contains(host, ":") {
		host, _, err = net.SplitHostPort(host)
		if err != nil {
			denyRequest(w, r, 403, "invalid host")
			return false
		}
	}
	ip := net.ParseIP(host)
	if !strings.EqualFold(host, "localhost") && (ip == nil || !ip.IsLoopback()) {
		denyRequest(w, r, 403, "invalid local host")
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, e := url.Parse(origin)
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if e != nil || u.Scheme != scheme || !strings.EqualFold(u.Host, r.Host) || u.User != nil || u.Path != "" {
			denyRequest(w, r, 403, "cross-origin access denied")
			return false
		}
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		denyRequest(w, r, 403, "cross-site access denied")
		return false
	}
	if isWrite(r) {
		ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if ct != "application/json" {
			denyRequest(w, r, 415, "application/json required")
			return false
		}
	}
	return true
}
func (a *Auth) current(r *http.Request) (session, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return session{}, false
	}
	s, ok := a.sessions[c.Value]
	if !ok || time.Now().After(s.Expires) {
		delete(a.sessions, c.Value)
		return session{}, false
	}
	return s, true
}
func (a *Auth) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !localBoundary(w, r) {
			return
		}
		if r.URL.Path == "/api/preload-bundle" || r.URL.Path == "/api/unlock" {
			if a.preload != nil {
				a.preload.ServeHTTP(w, r)
			} else {
				deny(w, 500, "preload not initialized")
			}
			return
		}
		if strings.HasPrefix(r.URL.Path, "/auth/") {
			a.serve(w, r)
			return
		}
		admin := r.URL.Path == "/status" || strings.HasPrefix(r.URL.Path, "/panel/api/") || strings.HasPrefix(r.URL.Path, "/admin/")
		if admin {
			if isWrite(r) {
				r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
			}
			a.mu.Lock()
			s, ok := a.current(r)
			a.mu.Unlock()
			if !ok {
				denyRequest(w, r, 401, "login required")
				return
			}
			if isWrite(r) && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.CSRF)) != 1 {
				denyRequest(w, r, 403, "invalid csrf token")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *Auth) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/auth/session" && r.Method == "GET" {
		a.mu.Lock()
		defer a.mu.Unlock()
		s, authenticated := a.current(r)
		// 首次登录状态在未认证时也必须可见，前端才能正确展示首次设置流程。
		jsonReply(w, 200, map[string]any{"authenticated": authenticated, "csrf_token": s.CSRF, "default_password": a.record.Default})
		return
	}
	if r.Method != "POST" {
		deny(w, 405, "method not allowed")
		return
	}
	var input struct {
		Password string `json:"password"`
		Old      string `json:"old_password"`
		New      string `json:"new_password"`
	}
	// Read untrusted input outside the state lock; cap slow-body occupancy.
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer controller.SetReadDeadline(time.Time{})
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		deny(w, 400, "invalid JSON")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, authenticated := a.current(r)
	if r.URL.Path == "/auth/login" {
		now := time.Now()
		kept := a.attempts[:0]
		for _, t := range a.attempts {
			if now.Sub(t) < time.Minute {
				kept = append(kept, t)
			}
		}
		a.attempts = kept
		if len(kept) >= 5 {
			w.Header().Set("Retry-After", "60")
			deny(w, 429, "too many login attempts; retry in one minute")
			return
		}
		a.attempts = append(a.attempts, now)

		// 严禁无密码登录：输入空密码直接报错拦截
		pwd := strings.TrimSpace(input.Password)
		if pwd == "" {
			deny(w, 400, "password cannot be empty")
			return
		}

		if a.record.Default {
			// 第一次登录（处于初始默认密码状态）：允许输入任意密码并自动记住持久化
			if a.matches(pwd) {
				// 首次输入有效密码后立即转正为持久化管理密码
				_ = a.setPassword(pwd)
			} else if len(pwd) >= 1 && len(pwd) <= 1024 {
				// 首次输入任意非空密码，持久化为正式密码并取消默认密码状态
				if err := a.setPassword(pwd); err != nil {
					deny(w, 500, "could not save password")
					return
				}
			}
		} else {
			if len(input.Password) > 1024 || !a.matches(input.Password) {
				deny(w, 401, "incorrect password")
				return
			}
		}

		for k, v := range a.sessions {
			if now.After(v.Expires) {
				delete(a.sessions, k)
			}
		}
		if len(a.sessions) >= 64 {
			deny(w, 429, "too many active sessions")
			return
		}
		token := randomToken()
		s = session{randomToken(), now.Add(sessionLifetime)}
		a.sessions[token] = s
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLifetime.Seconds())})
		jsonReply(w, 200, map[string]any{"authenticated": true, "csrf_token": s.CSRF, "default_password": a.record.Default})
		return
	}
	// 处于默认密码状态下，允许免登录直接调用保存接口设定密码
	isDefaultPasswordSetup := a.record.Default && r.URL.Path == "/auth/password"
	if !authenticated && !isDefaultPasswordSetup {
		deny(w, 401, "login required")
		return
	}
	if authenticated && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.CSRF)) != 1 {
		deny(w, 403, "invalid csrf token")
		return
	}
	switch r.URL.Path {
	case "/auth/password":
		newPwd := input.New
		if newPwd == "" && input.Password != "" {
			newPwd = input.Password
		}
		if len(newPwd) < 6 || len(newPwd) > 128 {
			deny(w, 400, "password must be 6–128 bytes")
			return
		}
		// 若处于默认密码模式，免验证旧密码；否则强制比对旧密码
		if !a.record.Default {
			if !a.matches(input.Old) {
				deny(w, 403, "incorrect old password")
				return
			}
		}
		if err := a.setPassword(newPwd); err != nil {
			deny(w, 500, "could not save password")
			return
		}
		if !authenticated {
			now := time.Now()
			token := randomToken()
			s = session{randomToken(), now.Add(sessionLifetime)}
			a.sessions[token] = s
			http.SetCookie(w, &http.Cookie{
				Name:     cookieName,
				Value:    token,
				Path:     "/",
				HttpOnly: true,
				Secure:   r.TLS != nil,
				SameSite: http.SameSiteStrictMode,
				MaxAge:   int(sessionLifetime.Seconds()),
			})
			jsonReply(w, 200, map[string]any{"ok": true, "authenticated": true, "csrf_token": s.CSRF, "default_password": false})
			return
		}
	case "/auth/logout":
		if c, e := r.Cookie(cookieName); e == nil {
			delete(a.sessions, c.Value)
		}
	default:
		deny(w, 404, "not found")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	jsonReply(w, 200, map[string]any{"ok": true, "authenticated": false})
}

// Deliver a small rejection before bounded draining of an unread upload. Closing
// a TCP connection with pending inbound bytes can otherwise reset the socket and
// hide the HTTP status on Windows clients. Never drain unbounded or without a deadline.
func denyRequest(w http.ResponseWriter, r *http.Request, status int, msg string) {
	deny(w, status, msg)
	if isWrite(r) && r.Body != nil {
		c := http.NewResponseController(w)
		_ = c.Flush()
		if e := c.SetReadDeadline(time.Now().Add(200 * time.Millisecond)); e == nil {
			_, _ = io.CopyN(io.Discard, r.Body, 32<<10)
			_ = c.SetReadDeadline(time.Time{})
		}
	}
}

// Preload 返回绑定的 PreloadManager
func (a *Auth) Preload() *PreloadManager { return a.preload }
