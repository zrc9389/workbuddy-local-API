package panel

import (
	"context"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/reqlog"
	"github.com/linguo2625469/workbuddy2api-panel/internal/session"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/tasks"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func deletionRequest(p *Panel, uid string, retry bool) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.SetPathValue("uid", uid)
	if retry {
		p.accountDeletionRetry(w, r)
	} else {
		p.accountRemove(w, r)
	}
	return w
}
func TestDeletionDiskFailuresAndRetry(t *testing.T) {
	for _, failure := range []string{"usage", "credential", "journal"} {
		t.Run(failure, func(t *testing.T) {
			dir := t.TempDir()
			credential := filepath.Join(dir, "auth.json")
			a := &auth.Auth{UID: "u", FilePath: credential, AccessToken: "secret"}
			if err := a.SaveAtomic(); err != nil {
				t.Fatal(err)
			}
			pl := pool.New(filepath.Join(dir, "pool.json"))
			pl.Add(a)
			ud := filepath.Join(dir, "usage-dir")
			jd := filepath.Join(dir, "journal-dir")
			quarantine := filepath.Join(dir, "deleted")
			os.Mkdir(ud, 0700)
			os.Mkdir(jd, 0700)
			u := usage.New(filepath.Join(ud, "usage.json"))
			u.Add(time.Now(), "cn", "u", "m", usage.Delta{TotalTokens: 1, HasTotal: true}, true)
			if err := u.Save(); err != nil {
				t.Fatal(err)
			}
			switch failure {
			case "usage":
				os.Mkdir(filepath.Join(ud, "usage.json.delete.tmp"), 0700)
			case "credential":
				os.WriteFile(quarantine, []byte("block"), 0600)
			case "journal":
				os.Remove(jd)
				os.WriteFile(jd, []byte("block"), 0600)
			}
			p := New(Config{Pool: pl, Usage: u, DeletionJournalPath: filepath.Join(jd, "journal.json"), CredentialQuarantineDir: quarantine})
			w := deletionRequest(p, "u", false)
			if w.Code < 500 {
				t.Fatalf("failure %d %s", w.Code, w.Body.String())
			}
			if _, ok := pl.Status("u"); !ok {
				t.Fatal("pool removed")
			}
			if _, err := os.Stat(credential); err != nil {
				t.Fatal(err)
			}
			if failure == "usage" {
				raw, err := os.ReadFile(filepath.Join(ud, "usage.json"))
				if err != nil || !strings.Contains(string(raw), "\"u\"") {
					t.Fatalf("usage lost after failed deletion: %s %v", raw, err)
				}
			}
			if failure != "journal" {
				rows := p.deletions.pending()
				if len(rows) != 1 || rows[0].Phase != failure {
					t.Fatalf("pending=%+v", rows)
				}
			}
			switch failure {
			case "usage":
				os.Remove(filepath.Join(ud, "usage.json.delete.tmp"))
			case "credential":
				os.Remove(quarantine)
			case "journal":
				os.Remove(jd)
				os.Mkdir(jd, 0700)
			}
			w = deletionRequest(p, "u", failure != "journal")
			if w.Code != 200 {
				t.Fatalf("retry %d %s", w.Code, w.Body.String())
			}
			if _, ok := pl.Status("u"); ok {
				t.Fatal("pool remains")
			}
			if _, err := os.Stat(credential); !os.IsNotExist(err) {
				t.Fatalf("credential remains %v", err)
			}
			raw, err := os.ReadFile(filepath.Join(ud, "usage.json"))
			if err != nil || strings.Contains(string(raw), "\"u\"") {
				t.Fatalf("usage=%s %v", raw, err)
			}
			raw, err = os.ReadFile(filepath.Join(jd, "journal.json"))
			if err != nil || strings.TrimSpace(string(raw)) != "{}" {
				t.Fatalf("journal=%s %v", raw, err)
			}
		})
	}
}
func TestAccountDeletionIsolatesStores(t *testing.T) {
	dir := t.TempDir()
	pl := pool.New(filepath.Join(dir, "pool.json"))
	for _, id := range []string{"account-a", "account-b"} {
		a := &auth.Auth{UID: id, FilePath: filepath.Join(dir, id+".json"), AccessToken: "secret-" + id}
		if err := a.SaveAtomic(); err != nil {
			t.Fatal(err)
		}
		pl.Add(a)
	}
	u := usage.New(filepath.Join(dir, "usage.json"))
	for _, id := range []string{"account-a", "account-b"} {
		u.Add(time.Now(), "cn", id, "m", usage.Delta{TotalTokens: 1, HasTotal: true}, true)
	}
	ld := filepath.Join(dir, "logs")
	logs := reqlog.New(reqlog.Config{Dir: ld, Enabled: true, ErrorsOnly: true})
	for _, id := range []string{"account-a", "account-b"} {
		logs.Record(reqlog.Event{AccountRef: telemetry.AccountReference(id), RequestID: id, Status: 500, Outcome: reqlog.OutcomeHTTPError})
	}
	logs.Close()
	logs = reqlog.New(reqlog.Config{Dir: ld, Enabled: true, ErrorsOnly: true})
	defer logs.Close()
	meta, err := metacore.New(metacore.Options{Demo: true, Dir: filepath.Join(dir, "meta")})
	if err != nil {
		t.Fatal(err)
	}
	defer meta.Close(context.Background())
	nodes := meta.Nodes().Nodes
	for _, id := range []string{"account-a", "account-b"} {
		if _, err := meta.Bind(context.Background(), id, nodes[0].ID, func(string) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	ses := session.New(session.Config{LocalPath: filepath.Join(dir, "session.json"), TTL: time.Hour, Available: func() []string { return []string{"account-a", "account-b"} }})
	ses.Bind("session-a", "account-a")
	ses.Bind("session-b", "account-b")
	q, err := spool.Open(spool.Options{Dir: filepath.Join(dir, "spool")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.Stage(context.Background(), strings.NewReader("unowned-b"), 1024); err != nil {
		t.Fatal(err)
	}
	task := tasks.New(tasks.Config{})
	p := New(Config{Pool: pl, Usage: u, RequestLog: logs, Meta: meta, SessionCleanup: ses.DeleteAccount, Tasks: task, Spool: q, DeletionJournalPath: filepath.Join(dir, "journal.json"), CredentialQuarantineDir: filepath.Join(dir, "deleted")})
	w := deletionRequest(p, "account-a", false)
	if w.Code != 200 {
		t.Fatalf("delete=%d %s", w.Code, w.Body.String())
	}
	if _, ok := pl.Status("account-a"); ok {
		t.Fatal("A remains")
	}
	if _, ok := pl.Status("account-b"); !ok {
		t.Fatal("B missing")
	}
	if meta.IsBound("account-a") || !meta.IsBound("account-b") {
		t.Fatal("meta bindings incorrect")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "usage.json"))
	if err != nil || strings.Contains(string(raw), "account-a") || !strings.Contains(string(raw), "account-b") {
		t.Fatalf("usage=%s %v", raw, err)
	}
	rows, err := logs.ReadArchive(10, telemetry.Filter{})
	if err != nil || len(rows) != 1 || rows[0].AccountRef != telemetry.AccountReference("account-b") {
		t.Fatalf("logs=%+v %v", rows, err)
	}
	raw, err = os.ReadFile(filepath.Join(dir, "session.json"))
	if err != nil || strings.Contains(string(raw), "account-a") || !strings.Contains(string(raw), "account-b") {
		t.Fatalf("session=%s %v", raw, err)
	}
	if q.Stats().Jobs != 1 {
		t.Fatal("spool removed")
	}
	files, err := os.ReadDir(filepath.Join(dir, "spool"))
	if err != nil {
		t.Fatal(err)
	}
	foundBody := false
	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".body") {
			body, err := os.ReadFile(filepath.Join(dir, "spool", file.Name()))
			if err != nil || string(body) != "unowned-b" {
				t.Fatalf("spool body=%q %v", body, err)
			}
			foundBody = true
		}
	}
	if !foundBody {
		t.Fatal("spool body missing")
	}

	if _, err = os.Stat(filepath.Join(dir, "account-a.json")); !os.IsNotExist(err) {
		t.Fatalf("A credential %v", err)
	}
	if _, err = os.Stat(filepath.Join(dir, "account-b.json")); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join(dir, "journal.json"))
	if err != nil || strings.TrimSpace(string(raw)) != "{}" {
		t.Fatalf("journal=%s %v", raw, err)
	}
	if w = deletionRequest(p, "account-a", false); w.Code != 404 {
		t.Fatalf("repeat=%d", w.Code)
	}
	if _, ok := pl.Status("account-b"); !ok {
		t.Fatal("repeat damaged B")
	}
}
