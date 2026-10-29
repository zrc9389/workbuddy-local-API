package metacore

import (
	"context"
	"testing"
	"time"
)

func TestRefreshIntervalChangeWakesScheduler(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	withStoredURL(t, m, "sub-a", "https://example.invalid/fixture")
	called := make(chan struct{}, 1)
	m.setFetcher(func(context.Context, string) ([]byte, error) {
		select {
		case called <- struct{}{}:
		default:
		}
		return []byte("fixture-sub-a"), nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.StartSubscriptionRefresh(ctx, 24*time.Hour)
	select {
	case <-called:
		t.Fatal("fresh subscription refreshed prematurely")
	case <-time.After(100 * time.Millisecond):
	}
	m.SetSubscriptionRefreshInterval(time.Nanosecond)
	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("interval update did not wake scheduler")
	}
}
