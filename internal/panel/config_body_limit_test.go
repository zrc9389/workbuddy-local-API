package panel

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSaveConfigRejectsOversizedBodyAndKeepsNormalPath(t *testing.T) {
	var saved []byte
	calls := 0
	p := New(Config{SaveConfig: func(raw []byte) ([]string, error) { calls++; saved = raw; return nil, nil }})

	w := httptest.NewRecorder()
	p.saveConfig(w, httptest.NewRequest("POST", "/", strings.NewReader("{}")))
	if w.Code != 200 || calls != 1 || string(saved) != "{}" {
		t.Fatalf("normal save: code=%d calls=%d body=%q", w.Code, calls, saved)
	}

	calls = 0
	oversized := strings.Repeat(" ", maxConfigBodyBytes+1)
	w = httptest.NewRecorder()
	p.saveConfig(w, httptest.NewRequest("POST", "/", strings.NewReader(oversized)))
	if w.Code != 413 {
		t.Fatalf("oversized body must be rejected with 413, got %d: %s", w.Code, w.Body.String())
	}
	if calls != 0 {
		t.Fatal("oversized body must never reach SaveConfig")
	}
	if !strings.Contains(w.Body.String(), "exceeds") {
		t.Fatalf("explicit size error expected, got %s", w.Body.String())
	}
}
