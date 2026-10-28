package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/reqlog"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
	"github.com/linguo2625469/workbuddy2api-panel/internal/usage"
)

func TestAccountDeletionRemovesDurableStoresAndJournal(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	a := &auth.Auth{UID: "u1", Nickname: "A", AccessToken: "access", RefreshToken: "refresh", FilePath: authPath}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(dir, "state.json")
	pl := pool.New(state)
	pl.Add(a)
	usageRec := usage.New(filepath.Join(dir, "usage.json"))
	usageRec.Add(time.Now(), "cn", "u1", "m", usage.Delta{TotalTokens: 1, HasTotal: true}, true)
	logRec := reqlog.New(reqlog.Config{Dir: filepath.Join(dir, "logs"), Enabled: true, ErrorsOnly: true})
	logRec.Record(reqlog.Event{Account: "A(uid8)", AccountRef: telemetry.AccountReference("u1"), Status: 500, Outcome: reqlog.OutcomeHTTPError})
	logRec.Close()
	logRec = reqlog.New(reqlog.Config{Dir: filepath.Join(dir, "logs"), Enabled: true, ErrorsOnly: true})
	j := filepath.Join(dir, "deletions.json")
	quarantine := filepath.Join(dir, ".deleted-accounts")
	p := New(Config{Pool: pl, Usage: usageRec, RequestLog: logRec, DeletionJournalPath: j, CredentialQuarantineDir: quarantine})
	r := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/panel/api/accounts/u1/remove", strings.NewReader(""))
	req.SetPathValue("uid", "u1")
	p.accountRemove(r, req)
	if r.Code/100 != 2 {
		t.Fatalf("status=%d body=%s", r.Code, r.Body.String())
	}
	if _, err := os.Stat(authPath); !os.IsNotExist(err) {
		t.Fatalf("credential remains: %v", err)
	}
	quarantined, err := os.ReadDir(quarantine)
	if err != nil || len(quarantined) != 1 || !strings.Contains(quarantined[0].Name(), ".deleted-") {
		t.Fatalf("credential was not quarantined: entries=%v err=%v", quarantined, err)
	}
	if _, ok := pl.Status("u1"); ok {
		t.Fatal("pool entry remains")
	}
	usageRaw, err := os.ReadFile(filepath.Join(dir, "usage.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(usageRaw), `"u1"`) {
		t.Fatalf("usage UID remains: %s", usageRaw)
	}
	logRec.Close()
	checkLogs := reqlog.New(reqlog.Config{Dir: filepath.Join(dir, "logs"), Enabled: true, ErrorsOnly: true})
	rows, err := checkLogs.ReadArchive(10, telemetry.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	checkLogs.Close()
	if len(rows) != 0 {
		t.Fatalf("request archive residue: %+v", rows)
	}
	if _, err := os.Stat(j); err == nil {
		var rows map[string]any
		raw, readErr := os.ReadFile(j)
		if readErr != nil {
			t.Fatal(readErr)
		}
		_ = json.Unmarshal(raw, &rows)
		if len(rows) != 0 {
			t.Fatalf("journal remains: %v", rows)
		}
	}
}

func TestAccountDeletionFailureCanRetryAfterRestart(t *testing.T) {
	dir := t.TempDir()
	journal := filepath.Join(dir, "deletions.json")
	authPath := filepath.Join(dir, "auth.json")
	pl := pool.New(filepath.Join(dir, "state.json"))
	a := &auth.Auth{UID: "u2", Nickname: "B", AccessToken: "access", RefreshToken: "refresh", FilePath: authPath}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl.Add(a)
	quarantine := filepath.Join(dir, ".deleted-accounts")
	p := New(Config{Pool: pl, DeletionJournalPath: journal, CredentialQuarantineDir: quarantine, RequestLog: failingDeleteSink{}})
	first := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/panel/api/accounts/u2/remove", nil)
	req.SetPathValue("uid", "u2")
	p.accountRemove(first, req)
	if first.Code < 500 || first.Code >= 600 {
		t.Fatalf("failure status=%d", first.Code)
	}
	if _, ok := pl.Status("u2"); !ok {
		t.Fatal("pool removed before failing log cleanup")
	}
	if _, err := os.Stat(authPath); err != nil {
		t.Fatalf("credential removed before failing log cleanup: %v", err)
	}
	coordinator, err := newDeletionCoordinator(journal)
	if err != nil {
		t.Fatal(err)
	}
	record := coordinator.pending()
	if len(record) != 1 || record[0].Phase != "request_log" {
		t.Fatalf("pending=%+v", record)
	}
	p2 := New(Config{Pool: pl, DeletionJournalPath: journal, CredentialQuarantineDir: quarantine})
	p2.ResumePendingDeletions()
	if _, ok := pl.Status("u2"); ok {
		t.Fatal("restart recovery left account in pool")
	}
	if _, err := os.Stat(authPath); !os.IsNotExist(err) {
		t.Fatalf("credential remains: %v", err)
	}
	if len(p2.deletions.pending()) != 0 {
		t.Fatalf("journal remains: %+v", p2.deletions.pending())
	}
}

func TestAccountDeletionPreservesUnresolvedSpool(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	a := &auth.Auth{UID: "u-spool", FilePath: authPath, AccessToken: "access", RefreshToken: "refresh"}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl := pool.New(filepath.Join(dir, "state.json"))
	pl.Add(a)
	q, err := spool.Open(spool.Options{Dir: filepath.Join(dir, "spool")})
	if err != nil {
		t.Fatal(err)
	}
	job, err := q.Stage(context.Background(), strings.NewReader("payload"), 1024)
	if err != nil {
		t.Fatal(err)
	}
	if err := job.Mark("dispatch_intent"); err != nil {
		t.Fatal(err)
	}
	// Simulate restart: unresolved dispatch intents are loaded as unknown.
	q, err = spool.Open(spool.Options{Dir: filepath.Join(dir, "spool")})
	if err != nil {
		t.Fatal(err)
	}
	p := New(Config{Pool: pl, Spool: q, DeletionJournalPath: filepath.Join(dir, "deletions.json"), CredentialQuarantineDir: filepath.Join(dir, "deleted")})
	r := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/panel/api/accounts/u-spool/remove", nil)
	req.SetPathValue("uid", "u-spool")
	p.accountRemove(r, req)
	if r.Code != 200 {
		t.Fatalf("status=%d body=%s", r.Code, r.Body.String())
	}
	if q.Stats().Unknown != 1 {
		t.Fatal("unowned spool was removed")
	}
	if _, ok := pl.Status("u-spool"); ok {
		t.Fatal("account remains")
	}
	if len(p.deletions.pending()) != 0 {
		t.Fatal("journal remains")
	}
}

func TestCredentialQuarantinePrunesOnlyAfterSevenDays(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	old := filepath.Join(dir, "old.json.deleted-20261020T115959.000000000Z")
	newer := filepath.Join(dir, "new.json.deleted-20261020T120001.000000000Z")
	unrecognized := filepath.Join(dir, "unrecognized.json")
	for _, path := range []string{old, newer, unrecognized} {
		if err := os.WriteFile(path, []byte("credential"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	p := New(Config{CredentialQuarantineDir: dir})
	if err := p.PruneCredentialQuarantine(now); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("expired credential remains: %v", err)
	}
	for _, path := range []string{newer, unrecognized} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("credential removed too early: %s: %v", path, err)
		}
	}
}

func TestAccountDeletionPreservesUnattributableLegacyArchive(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	a := &auth.Auth{UID: "u3", Nickname: "C", AccessToken: "access", RefreshToken: "refresh", FilePath: authPath}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl := pool.New(filepath.Join(dir, "state.json"))
	pl.Add(a)
	archiveDir := filepath.Join(dir, "logs")
	legacy := reqlog.New(reqlog.Config{Dir: archiveDir, Enabled: true, ErrorsOnly: true})
	legacy.Record(reqlog.Event{Account: "Other(uid8)", Status: 500, Outcome: reqlog.OutcomeHTTPError})
	legacy.Close()
	recorder := reqlog.New(reqlog.Config{Dir: archiveDir, Enabled: true, ErrorsOnly: true})
	p := New(Config{Pool: pl, RequestLog: recorder, DeletionJournalPath: filepath.Join(dir, "deletions.json"), CredentialQuarantineDir: filepath.Join(dir, "deleted")})
	r := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/panel/api/accounts/u3/remove", nil)
	req.SetPathValue("uid", "u3")
	p.accountRemove(r, req)
	if r.Code != 200 {
		t.Fatalf("status=%d body=%s", r.Code, r.Body.String())
	}
	rows, err := recorder.ReadArchive(10, telemetry.Filter{})
	if err != nil || len(rows) != 1 || rows[0].Account != "Other(uid8)" {
		t.Fatalf("legacy archive=%+v err=%v", rows, err)
	}
	if len(p.deletions.pending()) != 0 {
		t.Fatal("journal remains")
	}
	recorder.Close()
}

type failingDeleteSink struct{ telemetry.Sink }

func (failingDeleteSink) Begin()                       {}
func (failingDeleteSink) Record(telemetry.Event)       {}
func (failingDeleteSink) Snapshot() telemetry.Snapshot { return telemetry.Snapshot{} }
func (failingDeleteSink) ReadArchive(int, telemetry.Filter) ([]telemetry.Event, error) {
	return nil, nil
}
func (failingDeleteSink) Close()                     {}
func (failingDeleteSink) DeleteAccount(string) error { return os.ErrPermission }

// Concurrent requests must not start a second deletion using stale account data.
func TestConcurrentAccountDeletionDoesNotRestartCompletedDeletion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "auth.json")
	a := &auth.Auth{UID: "concurrent", FilePath: path, AccessToken: "secret-token"}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl := pool.New(filepath.Join(dir, "state.json"))
	pl.Add(a)
	sink := &countingDeleteSink{}
	p := New(Config{Pool: pl, RequestLog: sink, DeletionJournalPath: filepath.Join(dir, "journal.json"), CredentialQuarantineDir: filepath.Join(dir, "deleted")})
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/", nil)
			r.SetPathValue("uid", "concurrent")
			p.accountRemove(w, r)
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)
	success, missing := 0, 0
	for code := range codes {
		if code == 200 {
			success++
		}
		if code == 404 {
			missing++
		}
	}
	if success != 1 || missing != 1 {
		t.Fatalf("success=%d missing=%d", success, missing)
	}
	if sink.calls.Load() != 1 {
		t.Fatalf("cleanup executed %d times", sink.calls.Load())
	}
	if len(p.deletions.pending()) != 0 {
		t.Fatal("unexpected pending deletion")
	}
	entries, err := os.ReadDir(filepath.Join(dir, "deleted"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("quarantine=%v error=%v", entries, err)
	}
}

func TestAccountDeletionDoesNotExposeStageError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "auth.json")
	a := &auth.Auth{UID: "redact", FilePath: path, AccessToken: "secret-token"}
	if err := a.SaveAtomic(); err != nil {
		t.Fatal(err)
	}
	pl := pool.New(filepath.Join(dir, "state.json"))
	pl.Add(a)
	journal := filepath.Join(dir, "journal.json")
	p := New(Config{Pool: pl, DeletionJournalPath: journal, RequestLog: secretDeleteSink{}})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.SetPathValue("uid", "redact")
	p.accountRemove(w, r)
	raw, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	if w.Code < 500 || strings.Contains(w.Body.String(), "secret-token") || strings.Contains(string(raw), "secret-token") {
		t.Fatalf("status=%d response=%s journal=%s", w.Code, w.Body.String(), raw)
	}
}

type secretDeleteSink struct{ failingDeleteSink }

func (secretDeleteSink) DeleteAccount(string) error { return fmt.Errorf("secret-token") }

type countingDeleteSink struct {
	failingDeleteSink
	calls atomic.Int32
}

func (s *countingDeleteSink) DeleteAccount(string) error { s.calls.Add(1); return nil }
