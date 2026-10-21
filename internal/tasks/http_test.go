package tasks

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPCompatibility(t *testing.T) {
	s := serviceFixture(t, 1, func(r *http.Request) (*http.Response, error) {
		return taskResponse(`{"code":0,"data":{"tasks":[]}}`), nil
	})
	for _, tc := range []struct {
		name, method, body, uid string
		handler                 http.HandlerFunc
		status                  int
	}{
		{"tasks", "GET", "", "u", s.AccountTasks, 200},
		{"missing", "GET", "", "missing", s.AccountTasks, 404},
		{"accept validation", "POST", "{}", "u", s.AccountTaskAccept, 400},
		{"claim validation", "POST", "{}", "u", s.AccountTaskClaim, 400},
		{"unknown action", "POST", `{"task_code":"not-automated"}`, "u", s.AccountTaskAuto, 501},
		{"scan", "POST", "", "", s.TasksScanAll, 200},
		{"queue empty", "POST", `{"concurrency":4,"growth":true}`, "", s.TasksRunQueue, 200},
		{"queue status", "GET", "", "", s.TasksQueueStatus, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "/", strings.NewReader(tc.body))
			r.SetPathValue("uid", tc.uid)
			w := httptest.NewRecorder()
			tc.handler(w, r)
			if w.Code != tc.status {
				t.Fatal(w.Code, w.Body.String())
			}
			var result map[string]any
			if json.Unmarshal(w.Body.Bytes(), &result) != nil {
				t.Fatal("invalid JSON")
			}
			if tc.name == "queue status" {
				for _, k := range []string{"running", "total", "conc", "started", "started_at", "seq", "items"} {
					if _, ok := result[k]; !ok {
						t.Fatal("missing field", k)
					}
				}
			}
		})
	}
}
func TestStandaloneUnavailableHTTP(t *testing.T) {
	s := New(Config{})
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)
	r.SetPathValue("uid", "u")
	s.AccountTasks(w, r)
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
