package panel

import (
	"encoding/json"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGlobalRefreshReportsUsageSaveFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	if err := os.WriteFile(path, []byte("{invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	p := New(Config{Usage: usage.New(path)})
	w := httptest.NewRecorder()
	p.globalRefresh(w, httptest.NewRequest("POST", "/", nil))
	var body struct {
		Components map[string]struct {
			OK bool `json:"ok"`
		} `json:"components"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Components["usage"].OK {
		t.Fatal("failed usage save reported success")
	}
	if got, _ := os.ReadFile(path); string(got) != "{invalid" {
		t.Fatal("original file changed")
	}
}
