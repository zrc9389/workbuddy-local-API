package metacore

import (
	"context"
	"sync"
	"testing"
	"time"
)

func setSubDueForRefresh(t *testing.T, m *Manager, id, raw string) {
	t.Helper()
	if err := m.lock(); err != nil {
		t.Fatal(err)
	}
	defer m.unlock()
	next := m.snapshot()
	for i := range next.Providers {
		if next.Providers[i].ID == id {
			next.Providers[i].URL = raw
			next.Providers[i].LastRefreshAt = time.Now().Add(-48 * time.Hour)
		}
	}
	if err := m.persist(next); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.state = next
	m.mu.Unlock()
}

func TestMultipleSubscriptionsNoTrampleByTests(t *testing.T) {
	m, _ := seededSubscriptions(t, 2)
	setSubDueForRefresh(t, m, "sub-a", "https://example.invalid/a")
	setSubDueForRefresh(t, m, "sub-b", "https://example.invalid/b")

	var mu sync.Mutex
	refreshed := make(map[string]int)

	m.setFetcher(func(ctx context.Context, u string) ([]byte, error) {
		mu.Lock()
		refreshed[u]++
		mu.Unlock()
		return []byte("fixture-content-" + u), nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	m.StartSubscriptionRefresh(ctx, 24*time.Hour)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		countA := refreshed["https://example.invalid/a"]
		countB := refreshed["https://example.invalid/b"]
		mu.Unlock()
		if countA > 0 && countB > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if refreshed["https://example.invalid/a"] == 0 {
		t.Fatal("sub-a was not refreshed")
	}
	if refreshed["https://example.invalid/b"] == 0 {
		t.Fatal("sub-b was not refreshed (likely trampled by tests or ErrBusy)")
	}

	for _, sub := range m.Subscriptions() {
		if sub.LastRefreshAt.IsZero() || time.Since(sub.LastRefreshAt) > time.Minute {
			t.Fatalf("subscription %s LastRefreshAt was not updated: %v", sub.ID, sub.LastRefreshAt)
		}
	}
}

func TestSubscriptionRefreshErrBusyShortRetry(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	withStoredURL(t, m, "sub-a", "https://example.invalid/fixture-busy")

	refreshed := make(chan struct{}, 5)
	m.setFetcher(func(ctx context.Context, u string) ([]byte, error) {
		select {
		case refreshed <- struct{}{}:
		default:
		}
		return []byte("fixture-busy-ok"), nil
	})

	if err := m.lock(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	m.StartSubscriptionRefresh(ctx, 48*time.Hour)
	time.Sleep(100 * time.Millisecond)

	select {
	case <-refreshed:
		t.Fatal("refreshed while lock was held")
	default:
	}

	m.unlock()

	m.SetSubscriptionRefreshInterval(time.Nanosecond)

	select {
	case <-refreshed:
	case <-time.After(3 * time.Second):
		t.Fatal("subscription was not refreshed after lock release and wake; likely locked into hard cooldown")
	}
}
