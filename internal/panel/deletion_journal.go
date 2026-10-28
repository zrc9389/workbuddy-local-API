package panel

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// deletionJournal stores unfinished account removals so startup can resume them.
// It contains only account UIDs, credential paths, phase names, and diagnostics.
type deletionJournal struct {
	mu      sync.Mutex
	path    string
	entries map[string]deletionRecord
}

type deletionRecord struct {
	UID        string    `json:"uid"`
	Credential string    `json:"credential_path,omitempty"`
	Phase      string    `json:"phase"`
	Error      string    `json:"error,omitempty"`
	Attempts   int       `json:"attempts"`
	StartedAt  time.Time `json:"started_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type deletionStage struct {
	Name string
	Run  func() error
}

// deletionCoordinator executes idempotent stages while journaling the current
// stage before and after each operation. A failed stage remains in the journal
// and can be retried after a restart.
type deletionCoordinator struct {
	journal *deletionJournal
	locksMu sync.Mutex
	locks   map[string]*sync.Mutex
}

func newDeletionCoordinator(path string) (*deletionCoordinator, error) {
	j, err := openDeletionJournal(path)
	if err != nil {
		return nil, err
	}
	return &deletionCoordinator{journal: j, locks: make(map[string]*sync.Mutex)}, nil
}

func (c *deletionCoordinator) lockFor(uid string) func() {
	c.locksMu.Lock()
	lock := c.locks[uid]
	if lock == nil {
		lock = &sync.Mutex{}
		c.locks[uid] = lock
	}
	c.locksMu.Unlock()
	lock.Lock()
	return lock.Unlock
}

func (c *deletionCoordinator) pending() []deletionRecord {
	if c == nil {
		return nil
	}
	return c.journal.pending()
}

func (c *deletionCoordinator) execute(uid, credential string, stages []deletionStage) (deletionRecord, error) {
	if c == nil || c.journal == nil {
		return deletionRecord{}, errors.New("deletion coordinator unavailable")
	}
	if uid == "" || len(uid) > 256 {
		return deletionRecord{}, errors.New("invalid account UID")
	}
	if len(stages) == 0 || stages[0].Name == "" {
		return deletionRecord{}, errors.New("deletion stages are not configured")
	}
	unlock := c.lockFor(uid)
	defer unlock()
	return c.executeLocked(uid, credential, stages)
}

// executeLocked requires the caller to hold the UID lock across lookup and execution.
func (c *deletionCoordinator) executeLocked(uid, credential string, stages []deletionStage) (deletionRecord, error) {
	if c == nil || c.journal == nil || uid == "" || len(uid) > 256 || len(stages) == 0 || stages[0].Name == "" {
		return deletionRecord{}, errors.New("invalid account deletion request")
	}
	record, exists := c.journal.get(uid)
	if !exists {
		record = deletionRecord{UID: uid, Credential: credential, Phase: stages[0].Name}
	} else if record.Credential == "" {
		record.Credential = credential
	}
	record.Attempts++
	if err := c.journal.put(record); err != nil {
		return record, err
	}
	start := 0
	if record.Phase != "" {
		found := false
		for i := range stages {
			if stages[i].Name == record.Phase {
				start = i
				found = true
				break
			}
		}
		if !found {
			return record, errors.New("unknown account deletion phase in journal")
		}
	}
	for i := start; i < len(stages); i++ {
		record.Phase = stages[i].Name
		record.Error = ""
		if err := c.journal.put(record); err != nil {
			return record, err
		}
		if stages[i].Run != nil {
			if err := stages[i].Run(); err != nil {
				record.Error = "stage failed"
				_ = c.journal.put(record)
				return record, err
			}
		}
		if i+1 < len(stages) {
			record.Phase = stages[i+1].Name
			if err := c.journal.put(record); err != nil {
				return record, err
			}
		}
	}
	if err := c.journal.remove(uid); err != nil {
		return record, err
	}
	return record, nil
}

func openDeletionJournal(path string) (*deletionJournal, error) {
	j := &deletionJournal{path: path, entries: map[string]deletionRecord{}}
	if path == "" {
		return j, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return j, nil
	}
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("deletion journal exceeds safety limit")
	}
	if err := json.Unmarshal(raw, &j.entries); err != nil {
		return nil, err
	}
	if j.entries == nil {
		j.entries = map[string]deletionRecord{}
	}
	for uid, record := range j.entries {
		if uid == "" || record.UID != uid || record.Phase == "" {
			return nil, errors.New("invalid deletion journal record")
		}
	}
	return j, nil
}

func (j *deletionJournal) put(record deletionRecord) error {
	if j == nil {
		return errors.New("deletion journal unavailable")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if record.UID == "" {
		return errors.New("empty account UID")
	}
	if record.StartedAt.IsZero() {
		if old, ok := j.entries[record.UID]; ok {
			record.StartedAt = old.StartedAt
		} else {
			record.StartedAt = time.Now().UTC()
		}
	}
	record.UpdatedAt = time.Now().UTC()
	old, existed := j.entries[record.UID]
	j.entries[record.UID] = record
	if err := j.saveLocked(); err != nil {
		if existed {
			j.entries[record.UID] = old
		} else {
			delete(j.entries, record.UID)
		}
		return err
	}
	return nil
}

func (j *deletionJournal) get(uid string) (deletionRecord, bool) {
	if j == nil {
		return deletionRecord{}, false
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	record, ok := j.entries[uid]
	return record, ok
}

func (j *deletionJournal) pending() []deletionRecord {
	if j == nil {
		return nil
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	out := make([]deletionRecord, 0, len(j.entries))
	for _, record := range j.entries {
		out = append(out, record)
	}
	return out
}

func (j *deletionJournal) remove(uid string) error {
	if j == nil {
		return errors.New("deletion journal unavailable")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	old, existed := j.entries[uid]
	delete(j.entries, uid)
	if err := j.saveLocked(); err != nil {
		if existed {
			j.entries[uid] = old
		}
		return err
	}
	return nil
}

func (j *deletionJournal) saveLocked() error {
	if j.path == "" {
		return errors.New("deletion journal path is not configured")
	}
	if err := os.MkdirAll(filepath.Dir(j.path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(j.entries, "", "  ")
	if err != nil {
		return err
	}
	tmp := j.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, j.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
