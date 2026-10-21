package panel

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/localauth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/scheduler"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestSessionBootstrapIsSingleFlightPerBrowserSession(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/get-user-resource") {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		calls.Add(1)
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte(`{"code":0,"data":{"Response":{"Data":{"Accounts":[{"CycleCapacitySize":1000,"CycleCapacityRemain":500,"CycleCapacityUsed":0}]}}}}`))
	}))
	defer srv.Close()

	accounts := pool.New("")
	for i := 0; i < 5; i++ {
		accounts.Add(&auth.Auth{UID: fmt.Sprintf("bootstrap-%02d", i), AccessToken: "at", RefreshToken: "rt", ExpiresAt: 9999999999})
	}
	up := &upstream.Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, BillingBaseCN: srv.URL}
	svc := scheduler.New(scheduler.Config{Pool: accounts, Upstream: up})
	p := New(Config{Pool: accounts, Scheduler: svc})

	first := httptest.NewRequest(http.MethodPost, "/panel/api/session/bootstrap", strings.NewReader("{}"))
	first.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "browser-session-one"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, first)
	if w.Code != http.StatusAccepted {
		t.Fatalf("first bootstrap status=%d body=%s", w.Code, w.Body.String())
	}

	second := httptest.NewRequest(http.MethodPost, "/panel/api/session/bootstrap", strings.NewReader("{}"))
	second.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "browser-session-one"})
	w = httptest.NewRecorder()
	p.ServeHTTP(w, second)
	if w.Code != http.StatusOK {
		t.Fatalf("duplicate bootstrap status=%d body=%s", w.Code, w.Body.String())
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/panel/api/session/bootstrap/status", nil)
		req.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "browser-session-one"})
		p.ServeHTTP(status, req)
		if strings.Contains(status.Body.String(), `"completed":true`) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := calls.Load(); got != 5 {
		t.Fatalf("upstream calls=%d want exactly 5 for one bootstrap", got)
	}
	var firstStatus bootstrapState
	status := httptest.NewRecorder()
	statusReq := httptest.NewRequest(http.MethodGet, "/panel/api/session/bootstrap/status", nil)
	statusReq.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "browser-session-one"})
	p.ServeHTTP(status, statusReq)
	if err := json.Unmarshal(status.Body.Bytes(), &firstStatus); err != nil {
		t.Fatal(err)
	}
	if !firstStatus.Completed || firstStatus.Total != 5 || firstStatus.Succeeded != 5 || firstStatus.FailedCount != 0 {
		t.Fatalf("unexpected completed bootstrap status: %+v", firstStatus)
	}

	other := httptest.NewRequest(http.MethodPost, "/panel/api/session/bootstrap", strings.NewReader("{}"))
	other.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "browser-session-two"})
	w = httptest.NewRecorder()
	p.ServeHTTP(w, other)
	if w.Code != http.StatusAccepted {
		t.Fatalf("second browser bootstrap status=%d body=%s", w.Code, w.Body.String())
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/panel/api/session/bootstrap/status", nil)
		req.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "browser-session-two"})
		p.ServeHTTP(status, req)
		if strings.Contains(status.Body.String(), `"completed":true`) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := calls.Load(); got != 10 {
		t.Fatalf("independent browser refresh calls=%d want 10 total", got)
	}
}

func TestSessionBootstrapFailureCanRetry(t *testing.T) {
	var round atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if round.Load() == 0 {
			_, _ = w.Write([]byte(`{"code":12345,"msg":"temporary business failure"}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"Response":{"Data":{"Accounts":[{"CycleCapacitySize":1000,"CycleCapacityRemain":500,"CycleCapacityUsed":0}]}}}}`))
	}))
	defer srv.Close()

	accounts := pool.New("")
	accounts.Add(&auth.Auth{UID: "retry-one", AccessToken: "at", RefreshToken: "rt", ExpiresAt: 9999999999})
	up := &upstream.Client{HTTP: srv.Client(), ChatBaseCN: srv.URL, BillingBaseCN: srv.URL}
	p := New(Config{Pool: accounts, Scheduler: scheduler.New(scheduler.Config{Pool: accounts, Upstream: up})})
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/panel/api/session/bootstrap", strings.NewReader("{}"))
		req.AddCookie(&http.Cookie{Name: "wb_local_session", Value: "retry-session"})
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		return rec
	}
	if rec := post(); rec.Code != http.StatusAccepted {
		t.Fatalf("first bootstrap status=%d", rec.Code)
	}
	waitBootstrap(t, p, "retry-session", func(s bootstrapState) bool { return s.Failed })
	round.Store(1)
	if rec := post(); rec.Code != http.StatusAccepted {
		t.Fatalf("retry bootstrap status=%d body=%s", rec.Code, rec.Body.String())
	}
	s := waitBootstrap(t, p, "retry-session", func(s bootstrapState) bool { return s.Completed })
	if s.FailedCount != 0 || s.Succeeded != 1 {
		t.Fatalf("retry did not replace failed result: %+v", s)
	}
}

func TestBootstrapRequiresAuthenticatedSessionAndCSRF(t *testing.T) {
	accounts := pool.New("")
	p := New(Config{Pool: accounts, Scheduler: scheduler.New(scheduler.Config{Pool: accounts})})
	a, err := localauth.New(t.TempDir() + "/password.json")
	if err != nil {
		t.Fatal(err)
	}
	h := a.Wrap(p)
	request := func(method, path string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://127.0.0.1:7863"+path, strings.NewReader("{}"))
		req.RemoteAddr = "127.0.0.1:5000"
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := request(http.MethodPost, "/panel/api/session/bootstrap", nil, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated bootstrap status=%d", rec.Code)
	}
	loginRequest := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7863/auth/login", strings.NewReader(`{"password":"123456"}`))
	loginRequest.RemoteAddr = "127.0.0.1:5000"
	loginRequest.Header.Set("Content-Type", "application/json")
	login := httptest.NewRecorder()
	h.ServeHTTP(login, loginRequest)
	if login.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", login.Code, login.Body.String())
	}
	var authReply struct {
		CSRF string `json:"csrf_token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &authReply); err != nil {
		t.Fatal(err)
	}
	cookie := login.Result().Cookies()[0]
	if rec := request(http.MethodPost, "/panel/api/session/bootstrap", cookie, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("missing csrf bootstrap status=%d", rec.Code)
	}
	if rec := request(http.MethodPost, "/panel/api/session/bootstrap", cookie, authReply.CSRF); rec.Code != http.StatusAccepted {
		t.Fatalf("authenticated bootstrap status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func waitBootstrap(t *testing.T, p *Panel, cookie string, done func(bootstrapState) bool) bootstrapState {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/panel/api/session/bootstrap/status", nil)
		req.AddCookie(&http.Cookie{Name: "wb_local_session", Value: cookie})
		p.ServeHTTP(rec, req)
		var state bootstrapState
		if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
			t.Fatal(err)
		}
		if done(state) {
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("bootstrap did not reach expected state")
	return bootstrapState{}
}
