// Package conversation separates immutable disk records from a bounded hot cache.
package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/jsonscan"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const maxPersistedBytes int64 = 260 << 20
const maxArchiveBytes int64 = 4 << 30
const maxArchiveRecords = 100000

type Options struct {
	Path       string
	MaxEntries int
	MaxBytes   int64
	TTL        time.Duration
}
type entry struct {
	Value   json.RawMessage `json:"value"`
	Expires time.Time       `json:"expires"`
	Used    uint64          `json:"used"`
}
type diskEntry struct {
	ID    string          `json:"id"`
	Hash  string          `json:"hash"`
	Value json.RawMessage `json:"value"`
}
type manifest struct {
	Version    int    `json:"version"`
	Generation string `json:"generation"`
}
type Stats struct {
	Entries         int   `json:"entries"`
	Bytes           int64 `json:"bytes"`
	MaxEntries      int   `json:"max_entries"`
	MaxBytes        int64 `json:"max_bytes"`
	Persistent      bool  `json:"persistent"`
	TTLSeconds      int64 `json:"ttl_seconds"`
	ArchivedEntries int   `json:"archived_entries"`
	ArchivedBytes   int64 `json:"archived_bytes"`
}
type diskVolatileEntry struct {
	path    string
	expires time.Time
	used    uint64
	size    int64
}

type Store struct {
	volatileDisk   map[string]diskVolatileEntry
	volatileDir    string
	volatileBytes  int64
	mu             sync.Mutex
	opts           Options
	items          map[string]entry
	bytes          int64
	clock          uint64
	generation     string
	diskBytes      int64
	diskCount      int
	totalDiskBytes int64
	totalDiskCount int
}

