package upstream

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAccountLeaseHeldUntilBodyClose(t *testing.T) {
	active := 0
	c := New()
	c.HTTP.Transport = leaseRoundTrip(func(r *http.Request) (*http.Response, error) {
		if active != 1 {
			t.Fatal("missing lease")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("ok")), Header: make(http.Header)}, nil
	})
	c.AccountLease = func(context.Context, *auth.Auth) (func(), error) { active++; return func() { active-- }, nil }
	req, _ := http.NewRequest("GET", "http://fixture.invalid", nil)
	resp, e := c.DoAccount(req, &auth.Auth{UID: "x"})
	if e != nil {
		t.Fatal(e)
	}
	if active != 1 {
		t.Fatal("released before streaming ends")
	}
	resp.Body.Close()
	resp.Body.Close()
	if active != 0 {
		t.Fatal("release not once")
	}
}

type leaseRoundTrip func(*http.Request) (*http.Response, error)

func (f leaseRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
