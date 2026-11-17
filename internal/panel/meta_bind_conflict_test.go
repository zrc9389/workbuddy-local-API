package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
)

func TestMetaBindConflict409AndForceOverride(t *testing.T) {
	p := ioTestPanel(t)
	m, err := metacore.New(metacore.Options{Dir: t.TempDir(), Demo: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	p.cfg.Meta = m

	dir := t.TempDir()
	a1 := &auth.Auth{UID: "acct-a", FilePath: filepath.Join(dir, "a.json")}
	a2 := &auth.Auth{UID: "acct-b", FilePath: filepath.Join(dir, "b.json")}
	p.cfg.Pool.Add(a1)
	p.cfg.Pool.Add(a2)

	nodes := m.Nodes().Nodes
	if len(nodes) == 0 {
		t.Fatal("no demo nodes")
	}
	nodeID := nodes[0].ID

	// 1. acct-a binds to nodeID -> 200 OK
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"node":"`+nodeID+`"}`))
	r.SetPathValue("uid", a1.UID)
	p.MetaBind(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("acct-a bind status=%d body=%s", w.Code, w.Body.String())
	}

	// 2. acct-a rebinds itself to nodeID -> 200 OK (no self-conflict)
	w = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"node":"`+nodeID+`"}`))
	r.SetPathValue("uid", a1.UID)
	p.MetaBind(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("acct-a self-rebind status=%d body=%s", w.Code, w.Body.String())
	}

	// 3. acct-b tries to bind nodeID without force -> 409 Conflict with structured JSON
	w = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"node":"`+nodeID+`"}`))
	r.SetPathValue("uid", a2.UID)
	p.MetaBind(w, r)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 conflict, got status=%d body=%s", w.Code, w.Body.String())
	}
	var conflictBody struct {
		Error        string   `json:"error"`
		Code         string   `json:"code"`
		Node         string   `json:"node"`
		ConflictUIDs []string `json:"conflict_uids"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &conflictBody); err != nil {
		t.Fatalf("invalid conflict JSON: %v (%s)", err, w.Body.String())
	}
	if conflictBody.Code != "node_already_bound" {
		t.Fatalf("code=%q want node_already_bound", conflictBody.Code)
	}
	if conflictBody.Node != nodeID {
		t.Fatalf("node=%q want %q", conflictBody.Node, nodeID)
	}
	if conflictBody.Error == "" {
		t.Fatal("missing error message")
	}
	if !reflect.DeepEqual(conflictBody.ConflictUIDs, []string{"acct-a"}) {
		t.Fatalf("conflict_uids=%v want [acct-a]", conflictBody.ConflictUIDs)
	}

	// 4. acct-b retries with force=true -> 200 OK
	w = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"node":"`+nodeID+`","force":true}`))
	r.SetPathValue("uid", a2.UID)
	p.MetaBind(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on force bind, got status=%d body=%s", w.Code, w.Body.String())
	}
	if len(m.Nodes().Bindings) != 2 {
		t.Fatalf("expected 2 bindings after force bind, got %d", len(m.Nodes().Bindings))
	}
}
