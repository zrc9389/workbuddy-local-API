package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnknownLengthCannotExceedWorkingBudget(t *testing.T) {
	for _, path := range []string{"/v1/chat/completions", "/v1/responses"} {
		t.Run(path, func(t *testing.T) {
			h := NewHandler(Config{MaxWorkingBytes: 1 << 20})
			req := httptest.NewRequest(http.MethodPost, path, io.NopCloser(strings.NewReader(strings.Repeat("x", (1<<18)+1))))
			req.ContentLength = -1
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != 413 || !strings.Contains(rec.Body.String(), "working_budget_exceeded") {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}
