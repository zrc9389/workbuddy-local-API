package panel

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCustomizationRestoresFromRawConfigOnRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"panel":{"customization":{"activeMusicId":"m-42","randomMusic":true,"musicList":[{"id":"m-42","url":"data:audio/mpeg;base64,YQ=="}]}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	p := New(Config{ConfigPath: path})
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest("GET", "/panel/api/customization", nil))
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	c, ok := got["customization"].(map[string]any)
	if !ok || c["activeMusicId"] != "m-42" || c["randomMusic"] != true {
		t.Fatalf("customization was not restored: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "data:audio/mpeg") {
		t.Fatalf("music missing: %s", rec.Body.String())
	}
}
