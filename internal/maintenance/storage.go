package maintenance

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

const retention = 24 * time.Hour

// SetStorage restores only a completed, unexpired result. Running batches are
// never replayed after a crash. The caller owns periodic Prune scheduling.
func (s *Service) SetStorage(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.storagePath = path
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(data) > 8<<20 {
		return errors.New("maintenance snapshot too large")
	}
	var state Status
	if err = json.Unmarshal(data, &state); err != nil {
		return err
	}
	started, err := time.Parse(time.RFC3339, state.LastRunAt)
	if err != nil || !time.Now().Before(started.Add(retention)) {
		return os.Remove(path)
	}
	if state.Running || len(state.Steps) != 4 {
		return errors.New("invalid maintenance snapshot")
	}
	s.state = state
	return nil
}

func (s *Service) saveLocked() error {
	if s.storagePath == "" || s.state.Running || s.state.LastFinishedAt == "" {
		return nil
	}
	data, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(s.storagePath), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.storagePath), ".maintenance-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if e := tmp.Close(); err == nil {
		err = e
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.storagePath)
}

// DeleteAccount removes account details from the current result and prevents
// an in-flight batch from reintroducing that account after deletion.
func (s *Service) DeleteAccount(uid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deleted == nil {
		s.deleted = make(map[string]bool)
	}
	s.deleted[uid] = true
	for i := range s.state.Steps {
		step := &s.state.Steps[i]
		kept := step.Accounts[:0]
		for _, a := range step.Accounts {
			if a.UID != uid {
				kept = append(kept, a)
				continue
			}
			if a.State == "done" && step.Completed > 0 {
				step.Completed--
			}
			if a.State == "failed" && step.Failed > 0 {
				step.Failed--
			}
			if step.Total > 0 {
				step.Total--
			}
		}
		step.Accounts = kept
	}
	s.state.LastFailed = 0
	for _, st := range s.state.Steps {
		s.state.LastFailed += st.Failed
	}
	if s.state.Running && s.storagePath != "" {
		if err := os.Remove(s.storagePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	return s.saveLocked()
}

func (s *Service) Prune(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Running || s.state.LastFinishedAt == "" {
		return nil
	}
	started, err := time.Parse(time.RFC3339, s.state.LastRunAt)
	if err != nil {
		return err
	}
	if now.Before(started.Add(retention)) {
		return nil
	}
	if s.storagePath != "" {
		if err := os.Remove(s.storagePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	s.state = Status{Steps: []Step{{Name: "token", State: "pending"}, {Name: "checkin", State: "pending"}, {Name: "activity", State: "pending"}, {Name: "travel", State: "pending"}}}
	return nil
}
