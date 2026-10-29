package metacore

import (
	"context"
	"sync"
	"time"
)

// Ensure serializes startup with config mutations rather than returning ErrBusy.
// Call before admitting traffic after restart, and at the shared account request
// boundary to recover from an unexpected managed-kernel exit. Never clear the
// persisted account proxy on failure.
func (m *Manager) Ensure(ctx context.Context) error {
	if m == nil {
		return ErrUnavailable
	}
	select {
	case m.op <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer m.unlock()
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return ErrUnavailable
	}
	return m.ensure(ctx)
}

// EnsureAccount is a no-op for accounts not bound by this manager. All account
// HTTP operations (chat, refresh, credit, tasks) should call this same hook.
func (m *Manager) EnsureAccount(ctx context.Context, uid string) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	bound := false
	for _, b := range m.state.Bindings {
		if b.UID == uid {
			bound = true
			break
		}
	}
	m.mu.Unlock()
	if !bound {
		return nil
	}
	return m.Ensure(ctx)
}

// AcquireAccount is the demand-lifecycle contract. The caller MUST hold release
// until response Body.Close (or RoundTrip error), not merely until headers arrive.
// Operation serialization makes idle-stop and configuration changes atomic with
// admission of new account requests. Release is safe to call more than once.
func (m *Manager) AcquireAccount(ctx context.Context, uid string) (func(), error) {
	noop := func() {}
	if m == nil {
		return noop, nil
	}
	select {
	case m.op <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer m.unlock()
	m.mu.Lock()
	bound := false
	for _, b := range m.state.Bindings {
		if b.UID == uid {
			if m.state.PendingDelete == b.Provider {
				m.mu.Unlock()
				return nil, ErrBusy
			}
			bound = true
			break
		}
	}
	closed := m.closed
	m.mu.Unlock()
	if !bound {
		return noop, nil
	}
	if closed {
		return nil, ErrUnavailable
	}
	if err := m.ensure(ctx); err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.leases++
	m.lastUse = time.Now()
	m.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { m.mu.Lock(); m.leases--; m.lastUse = time.Now(); m.mu.Unlock() }) }, nil
}
