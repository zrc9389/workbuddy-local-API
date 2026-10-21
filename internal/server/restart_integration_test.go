package server

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/conversation"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestResponsesRestartHistoryWorksWithoutLogging(t *testing.T) {
	dir := t.TempDir()
	o := conversation.Options{Path: filepath.Join(dir, "history.json")}
	history, _ := conversation.Open(o)
	var lengths []int
	up := &upstream.Client{HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		msgs, _ := body["messages"].([]any)
		lengths = append(lengths, len(msgs))
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(sseOK))}, nil
	})}, ChatBaseCN: "https://fake.example"}
	rec := usage.New(filepath.Join(dir, "usage.json"))
	rec.Start()
	defer rec.Stop()
	newHandler := func(s *conversation.Store) *Handler {
		return NewHandler(Config{Pool: testPoolWith(&auth.Auth{UID: "fixture", AccessToken: "fixture", ExpiresAt: 9999999999}), Upstream: up, History: s, Usage: rec, RequestLog: telemetry.Noop{}})
	}
	h := newHandler(history)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/responses", strings.NewReader(`{"model":"glm-test","input":"first"}`)))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var first map[string]any
	json.Unmarshal(w.Body.Bytes(), &first)
	history2, e := conversation.Open(o)
	if e != nil {
		t.Fatal(e)
	}
	h = newHandler(history2)
	raw, _ := json.Marshal(map[string]any{"model": "glm-test", "previous_response_id": first["id"], "input": "second"})
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/responses", strings.NewReader(string(raw))))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(lengths) != 2 || lengths[1] <= lengths[0] {
		t.Fatal("history not restored", lengths)
	}
	rec.Save()
	if snapshot := rec.Snapshot(24, nil); len(snapshot.ByAccount) == 0 {
		t.Fatal("usage disappeared when logging off")
	}
}
