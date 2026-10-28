package tasks

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

func TestDeletionCancelsQueuedItemsWithoutInterruptingActiveAccount(t *testing.T) {
	oldActions, oldGap, oldPoll := autoActions, reportGap, claimPollGap
	defer func() { autoActions, reportGap, claimPollGap = oldActions, oldGap, oldPoll }()
	reportGap, claimPollGap = 0, 0
	started, release := make(chan struct{}), make(chan struct{})
	var deletedRuns, otherRuns atomic.Int32
	autoActions = []autoAction{{TaskCode: "test-task", run: func(service *Service, account *auth.Auth) (string, error) {
		if account.UID == "u" {
			deletedRuns.Add(1)
			close(started)
			<-release
		} else {
			otherRuns.Add(1)
		}
		return "done", nil
	}}}
	service := serviceFixture(t, 2, func(request *http.Request) (*http.Response, error) {
		return taskResponse(`{"code":0,"data":{"tasks":[{"task_code":"test-task","target":2,"current":0,"accept_status":"accepted"}]}}`), nil
	})
	// Publish explicit items to make account order deterministic.
	accountA, accountB := service.cfg.Pool.AuthByUID("u"), service.cfg.Pool.AuthByUID("uu")
	items := []QueueItem{{UID: "u", Kind: "growth", Code: "test-task", Status: "pending"}, {UID: "u", Kind: "growth", Code: "test-task", Status: "pending"}, {UID: "uu", Kind: "growth", Code: "test-task", Status: "pending"}}
	queue := service.queue()
	queue.mu.Lock()
	queue.running = true
	queue.items = items
	queue.mu.Unlock()
	done := make(chan struct{})
	go func() { service.runQueueItems([]queueAccount{{a: accountA}, {a: accountB}}, items, 1); close(done) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first item did not start")
	}
	if err := service.BeginAccountDeletion("u"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := service.WaitAccountIdle(ctx, "u"); err == nil {
		t.Fatal("deletion did not wait for active action")
	}
	if service.TryLockAccount("u") {
		t.Fatal("fenced account admitted")
	}
	close(release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("queue did not finish")
	}
	if err := service.WaitAccountIdle(context.Background(), "u"); err != nil {
		t.Fatal(err)
	}
	snapshot := service.QueueStatus()
	if deletedRuns.Load() != 1 || otherRuns.Load() != 1 || snapshot.Items[1].Status != "cancelled" || snapshot.Items[2].Status != "done" {
		t.Fatalf("unexpected results runs=%d/%d items=%+v", deletedRuns.Load(), otherRuns.Load(), snapshot.Items)
	}
}

func TestDeletionWaitsForScanAndRejectsStaleGeneration(t *testing.T) {
	service := New(Config{})
	generation, ok := service.beginScan("a")
	if !ok {
		t.Fatal("scan admission failed")
	}
	if err := service.BeginAccountDeletion("a"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := service.WaitAccountIdle(ctx, "a"); err == nil {
		t.Fatal("scan not tracked")
	}
	if _, ok := service.beginScan("a"); ok {
		t.Fatal("fenced scan admitted")
	}
	if _, ok := service.beginScan("b"); !ok {
		t.Fatal("other account blocked")
	}
	service.endScan("b")
	service.endScan("a")
	if err := service.WaitAccountIdle(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	service.EndAccountDeletion("a")
	if service.scanValid("a", generation) || service.tryLockQueuedAccount("a", generation) {
		t.Fatal("stale queue admitted after deletion")
	}
}
