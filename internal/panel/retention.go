package panel

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RetentionWindow is the single retention policy used by panel-facing stores.
// A fixed 24 hour default prevents memory TTLs from being mistaken for durable
// retention. Callers may use PruneJSONFile for usage/history archives.
const RetentionWindow = 24 * time.Hour

type RetentionManager struct {
	mu     sync.Mutex
	window time.Duration
}

// Run starts the in-process rolling cleanup loop. The first cleanup is a
// startup compensation; failed cleanup is retried on the next tick.
func (m *RetentionManager) Run(ctx context.Context, interval time.Duration, cleanup func(time.Time) error) {
	if m == nil || cleanup == nil {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	go func() {
		if err := cleanup(time.Now()); err != nil {
			log.Printf("retention startup cleanup failed: %v", err)
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// A slow previous cleanup may leave an old tick queued.
				if err := cleanup(time.Now()); err != nil {
					log.Printf("retention cleanup failed: %v", err)
				}
			}
		}
	}()
}

func NewRetentionManager() *RetentionManager { return &RetentionManager{window: RetentionWindow} }

func (m *RetentionManager) Window() time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.window <= 0 {
		return RetentionWindow
	}
	return m.window
}

func (m *RetentionManager) SetWindow(window time.Duration) {
	if window <= 0 {
		window = RetentionWindow
	}
	m.mu.Lock()
	m.window = window
	m.mu.Unlock()
}

// PruneJSONFile removes records older than the retention cutoff. It accepts an
// array of objects containing a unix/RFC3339 timestamp under common keys and
// atomically replaces the file. Unknown records are retained for safety.
func (m *RetentionManager) PruneJSONFile(path string, now time.Time) (int, error) {
	if path == "" {
		return 0, errors.New("empty retention path")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	var records []map[string]any
	if len(raw) == 0 {
		return 0, nil
	}
	if err := json.Unmarshal(raw, &records); err != nil {
		return 0, err
	}
	cutoff := now.Add(-m.Window())
	kept := make([]map[string]any, 0, len(records))
	removed := 0
	for _, record := range records {
		ts, ok := recordTimestamp(record)
		if ok && ts.Before(cutoff) {
			removed++
			continue
		}
		kept = append(kept, record)
	}
	if removed == 0 {
		return 0, nil
	}
	encoded, err := json.MarshalIndent(kept, "", "  ")
	if err != nil {
		return 0, err
	}
	tmp := path + ".retention.tmp"
	if err := os.WriteFile(tmp, encoded, 0600); err != nil {
		return 0, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return 0, err
	}
	return removed, nil
}

func recordTimestamp(record map[string]any) (time.Time, bool) {
	for _, key := range []string{"ts", "timestamp", "created_at", "createdAt", "time"} {
		v, ok := record[key]
		if !ok {
			continue
		}
		switch x := v.(type) {
		case float64:
			if x > 1e12 {
				return time.UnixMilli(int64(x)), true
			}
			if x > 0 {
				return time.Unix(int64(x), 0), true
			}
		case string:
			if t, err := time.Parse(time.RFC3339, x); err == nil {
				return t, true
			}
		}
	}
	return time.Time{}, false
}

// PruneDirectory removes stale regular files under dir. Symlinks and nested
// directories are skipped to avoid deleting data outside the configured root.
func (m *RetentionManager) PruneDirectory(dir string, now time.Time) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	removed := 0
	cutoff := now.Add(-m.Window())
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return removed, err
		}
		if info.Mode()&os.ModeSymlink != 0 || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}
