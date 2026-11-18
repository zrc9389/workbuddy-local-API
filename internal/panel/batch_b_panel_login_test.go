package panel

import (
	"net/http"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

func TestBatchBLoginProxyUsesUTLSWhenNotGoH1(t *testing.T) {
	oldClient := getLoginHTTP()
	defer setLoginHTTP(oldClient)

	if err := setLoginProxyWithProfile("http://127.0.0.1:7890", upstream.TLSProfileChromeAuto); err != nil {
		t.Fatalf("setLoginProxyWithProfile(chrome_auto): %v", err)
	}
	c := getLoginHTTP()
	if _, isPlainHTTP := c.Transport.(*http.Transport); isPlainHTTP {
		t.Fatalf("expected uTLS RoundTripper for chrome_auto, got plain *http.Transport")
	}

	if err := setLoginProxyWithProfile("http://127.0.0.1:7890", upstream.TLSProfileGoH1); err != nil {
		t.Fatalf("setLoginProxyWithProfile(go_h1): %v", err)
	}
	c2 := getLoginHTTP()
	if _, isPlainHTTP := c2.Transport.(*http.Transport); !isPlainHTTP {
		t.Fatalf("expected *http.Transport for go_h1 fallback, got %T", c2.Transport)
	}
}
