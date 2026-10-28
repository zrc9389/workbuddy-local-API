// Package spool stores pressure-queued request bytes durably before dispatch.
// Recovery never replays uncertain upstream calls. It is not an exactly-once queue.
package spool

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Options struct {
	Dir      string
	MaxBytes int64
	MaxJobs  int
}
type Stats struct {
	Bytes    int64 `json:"bytes"`
	Jobs     int   `json:"jobs"`
	Unknown  int   `json:"unknown"`
	Queued   int   `json:"queued"`
	MaxBytes int64 `json:"max_bytes"`
	MaxJobs  int   `json:"max_jobs"`
}
type receipt struct {
	ID      string    `json:"id"`
	State   string    `json:"state"`
	Size    int64     `json:"size"`
	SHA256  string    `json:"sha256"`
	Created time.Time `json:"created"`
}
type Store struct {
	mu    sync.Mutex
	opts  Options
	bytes int64
	jobs  map[string]*Job
}
type Job struct {
	s        *Store
	r        receipt
	reserved int64
}

func Open(o Options) (*Store, error) {
	if o.MaxBytes <= 0 {
		o.MaxBytes = 1 << 30
	}
	if o.MaxJobs <= 0 {
		o.MaxJobs = 32
	}
	if o.Dir == "" {
		return nil, errors.New("spool directory required")
	}
	root, e := filepath.Abs(o.Dir)
	if e != nil {
		return nil, e
	}
	o.Dir = root
	if e = os.MkdirAll(root, 0700); e != nil {
		return nil, e
	}
	s := &Store{opts: o, jobs: map[string]*Job{}}
	rows, e := os.ReadDir(root)
	if e != nil {
		return nil, e
	}
	for _, f := range rows {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		raw, e := os.ReadFile(filepath.Join(root, f.Name()))
		if e != nil {
			return nil, e
		}
		var r receipt
		if json.Unmarshal(raw, &r) != nil || len(r.ID) != 32 || strings.Trim(r.ID, "0123456789abcdef") != "" {
			return nil, errors.New("invalid spool receipt")
		}
		if r.State == "committed" || r.State == "cancelled" {
			continue
		}
		st, e := os.Stat(filepath.Join(root, r.ID+".body"))
		if errors.Is(e, os.ErrNotExist) && r.State == "receiving" {
			continue
		}
		if e != nil {
			return nil, e
		}
		r.State = "unknown"
		j := &Job{s: s, r: r, reserved: st.Size()}
		s.jobs[r.ID] = j
		s.bytes += st.Size()
		if len(s.jobs) > o.MaxJobs || s.bytes > o.MaxBytes {
			return nil, errors.New("unresolved spool exceeds capacity")
		}
	}
	return s, nil
}
func (s *Store) Stage(ctx context.Context, src io.Reader, max int64) (*Job, error) {
	if max < 1 {
		return nil, errors.New("invalid request limit")
	}
	s.mu.Lock()
	if len(s.jobs) >= s.opts.MaxJobs || s.bytes+max > s.opts.MaxBytes {
		s.mu.Unlock()
		return nil, errors.New("disk queue capacity reached")
	}
	idBytes := make([]byte, 16)
	if _, e := rand.Read(idBytes); e != nil {
		s.mu.Unlock()
		return nil, e
	}
	j := &Job{s: s, r: receipt{ID: hex.EncodeToString(idBytes), State: "receiving", Created: time.Now()}, reserved: max}
	s.jobs[j.r.ID] = j
	s.bytes += max
	s.mu.Unlock()
	if e := j.Mark("receiving"); e != nil {
		j.abort()
		return nil, e
	}
	f, e := os.OpenFile(j.path(), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		j.abort()
		return nil, e
	}
	h := sha256.New()
	buf := make([]byte, 64<<10)
	var n int64
	for {
		if e = ctx.Err(); e != nil {
			break
		}
		var got int
		got, e = src.Read(buf)
		if got > 0 {
			n += int64(got)
			if n > max {
				e = errors.New("request exceeds spill limit")
				break
			}
			if _, we := f.Write(buf[:got]); we != nil {
				e = we
				break
			}
			h.Write(buf[:got])
		}
		if e == io.EOF {
			e = nil
			break
		}
		if e != nil {
			break
		}
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		_ = os.Remove(j.path())
		j.abort()
		return nil, e
	}
	s.mu.Lock()
	s.bytes -= j.reserved - n
	j.reserved = n
	j.r.Size = n
	j.r.SHA256 = hex.EncodeToString(h.Sum(nil))
	s.mu.Unlock()
	if e = j.Mark("queued"); e != nil {
		_ = os.Remove(j.path())
		j.abort()
		return nil, e
	}
	return j, nil
}

