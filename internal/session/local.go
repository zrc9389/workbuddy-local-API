package session

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

const maxBindingFileBytes int64 = 64 << 20

type localBinding struct {
	UID    string    `json:"uid"`
	Active time.Time `json:"active"`
}

func (r *Router) trimLocked() {
	for len(r.entries) > r.cfg.MaxEntries {
		key := ""
		var oldest time.Time
		for k, v := range r.entries {
			if key == "" || v.lastActive.Before(oldest) {
				key = k
				oldest = v.lastActive
			}
		}
		delete(r.entries, key)
		r.cfg.Store.DelBind(key)
	}
}
func (r *Router) LoadLocal() error {
	if r.cfg.LocalPath == "" {
		return nil
	}
	f, e := os.Open(r.cfg.LocalPath)
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	if e != nil {
		return e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return e
	}
	if st.Size() > maxBindingFileBytes {
		return errors.New("binding file exceeds safety limit")
	}
	var rows map[string]localBinding
	if e = json.NewDecoder(io.LimitReader(f, maxBindingFileBytes+1)).Decode(&rows); e != nil {
		return e
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for k, v := range rows {
		if len(k) > 2048 || k == "" || v.UID == "" || len(v.UID) > 128 || now.Sub(v.Active) >= r.cfg.TTL {
			continue
		}
		r.entries[k] = entry{uid: v.UID, lastActive: v.Active}
	}
	r.trimLocked()
	return nil
}
func (r *Router) FlushLocal() error {
	if r.cfg.LocalPath == "" {
		return nil
	}
	r.diskMu.Lock()
	defer r.diskMu.Unlock()
	r.mu.RLock()
	rows := map[string]localBinding{}
	now := time.Now()
	for k, v := range r.entries {
		if !expired(v, now, r.cfg.TTL) {
			rows[k] = localBinding{v.uid, v.lastActive}
		}
	}
	r.mu.RUnlock()
	if e := os.MkdirAll(filepath.Dir(r.cfg.LocalPath), 0700); e != nil {
		return e
	}
	b, e := json.Marshal(rows)
	if e != nil {
		return e
	}
	if int64(len(b)) > maxBindingFileBytes {
		return errors.New("bindings exceed persistence byte budget")
	}
	if e = os.WriteFile(r.cfg.LocalPath+".tmp", b, 0600); e != nil {
		return e
	}
	return os.Rename(r.cfg.LocalPath+".tmp", r.cfg.LocalPath)
}