func Open(o Options) (*Store, error) {
	if o.MaxEntries <= 0 {
		o.MaxEntries = 128
	}
	if o.MaxBytes <= 0 {
		o.MaxBytes = 32 << 20
	}
	if o.TTL <= 0 {
		o.TTL = 24 * time.Hour
	}
	s := &Store{opts: o, items: map[string]entry{}}
	if o.Path == "" {
		return s, nil
	}
	s.generation = "initial"
	f, e := os.Open(o.Path)
	if e == nil {
		st, err := f.Stat()
		if err != nil {
			f.Close()
			return nil, err
		}
		if st.Size() > maxPersistedBytes {
			f.Close()
			return nil, errors.New("history file safety limit")
		}
		var probe map[string]json.RawMessage
		dec := json.NewDecoder(io.LimitReader(f, maxPersistedBytes+1))
		err = dec.Decode(&probe)
		if err == nil && dec.Decode(new(any)) != io.EOF {
			err = errors.New("history must contain one JSON object")
		}
		f.Close()
		if err != nil {
			return nil, err
		}
		if _, ok := probe["version"]; ok {
			var m manifest
			b, _ := json.Marshal(probe)
			if json.Unmarshal(b, &m) != nil || m.Version != 2 || !validGeneration(m.Generation) {
				return nil, errors.New("invalid archive manifest")
			}
			s.generation = m.Generation
		} else {
			for id, b := range probe {
				if !validID(id) {
					return nil, errors.New("invalid saved ID")
				}
				var v entry
				if json.Unmarshal(b, &v) != nil || !json.Valid(v.Value) {
					return nil, errors.New("invalid legacy history")
				}
				if e = s.archive(id, v.Value); e != nil {
					return nil, e
				}
			}
			if e = s.saveManifest(); e != nil {
				return nil, e
			}
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return nil, e
	} else if e = s.saveManifest(); e != nil {
		return nil, e
	}
	if e = s.scan(); e != nil {
		return nil, e
	}
	return s, nil
}
func validGeneration(g string) bool {
	if g == "" || len(g) > 80 {
		return false
	}
	for _, c := range g {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}
func validID(id string) bool { return id != "" && len(id) <= 256 }
func digest(b []byte) string { x := sha256.Sum256(b); return hex.EncodeToString(x[:]) }
func (s *Store) dir() string { return s.opts.Path + ".archive" }
func (s *Store) file(id string) string {
	return filepath.Join(s.dir(), s.generation+"-"+digest([]byte(id))+".json")
}
func atomicWrite(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.OpenFile(path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return e
	}
	if ce != nil {
		return ce
	}
	return os.Rename(path+".tmp", path)
}
func (s *Store) saveManifest() error {
	b, _ := json.Marshal(manifest{2, s.generation})
	return atomicWrite(s.opts.Path, b)
}
func (s *Store) scan() error {
	rows, e := os.ReadDir(s.dir())
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	if e != nil {
		return e
	}
	s.diskBytes = 0
	s.diskCount = 0
	s.totalDiskBytes = 0
	s.totalDiskCount = 0
	for _, r := range rows {
		if r.IsDir() {
			continue
		}
		st, e := r.Info()
		if e != nil {
			return e
		}
		s.totalDiskBytes += st.Size()
		s.totalDiskCount++
		if len(r.Name()) > len(s.generation) && r.Name()[:len(s.generation)+1] == s.generation+"-" && filepath.Ext(r.Name()) == ".json" {
			s.diskCount++
			s.diskBytes += st.Size()
		}
	}
	return nil
}
func (s *Store) archive(id string, value json.RawMessage) error {
	if len(value) > int(maxPersistedBytes) {
		return errors.New("history record too large")
	}
	file := s.file(id)
	var compact bytes.Buffer
	if e := json.Compact(&compact, value); e != nil {
		return e
	}
	value = compact.Bytes()
	var encoded bytes.Buffer
	enc := json.NewEncoder(&encoded)
	enc.SetEscapeHTML(false)
	if e := enc.Encode(diskEntry{id, digest(value), value}); e != nil {
		return e
	}
	b := encoded.Bytes()
	old := int64(0)
	exists := false
	if st, e := os.Stat(file); e == nil {
		old = st.Size()
		exists = true
	}
	if s.totalDiskBytes-old+int64(len(b)) > maxArchiveBytes || (!exists && s.totalDiskCount >= maxArchiveRecords) {
		return errors.New("history archive full; existing history retained")
	}
	if e := atomicWrite(file, b); e != nil {
		return e
	}
	s.diskBytes += int64(len(b)) - old
	s.totalDiskBytes += int64(len(b)) - old
	if !exists {
		s.diskCount++
		s.totalDiskCount++
	}
	return nil
}
func (s *Store) prune() {
	now := time.Now()
	for id, v := range s.volatileDisk {
		if now.After(v.expires) {
			if os.Remove(v.path) == nil || errors.Is(statErr(v.path), os.ErrNotExist) {
				s.volatileBytes -= v.size
				delete(s.volatileDisk, id)
			}
		}
	}
	for k, v := range s.items {
		if now.After(v.Expires) {
			s.bytes -= int64(len(v.Value))
			delete(s.items, k)
		}
	}
	for len(s.items) > s.opts.MaxEntries || s.bytes > s.opts.MaxBytes {
		var oldest string
		var min uint64 = ^uint64(0)
		for k, v := range s.items {
			if v.Used < min {
				oldest = k
				min = v.Used
			}
		}
		if oldest == "" {
			break
		}
		s.bytes -= int64(len(s.items[oldest].Value))
		delete(s.items, oldest)
	}
}
func (s *Store) cache(id string, value json.RawMessage) {
	if old, ok := s.items[id]; ok {
		s.bytes -= int64(len(old.Value))
		delete(s.items, id)
	}
	if int64(len(value)) <= s.opts.MaxBytes {
		s.clock++
		s.items[id] = entry{append(json.RawMessage(nil), value...), time.Now().Add(s.opts.TTL), s.clock}
		s.bytes += int64(len(value))
	}
	s.prune()
}
func (s *Store) Get(id string) (json.RawMessage, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	if v, ok := s.items[id]; ok {
		s.clock++
		v.Used = s.clock
		s.items[id] = v
		return append(json.RawMessage(nil), v.Value...), true
	}
	if s.opts.Path == "" || !validID(id) {
		return nil, false
	}
	f, e := os.Open(s.file(id))
	if e != nil {
		return nil, false
	}
	defer f.Close()
	var v diskEntry
	if json.NewDecoder(io.LimitReader(f, maxPersistedBytes+1)).Decode(&v) != nil || v.ID != id || digest(v.Value) != v.Hash {
		return nil, false
	}
	s.cache(id, v.Value)
	return v.Value, true
}
func (s *Store) Put(id string, value json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validID(id) || !json.Valid(value) {
		return errors.New("invalid conversation")
	}
	if s.opts.Path != "" {
		if e := s.archive(id, value); e != nil {
			return e
		}
	} else if int64(len(value)) > s.opts.MaxBytes {
		return errors.New("conversation exceeds volatile cache budget")
	}
	s.cache(id, value)
	return nil
}

// Clear switches the active namespace, retaining retired files for explicit offline cleanup.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.opts.Path != "" {
		old := s.generation
		s.generation = fmt.Sprintf("g-%d", time.Now().UnixNano())
		if e := s.saveManifest(); e != nil {
			s.generation = old
			return e
		}
		s.diskBytes = 0
		s.diskCount = 0
	}
	s.items = map[string]entry{}
	s.bytes = 0
	for id, v := range s.volatileDisk {
		if err := os.Remove(v.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		delete(s.volatileDisk, id)
	}
	s.volatileBytes = 0
	if s.volatileDir != "" {
		_ = os.Remove(s.volatileDir)
		s.volatileDir = ""
	}
	return nil
}
func (s *Store) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	return Stats{len(s.items), s.bytes, s.opts.MaxEntries, s.opts.MaxBytes, s.opts.Path != "", int64(s.opts.TTL.Seconds()), s.diskCount, s.diskBytes}
}