// CapacityRemaining returns the currently unreserved disk queue capacity. It
// is used when the caller has no request-size limit, while the spool itself
// remains bounded by its configured disk quota.
func (s *Store) CapacityRemaining() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opts.MaxBytes - s.bytes
}
func (j *Job) path() string { return filepath.Join(j.s.opts.Dir, j.r.ID+".body") }
func (j *Job) abort() {
	_ = os.Remove(filepath.Join(j.s.opts.Dir, j.r.ID+".json"))
	j.s.mu.Lock()
	defer j.s.mu.Unlock()
	delete(j.s.jobs, j.r.ID)
	j.s.bytes -= j.reserved
}
func (j *Job) Open() (io.ReadCloser, error) {
	f, e := os.Open(j.path())
	if e != nil {
		return nil, e
	}
	h := sha256.New()
	n, e := io.Copy(h, f)
	if e != nil || n != j.r.Size || hex.EncodeToString(h.Sum(nil)) != j.r.SHA256 {
		f.Close()
		return nil, errors.New("spool integrity failure")
	}
	_, e = f.Seek(0, 0)
	if e != nil {
		f.Close()
		return nil, e
	}
	return f, nil
}
func (j *Job) Mark(state string) error {
	j.s.mu.Lock()
	defer j.s.mu.Unlock()
	old := j.r.State
	j.r.State = state
	b, _ := json.Marshal(j.r)
	path := filepath.Join(j.s.opts.Dir, j.r.ID+".json")
	f, e := os.OpenFile(path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		j.r.State = old
		return e
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e == nil {
		e = os.Rename(path+".tmp", path)
	}
	if e != nil {
		j.r.State = old
	}
	return e
}
func (j *Job) Complete(state string) error {
	j.s.mu.Lock()
	_, active := j.s.jobs[j.r.ID]
	terminal := j.r.State == "committed" || j.r.State == "cancelled"
	j.s.mu.Unlock()
	if !active || (terminal && state == "unknown") {
		return nil
	}
	if state != "committed" && state != "cancelled" && state != "unknown" {
		return fmt.Errorf("invalid terminal state")
	}
	if e := j.Mark(state); e != nil {
		return e
	}
	if state == "unknown" {
		return nil
	}
	if e := os.Remove(j.path()); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if e := os.Remove(filepath.Join(j.s.opts.Dir, j.r.ID+".json")); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	j.abort()
	return nil
}

// Size returns the verified staged body size after Stage has completed.
func (j *Job) Size() int64 {
	j.s.mu.Lock()
	defer j.s.mu.Unlock()
	return j.r.Size
}

func (j *Job) ID() string { return j.r.ID }
func (s *Store) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := Stats{Bytes: s.bytes, Jobs: len(s.jobs), MaxBytes: s.opts.MaxBytes, MaxJobs: s.opts.MaxJobs}
	for _, j := range s.jobs {
		if j.r.State == "unknown" {
			r.Unknown++
		}
		if j.r.State == "queued" {
			r.Queued++
		}
	}
	return r
}
