package reqlog

import (
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
)

func TestDeleteAccountArchiveExactReferenceAndLegacyPreservation(t *testing.T) {
	dir := t.TempDir()
	r := New(Config{Dir: dir, Enabled: true, RetentionDays: 1})
	r.Record(Event{Time: time.Now(), RequestID: "new-a", Account: "A(uid8)", AccountRef: telemetry.AccountReference("uid-a"), Status: 500, Outcome: OutcomeHTTPError})
	r.Record(Event{Time: time.Now(), RequestID: "new-b", Account: "B(uid8)", AccountRef: telemetry.AccountReference("uid-b"), Status: 500, Outcome: OutcomeHTTPError})
	r.Close()
	r = New(Config{Dir: dir, Enabled: true, RetentionDays: 1})
	if err := r.DeleteAccount("uid-a"); err != nil {
		t.Fatal(err)
	}
	r.Close()
	r = New(Config{Dir: dir, Enabled: true, RetentionDays: 1})
	rows, err := r.ReadArchive(100, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.AccountRef == telemetry.AccountReference("uid-a") {
			t.Fatalf("deleted row remains: %+v", row)
		}
	}
	if len(rows) != 1 || rows[0].AccountRef != telemetry.AccountReference("uid-b") {
		t.Fatalf("unexpected archive after deletion: %+v", rows)
	}
	r.Record(Event{Time: time.Now(), RequestID: "legacy", Account: "A(uid8)", Status: 500, Outcome: OutcomeHTTPError})
	r.Close()
	r = New(Config{Dir: dir, Enabled: true, RetentionDays: 1})
	if err := r.DeleteAccount("uid-a"); err != nil {
		t.Fatal(err)
	}
	r.Close()
	r = New(Config{Dir: dir, Enabled: true, RetentionDays: 1})
	defer r.Close()
	rows, err = r.ReadArchive(100, Filter{})
	if err != nil || len(rows) != 2 {
		t.Fatalf("legacy and B must remain: %+v %v", rows, err)
	}
}
