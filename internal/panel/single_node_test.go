package panel

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetaSingleNodePayload(t *testing.T) {
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close(context.Background()) })
	p := ioTestPanel(t)
	p.cfg.Meta = m
	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("missing fixture nodes")
	}
	for _, body := range []string{"{\"node\":\"\"}", "{\"node\":null}", "{\"node\":\"missing\"}", "{\"cancel\":true,\"node\":\"x\"}"} {
		w := httptest.NewRecorder()
		p.MetaTests(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	p.MetaTests(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{\"node\":\""+nodes[0].ID+"\"}")))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "\"total\":1") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
