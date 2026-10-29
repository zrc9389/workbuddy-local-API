package panel

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestQuarantineSchedulerExpiresAtDeadline(t *testing.T) {
	dir := t.TempDir()
	expiry := time.Now().Add(1200 * time.Millisecond)
	path := filepath.Join(dir, "account.json.deleted-"+expiry.Add(-7*24*time.Hour).UTC().Format("20060102T150405.000000000Z"))
	if err := os.WriteFile(path, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	p := New(Config{CredentialQuarantineDir: dir})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p.RunCredentialQuarantine(ctx)
	time.Sleep(500 * time.Millisecond)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("removed early: %v", err)
	}
	limit := time.Now().Add(4 * time.Second)
	for time.Now().Before(limit) {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("expired credential remains")
}
