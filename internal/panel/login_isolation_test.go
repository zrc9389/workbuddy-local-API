package panel

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

type loginTestTransport func(*http.Request) (*http.Response, error)

func (f loginTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestLoginReplacesCredentialsPreservesProxy(t *testing.T) {
	oldHTTP := loginHTTP
	defer func() { loginHTTP = oldHTTP }()
	loginHTTP = &http.Client{Transport: loginTestTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Query().Get("state") != "state+test" {
			t.Errorf("state query=%q", r.URL.RawQuery)
		}
		body := "{\"code\":0,\"data\":{\"accessToken\":\"new-fake\",\"refreshToken\":\"new-refresh\",\"expiresIn\":3600}}"
		if strings.Contains(r.URL.Path, "/login/account") {
			body = "{\"code\":0,\"data\":{\"uid\":\"u\",\"enterpriseId\":\"test\"}}"
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	fixtureHTTP := &http.Client{Transport: loginTestTransport(func(r *http.Request) (*http.Response, error) {
		t.Error("unexpected upstream request")
		return nil, io.EOF
	})}
	dir := t.TempDir()
	accounts := pool.New("")
	original := &auth.Auth{UID: "u", AccessToken: "old-fake", ProxyURL: "http://localhost:1234", FilePath: filepath.Join(dir, "workbuddy-u.json")}
	if err := original.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	accounts.Add(original)
	accounts.Disable("u", "invalid token")
	p := New(Config{Pool: accounts, AuthDir: dir, DeletionJournalPath: filepath.Join(dir, "journal.json"), Upstream: &upstream.Client{HTTP: fixtureHTTP, ChatBaseCN: "https://fixture.invalid", BillingBaseCN: "https://fixture.invalid", WebBaseCN: "https://fixture.invalid"}})
	p.logins["state+test"] = loginSession{created: time.Now(), realm: "cn"}
	w := httptest.NewRecorder()
	p.loginPoll(w, httptest.NewRequest("GET", "/?state=state%2Btest", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "\"done\":true") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	current := accounts.AuthByUID("u")
	st, _ := accounts.Status("u")
	if current == original || current.AccessTokenValue() != "new-fake" || current.ProxyURLValue() != "http://localhost:1234" || st.Blocked {
		t.Fatalf("credentials or status incorrect: %+v", st)
	}
}
