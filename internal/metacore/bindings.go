package metacore

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"
)

func (m *Manager) selectBindings(ctx context.Context, s diskState) error {
	for _, b := range s.Bindings {
		if err := m.selectOne(ctx, b); err != nil {
			return err
		}
	}
	return nil
}
func (m *Manager) selectOne(ctx context.Context, b bindingRecord) error {
	return m.core.Request(ctx, "PUT", "/proxies/"+url.PathEscape(b.RouteID), map[string]string{"name": b.Name}, nil)
}
func (m *Manager) switchBinding(ctx context.Context, old, next diskState, b bindingRecord, saveProxy func(string) error) (Binding, error) {
	previous := bindingRecord{}
	for _, v := range old.Bindings {
		if v.UID == b.UID {
			previous = v
			break
		}
	}
	rollback := func() error {
		c, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := m.selectOne(c, previous); err != nil {
			_ = m.core.Stop()
			return ErrRollback
		}
		if err := m.persist(old); err != nil {
			_ = m.core.Stop()
			return ErrRollback
		}
		m.mu.Lock()
		m.state = old
		m.mu.Unlock()
		return nil
	}
	if err := m.selectOne(ctx, b); err != nil {
		if e := rollback(); e != nil {
			return Binding{}, e
		}
		return Binding{}, ErrApply
	}
	if err := m.verifyBindings(ctx, next); err != nil {
		if e := rollback(); e != nil {
			return Binding{}, e
		}
		return Binding{}, ErrApply
	}
	if err := m.persist(next); err != nil {
		if e := rollback(); e != nil {
			return Binding{}, e
		}
		return Binding{}, ErrApply
	}
	proxy := url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", b.Port), User: url.UserPassword("workbuddy", b.Password)}
	if err := saveProxy(proxy.String()); err != nil {
		if e := rollback(); e != nil {
			return Binding{}, e
		}
		return Binding{}, errors.New("account proxy persistence failed; route rolled back")
	}
	m.mu.Lock()
	m.state = next
	m.lastUse = time.Now()
	m.mu.Unlock()
	return b.Binding, nil
}
