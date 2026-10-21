package modelpolicy

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Rule struct {
	Disabled      bool `json:"disabled"`
	ContextLength int  `json:"context_length,omitempty"`
}
type Store struct {
	mu    sync.RWMutex
	path  string
	rules map[string]Rule
}

func Open(path string) (*Store, error) {
	s := &Store{path: path, rules: map[string]Rule{}}
	if path != "" {
		b, e := os.ReadFile(path)
		if e == nil {
			e = json.Unmarshal(b, &s.rules)
			if s.rules == nil {
				s.rules = map[string]Rule{}
			}
		}
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
	}
	return s, nil
}
func (s *Store) Set(id string, r Rule) error {
	id = canonical(id)
	if id == "" || len(id) > 200 || strings.ContainsAny(id, "\r\n\x00") || r.ContextLength < 0 || r.ContextLength > 10000000 {
		return errors.New("invalid model policy")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	old, exists := s.rules[id]
	s.rules[id] = r
	if s.path == "" {
		return nil
	}
	b, e := json.Marshal(s.rules)
	if e == nil {
		e = os.MkdirAll(filepath.Dir(s.path), 0700)
	}
	if e == nil {
		e = os.WriteFile(s.path+".tmp", b, 0600)
	}
	if e == nil {
		e = os.Rename(s.path+".tmp", s.path)
	}
	if e != nil {
		if exists {
			s.rules[id] = old
		} else {
			delete(s.rules, id)
		}
	}
	return e
}
func (s *Store) Disabled(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.rules[canonical(id)].Disabled
}
func (s *Store) Snapshot() map[string]Rule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := map[string]Rule{}
	for k, v := range s.rules {
		r[k] = v
	}
	return r
}
func (s *Store) Apply(in []map[string]any) []map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []map[string]any{}
	for _, m := range in {
		id, _ := m["id"].(string)
		r := s.rules[canonical(id)]
		if r.Disabled {
			continue
		}
		c := map[string]any{}
		for k, v := range m {
			c[k] = v
		}
		if r.ContextLength > 0 {
			c["context_length"] = r.ContextLength
		}
		out = append(out, c)
	}
	return out
}

// Bare and cn: names route to the same pool and must share policy.
func canonical(id string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(id)), "cn:")
}