// CheckWorkingBudget checks size before decoding a persistent record into memory.
// Explicit refusal preserves the archive; callers must not silently drop prior turns.
func (s *Store) CheckWorkingBudget(id string, limit int64) error {
	if limit <= 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.items[id]; ok {
		if int64(len(v.Value)) > limit {
			return errors.New("history exceeds active request working budget")
		}
		return nil
	}
	if s.opts.Path == "" {
		return nil
	}
	st, e := os.Stat(s.file(id))
	if e != nil {
		return nil
	}
	if st.Size() > limit+(1<<20) {
		return errors.New("history exceeds active request working budget")
	}
	return nil
}

// ReclaimCache is safe under pressure only for records already in the archive.
// Volatile-only history is not discarded just to make room for new requests.
func (s *Store) ReclaimCache() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.opts.Path == "" {
		return 0
	}
	n := s.bytes
	s.items = map[string]entry{}
	s.bytes = 0
	return n
}

// PutReader stores a JSON array without retaining its contents in memory.
func (s *Store) PutReader(id string, src io.ReadSeeker) error {
	return s.PutReaderContext(context.Background(), id, src)
}

func (s *Store) PutReaderContext(ctx context.Context, id string, src io.ReadSeeker) error {
	if !validID(id) {
		return errors.New("invalid conversation")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if _, err := jsonscan.Array(src); err != nil {
		return err
	}
	size, err := src.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}
	if size > maxPersistedBytes {
		return errors.New("history record too large")
	}
	if _, err = src.Seek(0, io.SeekStart); err != nil {
		return err
	}
	hash := sha256.New()
	if _, err = io.Copy(hash, src); err != nil {
		return err
	}
	if _, err = src.Seek(0, io.SeekStart); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	var dir string
	if s.opts.Path != "" {
		dir = s.dir()
		if err = os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	} else {
		if s.volatileDir == "" {
			s.volatileDir, err = os.MkdirTemp("", "wb_history_*")
			if err != nil {
				return err
			}
			s.volatileDisk = make(map[string]diskVolatileEntry)
		}
		dir = s.volatileDir
	}
	f, err := os.CreateTemp(dir, ".history-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer func() { f.Close(); os.Remove(temp) }()
	if err = f.Chmod(0600); err != nil {
		return err
	}
	if s.opts.Path != "" {
		idJSON, _ := json.Marshal(id)
		if _, err = fmt.Fprintf(f, `{"id":%s,"hash":"%x","value":`, idJSON, hash.Sum(nil)); err != nil {
			return err
		}
	}
	if _, err = io.Copy(f, src); err != nil {
		return err
	}
	if s.opts.Path != "" {
		if _, err = io.WriteString(f, "}\n"); err != nil {
			return err
		}
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	st, err := os.Stat(temp)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if s.opts.Path != "" {
		target := s.file(id)
		old := int64(0)
		exists := false
		if stOld, e := os.Stat(target); e == nil {
			old = stOld.Size()
			exists = true
		}
		if s.totalDiskBytes-old+st.Size() > maxArchiveBytes || (!exists && s.totalDiskCount >= maxArchiveRecords) {
			return errors.New("history archive full; existing history retained")
		}
		if err = os.Rename(temp, target); err != nil {
			return err
		}
		s.diskBytes += st.Size() - old
		s.totalDiskBytes += st.Size() - old
		if !exists {
			s.diskCount++
			s.totalDiskCount++
		}
	} else {
		old, exists := s.volatileDisk[id]
		oldSize := int64(0)
		if exists {
			oldSize = old.size
		}
		if s.volatileBytes-oldSize+st.Size() > maxArchiveBytes {
			return errors.New("history archive full; existing history retained")
		}
		if !exists && len(s.volatileDisk) >= s.opts.MaxEntries {
			return errors.New("history archive entry limit reached; existing history retained")
		}
		target := filepath.Join(dir, digest([]byte(id))+".json")
		if err = os.Rename(temp, target); err != nil {
			return err
		}
		s.clock++
		s.volatileDisk[id] = diskVolatileEntry{target, time.Now().Add(s.opts.TTL), s.clock, st.Size()}
		s.volatileBytes += st.Size() - oldSize
	}
	if old, ok := s.items[id]; ok {
		s.bytes -= int64(len(old.Value))
		delete(s.items, id)
	}
	return nil
}

// OpenReader returns a verified, seekable view of the stored JSON array.
func (s *Store) OpenReader(id string) (io.ReadSeekCloser, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	if v, ok := s.items[id]; ok {
		s.clock++
		v.Used = s.clock
		s.items[id] = v
		return readSeekNopCloser{bytes.NewReader(v.Value)}, true
	}
	if !validID(id) {
		return nil, false
	}
	var path string
	if s.opts.Path != "" {
		path = s.file(id)
	} else if v, ok := s.volatileDisk[id]; ok {
		path = v.path
		s.clock++
		v.used = s.clock
		s.volatileDisk[id] = v
	} else {
		return nil, false
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	if s.opts.Path == "" {
		return f, true
	}
	st, err := f.Stat()
	if err != nil || st.Size() > maxPersistedBytes+(1<<20) {
		f.Close()
		return nil, false
	}
	fields, err := jsonscan.Object(f)
	if err != nil {
		f.Close()
		return nil, false
	}
	var idSpan, hashSpan, value jsonscan.Span
	for _, field := range fields {
		switch field.Key {
		case "id":
			idSpan = field
		case "hash":
			hashSpan = field
		case "value":
			value = field
		}
	}
	readString := func(sp jsonscan.Span) string {
		if sp.End-sp.Start > 1024 || sp.End <= sp.Start {
			return ""
		}
		b := make([]byte, sp.End-sp.Start)
		if _, e := f.ReadAt(b, sp.Start); e != nil {
			return ""
		}
		var x string
		_ = json.Unmarshal(b, &x)
		return x
	}
	if readString(idSpan) != id || value.End <= value.Start {
		f.Close()
		return nil, false
	}
	hash := sha256.New()
	if _, err = io.Copy(hash, io.NewSectionReader(f, value.Start, value.End-value.Start)); err != nil || fmt.Sprintf("%x", hash.Sum(nil)) != readString(hashSpan) {
		f.Close()
		return nil, false
	}
	return sectionReadCloser{io.NewSectionReader(f, value.Start, value.End-value.Start), f}, true
}

type readSeekNopCloser struct{ *bytes.Reader }

func (readSeekNopCloser) Close() error { return nil }

type sectionReadCloser struct {
	*io.SectionReader
	f *os.File
}

func (v sectionReadCloser) Close() error { return v.f.Close() }
func statErr(path string) error          { _, err := os.Stat(path); return err }
