// DeleteAccountBinding releases a removed account's listener and selection group.
// It refuses a config reload while leased/active traffic exists rather than
// silently interrupting a different account's stream.
package metacore

import "context"

func (m *Manager) DeleteAccountBinding(ctx context.Context, uid string) error {
	if !safeID(uid) {
		return ErrInvalid
	}
	if e := m.lock(); e != nil {
		return e
	}
	defer m.unlock()
	old := m.snapshot()
	next := m.snapshot()
	next.Bindings = nil
	found := false
	for _, b := range old.Bindings {
		if b.UID == uid {
			found = true
			continue
		}
		next.Bindings = append(next.Bindings, b)
	}
	if !found {
		return nil
	}
	m.mu.Lock()
	busy := m.leases > 0 || m.job.Running
	m.mu.Unlock()
	if busy {
		return ErrBusy
	}
	if !m.core.Alive() {
		if e := m.persist(next); e != nil {
			return e
		}
		m.mu.Lock()
		m.state = next
		m.mu.Unlock()
		return nil
	}
	return m.apply(ctx, old, next)
}
