package panel

import (
	"encoding/json"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSubscriptionRefreshPreferencePersistenceAndFailure(t *testing.T) {
	hours := 48
	fail := false
	p := New(Config{Pool: pool.New(""), LoadConfig: func() (any, error) {
		return map[string]any{"panel": map[string]any{"subscription_refresh_hours": hours}}, nil
	}, SaveConfig: func(raw []byte) ([]string, error) {
		if fail {
			return nil, errors.New("write failed")
		}
		var v struct {
			Panel struct {
				Hours int `json:"subscription_refresh_hours"`
			} `json:"panel"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		hours = v.Panel.Hours
		return nil, nil
	}})
	call := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		p.preferencesSet(w, httptest.NewRequest("POST", "/", strings.NewReader(body)))
		return w
	}
	w := call(`{"subscription_refresh_hours":12}`)
	if w.Code != 200 || hours != 12 || !strings.Contains(w.Body.String(), `"subscription_refresh_hours":12`) {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, body := range []string{`{"subscription_refresh_hours":0}`, `{"subscription_refresh_hours":8761}`, `{"subscription_refresh_hours":1.5}`} {
		if w = call(body); w.Code != 400 || hours != 12 {
			t.Fatal(body, w.Code, hours)
		}
	}
	fail = true
	w = call(`{"subscription_refresh_hours":24}`)
	if w.Code != 500 || hours != 12 {
		t.Fatal("failed write changed settings", w.Code, hours)
	}
}
