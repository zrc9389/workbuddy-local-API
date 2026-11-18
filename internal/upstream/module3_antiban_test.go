package upstream

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

func TestModule3DesktopVersionHeadersAndStrictH2(t *testing.T) {
	// 1. Desktop UA & fingerprint align with defaultClientVersion (5.5.4)
	if !strings.Contains(desktopUA, "WorkBuddy/"+defaultClientVersion) || strings.Contains(desktopUA, "5.5.6") {
		t.Fatalf("desktopUA not aligned with defaultClientVersion (%s): %q", defaultClientVersion, desktopUA)
	}
	a := &auth.Auth{UID: "u-m3-1", AccessToken: "acc-1", RefreshToken: "ref-1"}
	fp := desktopFingerprint(a)
	if fp["ideVersion"] != defaultClientVersion || fp["extVersion"] != defaultClientVersion {
		t.Fatalf("desktopFingerprint versions mismatch: ide=%v ext=%v want=%s", fp["ideVersion"], fp["extVersion"], defaultClientVersion)
	}

	// 2. RefreshHeaders reads refresh token safely
	c := New()
	req, _ := http.NewRequest(http.MethodPost, "https://example.test/refresh", nil)
	c.RefreshHeaders(req, a)
	if got := req.Header.Get("X-Refresh-Token"); got != "ref-1" {
		t.Fatalf("X-Refresh-Token=%q want ref-1", got)
	}

	// 3. uTLS HTTP/2 transport sets StrictMaxConcurrentStreams=true
	pu, _ := url.Parse("http://127.0.0.1:18080")
	ut, err := newUTLSProxyTransport(newTransport(), pu)
	if err != nil {
		t.Fatalf("newUTLSProxyTransport failed: %v", err)
	}
	if ut == nil || ut.h2Tr == nil {
		t.Fatalf("expected *utlsProxyTransport with h2Tr")
	}
	if !ut.h2Tr.StrictMaxConcurrentStreams {
		t.Fatal("expected http2.Transport.StrictMaxConcurrentStreams to be true")
	}
}

func TestRewriteLargePayloadStripsMetadataUserIDAcrossPositions(t *testing.T) {
	cases := []struct {
		name           string
		in             string
		expectHasMeta  bool
		expectKeepVal  string
		expectMaxToken int
	}{
		{
			name:           "middle_metadata_with_extra_key",
			in:             `{"model":"x","max_tokens":11128,"metadata":{"user_id":"secret-uid","userId":"secret-uid2","trace":"keep-me"},"messages":[{"role":"user","content":"hello 11128"}]}`,
			expectHasMeta:  true,
			expectKeepVal:  "keep-me",
			expectMaxToken: 11128,
		},
		{
			name:           "middle_metadata_becomes_empty",
			in:             `{"model":"x","metadata":{"user_id":"secret-uid","userId":"secret-uid2"},"max_tokens":11128}`,
			expectHasMeta:  false,
			expectMaxToken: 11128,
		},
		{
			name:           "first_metadata_becomes_empty",
			in:             `{"metadata":{"user_id":"secret-uid"},"model":"x","max_tokens":11128}`,
			expectHasMeta:  false,
			expectMaxToken: 11128,
		},
		{
			name:           "last_metadata_becomes_empty",
			in:             `{"model":"x","max_tokens":11128,"metadata":{"userId":"secret-uid2"}}`,
			expectHasMeta:  false,
			expectMaxToken: 11128,
		},
		{
			name:          "sole_metadata_becomes_empty",
			in:            `{"metadata":{"user_id":"only"}}`,
			expectHasMeta: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rc, _, cleanup, err := rewriteLargePayload(strings.NewReader(tc.in), true)
			if err != nil {
				t.Fatalf("rewriteLargePayload error: %v", err)
			}
			defer cleanup()
			raw, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("read rewritten payload: %v", err)
			}
			out := string(raw)
			if strings.Contains(out, "secret-uid") || strings.Contains(out, `"user_id"`) || strings.Contains(out, `"userId"`) {
				t.Fatalf("leaked metadata user_id/userId in output: %s", out)
			}
			var obj map[string]any
			if err := json.Unmarshal(raw, &obj); err != nil {
				t.Fatalf("output is not valid JSON: %v\nraw=%s", err, out)
			}
			meta, hasMeta := obj["metadata"].(map[string]any)
			if hasMeta != tc.expectHasMeta {
				t.Fatalf("hasMeta=%v want %v (raw=%s)", hasMeta, tc.expectHasMeta, out)
			}
			if tc.expectHasMeta && meta["trace"] != tc.expectKeepVal {
				t.Fatalf("metadata.trace=%v want %q", meta["trace"], tc.expectKeepVal)
			}
			if tc.expectMaxToken > 0 {
				if got, ok := obj["max_tokens"].(float64); !ok || int(got) != tc.expectMaxToken {
					t.Fatalf("max_tokens=%v want %d (raw=%s)", obj["max_tokens"], tc.expectMaxToken, out)
				}
			}
		})
	}
}
