package server

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesStableDerivedConversation(t *testing.T) {
	history := []map[string]any{{"role": "user", "content": "initial question"}, {"role": "assistant", "content": "answer"}}
	var keys []string
	for _, prev := range []string{"resp_a", "resp_b"} {
		body, _, _, _, err := buildChatRequestFromResponses(map[string]any{"model": "m", "input": "next", "metadata": map[string]any{}, "previous_response_id": prev}, history)
		if err != nil {
			t.Fatal(err)
		}
		keys = append(keys, session.ExtractKey(body))
	}
	if keys[0] == "" || keys[0] != keys[1] {
		t.Fatal(keys)
	}
}
func TestLogCapabilitiesAndDisabledEndpoints(t *testing.T) {
	h := NewHandler(Config{})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/capabilities", nil))
	var v map[string]any
	json.Unmarshal(w.Body.Bytes(), &v)
	if v["logs"] != false {
		t.Fatal(v)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/request_logs", nil))
	if w.Code != 404 || !strings.Contains(w.Body.String(), "feature_disabled") {
		t.Fatal(w.Code, w.Body.String())
	}
}
