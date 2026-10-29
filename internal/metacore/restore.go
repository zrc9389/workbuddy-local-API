package metacore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// RestoreAccountBinding adds a missing subscription and binding without
// changing existing subscriptions or bindings. saveProxy must atomically save
// a new credential or leave no credential on error.
func (m *Manager) RestoreAccountBinding(ctx context.Context, uid, rawURL, nodeName string, saveProxy func(string) error) error {
	if m == nil || !safeID(uid) || rawURL == "" || nodeName == "" || saveProxy == nil || m.opts.Demo {
		return ErrInvalid
	}
	if _, err := subscriptionURL(rawURL); err != nil {
		return ErrInvalid
	}
	if err := m.lock(); err != nil {
		return err
	}
	defer m.unlock()
	old := m.snapshot()
	for _, b := range old.Bindings {
		if b.UID == uid {
			return errors.New("account already has a Meta binding")
		}
	}
	id := "sub-" + shortHash(rawURL)
	exists := false
	for _, p := range old.Providers {
		if p.ID == id {
			if p.URL != rawURL || !effectiveProviderEnabled(p) {
				return errors.New("existing subscription cannot be reused")
			}
			exists = true
		}
	}
	added := false
	createdFile := ""
	if !exists {
		if !m.core.Available() {
			return ErrUnavailable
		}
		fetch := m.fetchURL
		if fetch == nil {
			fetch = fetchSubscription
		}
		data, err := fetch(ctx, rawURL)
		if err != nil {
			return errors.New("subscription download failed")
		}
		file := "providers/" + id + "-" + shortHash(string(data)) + ".txt"
		path := filepath.Join(m.opts.Dir, filepath.FromSlash(file))
		if _, err = os.Lstat(path); os.IsNotExist(err) {
			createdFile = file
		} else if err != nil {
			return ErrApply
		}
		now := time.Now().UTC()
		_, err = m.importLocked(ctx, id, data, provider{ID: id, Name: "订阅 " + shortHash(rawURL)[:8], URL: rawURL, Enabled: true, CreatedAt: now})
		if err != nil {
			if createdFile != "" && !errors.Is(err, ErrRollback) {
				m.removeProviderFile(createdFile, id)
			}
			return err
		}
		added = true
	}
	rollback := func() error {
		if !added {
			return nil
		}
		if err := m.rollback(old); err != nil {
			return err
		}
		if createdFile != "" {
			m.removeProviderFile(createdFile, id)
		}
		return nil
	}
	if err := m.ensure(ctx); err != nil {
		if e := rollback(); e != nil {
			return e
		}
		return err
	}
	m.mu.Lock()
	var matches []string
	for _, n := range m.nodes {
		if n.Provider == id && n.Name == nodeName {
			matches = append(matches, n.ID)
		}
	}
	m.mu.Unlock()
	if len(matches) != 1 {
		if err := rollback(); err != nil {
			return err
		}
		return errors.New("subscription node not found or ambiguous")
	}
	for _, b := range old.Bindings {
		if b.Node == matches[0] {
			if err := rollback(); err != nil {
				return err
			}
			return errors.New("subscription node already bound")
		}
	}
	if _, err := m.bindLocked(ctx, uid, matches[0], saveProxy); err != nil {
		if errors.Is(err, ErrRollback) {
			return err
		}
		if e := rollback(); e != nil {
			return e
		}
		return err
	}
	return nil
}
