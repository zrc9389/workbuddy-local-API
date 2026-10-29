// Package reqlog 记录脱敏的请求级指标与可选 JSONL 归档。
//
// 默认模式保留最近 100 条事件并维护进程级计数；ErrorsOnly 模式只保留模型调用
// 错误（4xx/5xx、流错误、中断），成功请求仅计入汇总指标，最长保留 24 小时并受
// 条数、单条与总容量上限约束。磁盘归档只写事件元数据，不写提示词、响应正文、
// Authorization 或其它凭证。归档队列满时丢弃并计数，不允许日志写盘阻塞模型请求。
package reqlog

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
)

const (
	recentLimit     = 100
	defaultFileMax  = int64(16 << 20)
	defaultQueue    = 1024
	defaultReadMax  = 1000
	archiveFileGlob = "requests-*.jsonl"

	errorRetention     = 24 * time.Hour
	errorMaxEvents     = 1000
	errorMaxEventBytes = int64(8 << 10)
	errorMaxBytes      = int64(16 << 20)
	errorFileMaxBytes  = int64(256 << 10)
)

// Config 归档参数。Enabled=false 时仍保留内存指标。
type Config struct {
	Dir           string
	Enabled       bool
	RetentionDays int
	MaxBytes      int64
	FileMaxBytes  int64
	QueueSize     int
	// ErrorsOnly 只保留模型调用错误，并启用 24 小时、条数与容量硬上限。
	// 默认 false，保持直接构造 reqlog 的旧兼容行为。
	ErrorsOnly    bool
	MaxEvents     int
	MaxEventBytes int64
}

type Event = telemetry.Event
type Filter = telemetry.Filter
type ArchiveStats = telemetry.ArchiveStats
type Snapshot = telemetry.Snapshot

const (
	OutcomeSuccess     = telemetry.OutcomeSuccess
	OutcomeHTTPError   = telemetry.OutcomeHTTPError
	OutcomeStreamError = telemetry.OutcomeStreamError
	OutcomeInterrupted = telemetry.OutcomeInterrupted
)

var NewRequestID = telemetry.NewRequestID

// Recorder 并发安全的有界请求指标与归档记录器。
type Recorder struct {
	mu            sync.Mutex
	errorsOnly    bool
	started       time.Time
	inFlight      int64
	completed     int64
	succeeded     int64
	httpSuccess   int64
	durationSum   int64
	recent        []Event
	maxEventBytes int64
	archive       *archiveWriter
}

// New 创建记录器；Dir 为空或 Enabled=false 时只启用内存指标。
func New(cfg Config) *Recorder {
	cfg = normalizeConfig(cfg)
	r := &Recorder{errorsOnly: cfg.ErrorsOnly, started: time.Now(), recent: make([]Event, 0, recentLimit)}
	if cfg.ErrorsOnly {
		r.maxEventBytes = cfg.MaxEventBytes
		r.recent = make([]Event, 0, min(recentLimit, cfg.MaxEvents))
	}
	r.archive = newArchiveWriter(cfg)
	return r
}

func normalizeConfig(cfg Config) Config {
	if cfg.FileMaxBytes <= 0 {
		cfg.FileMaxBytes = defaultFileMax
	}
	if cfg.QueueSize <= 0 {
		cfg.QueueSize = defaultQueue
	}
	if cfg.ErrorsOnly {
		cfg.RetentionDays = 1
		if cfg.MaxBytes <= 0 || cfg.MaxBytes > errorMaxBytes {
			cfg.MaxBytes = errorMaxBytes
		}
		if cfg.MaxEvents <= 0 || cfg.MaxEvents > errorMaxEvents {
			cfg.MaxEvents = errorMaxEvents
		}
		if cfg.MaxEventBytes <= 0 || cfg.MaxEventBytes > errorMaxEventBytes {
			cfg.MaxEventBytes = errorMaxEventBytes
		}
		if cfg.FileMaxBytes > errorFileMaxBytes {
			cfg.FileMaxBytes = errorFileMaxBytes
		}
		if cfg.FileMaxBytes < cfg.MaxEventBytes {
			cfg.FileMaxBytes = cfg.MaxEventBytes
		}
		if cfg.MaxBytes < cfg.MaxEventBytes+1 {
			cfg.MaxBytes = cfg.MaxEventBytes + 1
		}
	}
	return cfg
}

func (c Config) errorPolicy() Config {
	cfg := c
	cfg.ErrorsOnly = true
	cfg.RetentionDays = 1
	cfg.MaxEvents = errorMaxEvents
	cfg.MaxEventBytes = errorMaxEventBytes
	cfg.MaxBytes = errorMaxBytes
	cfg.FileMaxBytes = errorFileMaxBytes
	return cfg
}

// Begin 标记一个请求进入处理。
func (r *Recorder) Begin() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.inFlight++
	r.mu.Unlock()
}

// Record 记录一个请求完成事件并写入归档队列。
func (r *Recorder) Record(e Event) {
	if r == nil {
		return
	}
	if e.Time.IsZero() {
		e.Time = time.Now()
	}
	if e.Outcome == "" {
		if e.Status == 200 && e.OK {
			e.Outcome = OutcomeSuccess
		} else {
			e.Outcome = OutcomeHTTPError
		}
	}
	r.mu.Lock()
	if r.inFlight > 0 {
		r.inFlight--
	}
	r.completed++
	if e.OK {
		r.succeeded++
	}
	if e.Status >= 200 && e.Status < 300 {
		r.httpSuccess++
	}
	r.durationSum += e.DurationMs
	keep := !r.errorsOnly || r.keepError(e)
	if keep {
		r.recent = append([]Event{e}, r.recent...)
		if len(r.recent) > recentLimit {
			r.recent = r.recent[:recentLimit]
		}
	}
	r.mu.Unlock()
	if keep && r.archive != nil {
		r.archive.enqueue(e)
	}
}

// keepError 判断错误事件是否值得保留；超长事件与归档写入口径保持一致，
// 避免列表中出现磁盘已因容量上限丢弃的记录。
func (r *Recorder) keepError(e Event) bool {
	if !isError(&e) {
		return false
	}
	if r.maxEventBytes <= 0 {
		return true
	}
	raw, err := json.Marshal(e)
	return err == nil && int64(len(raw))+1 <= r.maxEventBytes
}

// Snapshot 返回进程内指标和归档状态。
func (r *Recorder) Snapshot() Snapshot {
	if r == nil {
		return Snapshot{}
	}
	r.mu.Lock()
	cutoff := time.Now().Add(-errorRetention)
	recent := make([]Event, 0, len(r.recent))
	for _, e := range r.recent {
		if e.Time.After(cutoff) {
			recent = append(recent, e)
		}
	}
	s := Snapshot{
		StartedAt: r.started,
		Completed: r.completed,
		InFlight:  r.inFlight,
		Succeeded: r.succeeded,
		Recent:    append([]Event(nil), recent...),
	}
	if r.completed > 0 {
		s.Failed = r.completed - r.succeeded
		s.SuccessRate = round1(float64(r.succeeded) / float64(r.completed) * 100)
		s.HTTPSuccessRate = round1(float64(r.httpSuccess) / float64(r.completed) * 100)
		s.AvgDurationMs = float64(r.durationSum) / float64(r.completed)
	}
	r.mu.Unlock()
	if r.archive != nil {
		s.Archive = r.archive.stats()
	}
	return s
}

// ReadArchive 返回最近的归档事件（按时间倒序）。limit<=0 时回落 200，最大 1000。
func (r *Recorder) ReadArchive(limit int, filter Filter) ([]Event, error) {
	if r == nil || r.archive == nil {
		return nil, nil
	}
	return r.archive.read(limit, filter)
}

// FindArchive 按稳定事件 ID 查找单条归档记录；找不到返回 (nil, nil)。
// ID 由事件内容派生，仅用于定位，不暴露 request_id 或账号标识。
func (r *Recorder) FindArchive(id string) (*Event, error) {
	if r == nil || r.archive == nil || id == "" {
		return nil, nil
	}
	return r.archive.find(id)
}

// FindRecent 按稳定事件 ID 在内存错误列表中查找，供归档关闭时按需展示详情。
func (r *Recorder) FindRecent(id string) *Event {
	if r == nil || id == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.recent {
		if !isError(&r.recent[i]) || !r.recent[i].Time.After(time.Now().Add(-errorRetention)) || EventID(r.recent[i]) != id {
			continue
		}
		e := r.recent[i]
		return &e
	}
	return nil
}

// EventID 返回事件内容派生的稳定标识（sha256 前 16 字节的十六进制）。
// 仅凭 ID 无法还原请求 ID、账号或来源；同一事件在内存与归档中结果一致。
func EventID(e Event) string {
	h := sha256.New()
	for _, value := range []string{
		e.Time.UTC().Format(time.RFC3339Nano),
		strconv.FormatInt(e.DurationMs, 10),
		strconv.FormatInt(e.TTFBMs, 10),
		strconv.Itoa(e.Attempts),
		e.Path,
		e.Model,
		strconv.Itoa(e.Status),
		e.Outcome,
		e.RequestID,
		e.Account,
		e.ClientIP,
		e.UserAgent,
	} {
		_, _ = h.Write([]byte(value))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// Close 刷盘并停止后台归档。
func (r *Recorder) Close() {
	if r == nil || r.archive == nil {
		return
	}
	r.archive.close()
}

// DeleteAccount removes only rows carrying the exact non-reversible account
// reference. Legacy rows without a reference are retained for normal expiry;
// guessing from a nickname or UID prefix could delete another account's data.
func (r *Recorder) DeleteAccount(uid string) error {
	if r == nil {
		return nil
	}
	ref := telemetry.AccountReference(uid)
	if ref == "" {
		return errors.New("empty account UID")
	}
	if r.archive == nil || !r.archive.enabled() {
		r.mu.Lock()
		kept := r.recent[:0]
		for _, e := range r.recent {
			if e.AccountRef != ref {
				kept = append(kept, e)
			}
		}
		r.recent = kept
		r.mu.Unlock()
		return nil
	}
	if err := r.archive.deleteAccount(ref); err != nil {
		return err
	}
	r.mu.Lock()
	kept := r.recent[:0]
	for _, e := range r.recent {
		if e.AccountRef != ref {
			kept = append(kept, e)
		}
	}
	r.recent = kept
	r.mu.Unlock()
	return nil
}

// WithErrorOnlyPolicy 返回独立持有的错误日志记录器，供 production 组合层使用。
// 原记录器及其事件流不受影响，避免测试或其他调用方被静默改变语义。
func (r *Recorder) WithErrorOnlyPolicy() *Recorder {
	if r == nil || r.archive == nil {
		return nil
	}
	cfg := r.archive.cfg.errorPolicy()
	if !r.archive.cfg.Enabled {
		cfg.Enabled = false
	}
	return New(cfg)
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

// isError 返回模型调用是否值得保留。4xx/5xx、流错误与中断都算错误；
// 成功调用不进入错误列表或错误归档，但仍计入 Snapshot 的汇总指标。
func isError(e *Event) bool {
	if e.OK || (e.Status >= 200 && e.Status < 300 && e.Outcome == OutcomeSuccess) {
		return false
	}
	if e.Status >= 400 {
		return true
	}
	return e.Outcome == OutcomeHTTPError || e.Outcome == OutcomeStreamError || e.Outcome == OutcomeInterrupted
}

type archiveWriter struct {
	opMu        sync.Mutex
	deletedRefs map[string]bool
	cfg         Config
	ch          chan Event
	stop        chan struct{}
	done        chan struct{}
	closeOnce   sync.Once
	dropped     atomic.Uint64
	lastErrMu   sync.Mutex
	lastErr     string

	file  *os.File
	buf   *bufio.Writer
	path  string
	day   string
	size  int64
	total int64
	count int

	lastPrune  time.Time
	nextExpiry time.Time
}

func (w *archiveWriter) deleteAccount(ref string) error {
	if !w.enabled() {
		return nil
	}
	w.opMu.Lock()
	defer w.opMu.Unlock()
	for {
		select {
		case queued := <-w.ch:
			if err := w.writeEventLocked(queued); err != nil {
				return err
			}
		default:
			goto drained
		}
	}
drained:
	select {
	case <-w.stop:
		return errors.New("request archive is closed")
	default:
	}
	if w.file != nil {
		if err := w.buf.Flush(); err != nil {
			return err
		}
		if err := w.file.Sync(); err != nil {
			return err
		}
		if err := w.file.Close(); err != nil {
			return err
		}
		w.file, w.buf = nil, nil
	}
	files, err := archiveNames(w.cfg.Dir)
	if err != nil {
		return err
	}
	changed := false
	for _, name := range files {
		path := filepath.Join(w.cfg.Dir, name)
		tmp := path + ".delete.tmp"
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			in.Close()
			return err
		}
		reader := bufio.NewReaderSize(in, 64<<10)
		writer := bufio.NewWriterSize(out, 64<<10)
		var buffer []byte
		fileChanged := false
		for {
			line, tooLong, eof, readErr := readArchiveLine(reader, &buffer)
			if readErr != nil {
				err = readErr
				break
			}
			if tooLong {
				err = errors.New("archive record exceeds safe rewrite limit")
				break
			}
			if len(line) > 0 {
				var e Event
				if json.Unmarshal(line, &e) == nil {
					if e.AccountRef == ref {
						fileChanged = true
						changed = true
						if eof {
							break
						}
						continue
					}
				}
				if _, err = writer.Write(line); err == nil {
					err = writer.WriteByte('\n')
				}
			}
			if err != nil || eof {
				break
			}
		}
		if closeErr := in.Close(); err == nil {
			err = closeErr
		}
		if flushErr := writer.Flush(); err == nil {
			err = flushErr
		}
		if syncErr := out.Sync(); err == nil {
			err = syncErr
		}
		if closeErr := out.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(tmp)
			return err
		}
		if fileChanged {
			if err := os.Rename(tmp, path); err != nil {
				_ = os.Remove(tmp)
				return err
			}
		} else {
			_ = os.Remove(tmp)
		}
	}
	if changed {
		if err := w.refreshUsage(); err != nil {
			return err
		}
	}
	if w.deletedRefs == nil {
		w.deletedRefs = map[string]bool{}
	}
	w.deletedRefs[ref] = true
	return nil
}

func newArchiveWriter(cfg Config) *archiveWriter {
	cfg = normalizeConfig(cfg)
	if !cfg.Enabled || strings.TrimSpace(cfg.Dir) == "" {
		return &archiveWriter{cfg: cfg}
	}
	if cfg.RetentionDays <= 0 {
		cfg.RetentionDays = 1
	}
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = 100 << 20
	}
	if cfg.FileMaxBytes <= 0 {
		cfg.FileMaxBytes = defaultFileMax
	}
	if cfg.QueueSize <= 0 {
		cfg.QueueSize = defaultQueue
	}
	w := &archiveWriter{
		cfg: cfg, deletedRefs: map[string]bool{},
		ch:   make(chan Event, cfg.QueueSize),
		stop: make(chan struct{}),
		done: make(chan struct{}),
	}
	if err := os.MkdirAll(cfg.Dir, 0o700); err != nil {
		w.setErr(err)
		w.cfg.Enabled = false
		close(w.done)
		return w
	}
	w.scan()
	if !cfg.ErrorsOnly {
		// Apply the rolling window before the first archive read after restart.
		if err := w.pruneAllEvents(); err != nil {
			w.setErr(err)
		}
	}
	go w.run()
	return w
}

func (w *archiveWriter) enabled() bool {
	return w != nil && w.cfg.Enabled && w.cfg.Dir != "" && w.done != nil
}

func (w *archiveWriter) enqueue(e Event) {
	if !w.enabled() {
		return
	}
	select {
	case w.ch <- e:
	default:
		w.dropped.Add(1)
	}
}

func (w *archiveWriter) run() {
	w.runWithIntervals(time.Second, time.Minute)
}

func (w *archiveWriter) runWithIntervals(flushInterval, pruneInterval time.Duration) {
	defer close(w.done)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	pruneTicker := time.NewTicker(pruneInterval)
	defer pruneTicker.Stop()
	for {
		w.opMu.Lock()
		delay := time.Hour
		if !w.nextExpiry.IsZero() {
			delay = time.Until(w.nextExpiry)
			if delay < 0 {
				delay = 0
			}
		}
		w.opMu.Unlock()
		timer := time.NewTimer(delay)
		select {
		case e := <-w.ch:
			timer.Stop()
			w.writeEvent(e)
		case <-ticker.C:
			timer.Stop()
			w.opMu.Lock()
			w.flush()
			w.opMu.Unlock()
		case <-timer.C:
			w.prune()
		case <-pruneTicker.C:
			timer.Stop()
			w.prune()
		case <-w.stop:
			timer.Stop()
			for {
				select {
				case e := <-w.ch:
					w.writeEvent(e)
				default:
					w.flush()
					w.closeFile()
					return
				}
			}
		}
	}
}

func (w *archiveWriter) writeEvent(e Event) {
	w.opMu.Lock()
	defer w.opMu.Unlock()
	if err := w.writeEventLocked(e); err != nil {
		w.setErr(err)
	}
}

func (w *archiveWriter) writeEventLocked(e Event) error {
	if e.AccountRef != "" && w.deletedRefs[e.AccountRef] {
		return nil
	}
	if w.cfg.ErrorsOnly && !isError(&e) {
		return nil
	}
	raw, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if w.cfg.ErrorsOnly {
		if int64(len(raw))+1 > w.cfg.MaxEventBytes {
			w.dropped.Add(1)
			return nil
		}
		if !w.makeRoom(int64(len(raw)) + 1) {
			w.dropped.Add(1)
			return nil
		}
	}
	now := e.Time
	if now.IsZero() {
		now = time.Now()
	}
	day := now.Format("2006-01-02")
	if w.file == nil || w.day != day {
		if err := w.openFile(now, false); err != nil {
			return err
		}
	}
	if w.size > 0 && w.size+int64(len(raw))+1 > w.cfg.FileMaxBytes {
		if err := w.openFile(now, true); err != nil {
			return err
		}
	}
	if _, err := w.buf.Write(raw); err != nil {
		return err
	}
	if err := w.buf.WriteByte('\n'); err != nil {
		return err
	}
	w.size += int64(len(raw)) + 1
	w.total += int64(len(raw)) + 1
	w.count++
	expiry := now.Add(errorRetention)
	if w.nextExpiry.IsZero() || expiry.Before(w.nextExpiry) {
		w.nextExpiry = expiry
	}
	return nil
}

func (w *archiveWriter) scan() {
	if !w.cfg.ErrorsOnly {
		names, err := archiveNames(w.cfg.Dir)
		if err != nil {
			w.setErr(err)
			return
		}
		for _, name := range names {
			if info, err := os.Stat(filepath.Join(w.cfg.Dir, name)); err == nil {
				w.total += info.Size()
			}
		}
		return
	}
	// 启动即清理旧成功记录与过期错误，避免它们继续占用容量或计入磁盘统计。
	if err := w.pruneErrors(); err != nil {
		w.setErr(err)
	}
	w.lastPrune = time.Now()
}

// refreshUsage 按磁盘当前内容重建错误事件的条数与总字节数。
// 错误模式下归档量很小（条数上限 1000），这比维护跨轮转/跨进程的增量计数可靠。
func (w *archiveWriter) refreshUsage() error {
	names, err := archiveNames(w.cfg.Dir)
	if err != nil {
		return err
	}
	var total int64
	count := 0
	var next time.Time
	for _, name := range names {
		path := filepath.Join(w.cfg.Dir, name)
		if _, err := os.Stat(path); err != nil {
			continue
		}
		err = scanArchiveLines(path, func(line []byte) bool {
			if at, ok := eventTimeFromJSON(line); ok {
				expiry := at.Add(errorRetention)
				if expiry.After(time.Now()) && (next.IsZero() || expiry.Before(next)) {
					next = expiry
				}
			}
			var e Event
			if json.Unmarshal(line, &e) == nil && isError(&e) {
				total += int64(len(line)) + 1
				count++
			}
			return true
		})
		if err != nil {
			return err
		}
	}
	w.total = total
	w.count = count
	w.nextExpiry = next
	return nil
}

// makeRoom 删除最老错误记录，直到条数与字节总量都能容纳下一条错误。
// 计数由单写协程增量维护（启动时扫描一次），避免每条错误都重读整个归档目录。
func (w *archiveWriter) makeRoom(add int64) bool {
	for w.count >= w.cfg.MaxEvents || w.total+add > w.cfg.MaxBytes {
		beforeTotal, beforeCount := w.total, w.count
		if !w.removeOldest() {
			return false
		}
		if w.total == beforeTotal && w.count == beforeCount {
			return false
		}
	}
	return true
}

func (w *archiveWriter) removeOldest() bool {
	w.flush()
	if !w.compactOldestEvent() {
		return false
	}
	if w.cfg.ErrorsOnly {
		w.count--
		if w.count < 0 {
			w.count = 0
		}
	}
	return true
}

// compactOldestEvent 删除归档目录中事件时间最早的一条错误记录。
// 只删单条而非整文件，避免“删掉整个文件却只少一条”的容量误判。
func (w *archiveWriter) compactOldestEvent() bool {
	w.flush()
	names, err := archiveNames(w.cfg.Dir)
	if err != nil {
		w.setErr(err)
		return false
	}
	type candidate struct {
		path string
		raw  string
		at   time.Time
	}
	var oldest candidate
	for _, name := range names {
		path := filepath.Join(w.cfg.Dir, name)
		oversized, err := archiveHasOversizedLines(path)
		if err != nil {
			w.setErr(err)
			continue
		}
		if oversized {
			continue
		}
		_ = scanArchiveLines(path, func(line []byte) bool {
			e, known := knownArchiveEvent(line)
			if !known || !isError(&e) {
				return true
			}
			if oldest.raw == "" || e.Time.Before(oldest.at) {
				oldest = candidate{path: path, raw: string(line), at: e.Time}
			}
			return true
		})
	}
	if oldest.raw == "" {
		return false
	}
	active := w.path == oldest.path
	tmp := oldest.path + ".tmp"
	removed, kept := false, 0
	err = rewriteArchiveLines(oldest.path, tmp, func(line []byte) (bool, bool) {
		if removed || string(line) != oldest.raw {
			kept++
			return true, false
		}
		removed = true
		return false, false
	})
	if err != nil {
		_ = os.Remove(tmp)
		w.setErr(err)
		return false
	}
	if !removed || kept == 0 {
		// A concurrent writer already compacted it, or dropping the line would
		// empty the file: leave the archive untouched.
		_ = os.Remove(tmp)
		return false
	}
	if active {
		w.closeFile()
	}
	if err := os.Rename(tmp, oldest.path); err != nil {
		_ = os.Remove(tmp)
		w.setErr(err)
		return false
	}
	if w.cfg.ErrorsOnly {
		w.total -= int64(len(oldest.raw)) + 1
		if w.total < 0 {
			w.total = 0
		}
	}
	return true
}

func (w *archiveWriter) openFile(now time.Time, rotate bool) error {
	w.closeFile()
	day := now.Format("2006-01-02")
	if err := os.MkdirAll(w.cfg.Dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(w.cfg.Dir, "requests-"+day+".jsonl")
	if rotate {
		path = nextArchivePath(w.cfg.Dir, day)
	} else if latest := latestArchiveForDay(w.cfg.Dir, day); latest != "" {
		path = filepath.Join(w.cfg.Dir, latest)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	w.file = f
	w.buf = bufio.NewWriterSize(f, 64<<10)
	w.path = path
	w.day = day
	w.size = info.Size()
	return nil
}

func latestArchiveForDay(dir, day string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	prefix := "requests-" + day
	best := ""
	bestIndex := -1
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		idx := 0
		if name[len(prefix):len(name)-len(".jsonl")] != "" {
			part := strings.TrimSuffix(strings.TrimPrefix(name[len(prefix):], "."), ".jsonl")
			n, err := strconv.Atoi(part)
			if err != nil {
				continue
			}
			idx = n
		}
		if idx > bestIndex {
			bestIndex = idx
			best = name
		}
	}
	if best == "" {
		return ""
	}
	return best
}

func nextArchivePath(dir, day string) string {
	base := filepath.Join(dir, "requests-"+day)
	path := base + ".jsonl"
	for i := 1; fileExists(path); i++ {
		path = fmt.Sprintf("%s.%d.jsonl", base, i)
	}
	return path
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func (w *archiveWriter) flush() {
	if w.buf == nil {
		return
	}
	if err := w.buf.Flush(); err != nil {
		w.setErr(err)
	}
}

func (w *archiveWriter) closeFile() {
	if w.buf != nil {
		_ = w.buf.Flush()
	}
	if w.file != nil {
		_ = w.file.Close()
	}
	w.file = nil
	w.buf = nil
	w.path = ""
	w.day = ""
	w.size = 0
}

func (w *archiveWriter) prune() {
	w.opMu.Lock()
	defer w.opMu.Unlock()
	if !w.enabled() {
		return
	}
	if w.cfg.ErrorsOnly {
		if err := w.pruneErrors(); err != nil {
			w.setErr(err)
			w.nextExpiry = time.Time{}
		}
		return
	}
	if err := w.pruneAllEvents(); err != nil {
		w.setErr(err)
		w.nextExpiry = time.Time{}
	}
	w.pruneBySizeLegacy()
}

func eventTimeFromJSON(line []byte) (time.Time, bool) {
	var raw map[string]json.RawMessage
	if json.Unmarshal(line, &raw) != nil {
		return time.Time{}, false
	}
	value, ok := raw["time"]
	if !ok {
		return time.Time{}, false
	}
	var t time.Time
	if json.Unmarshal(value, &t) != nil || t.IsZero() {
		return time.Time{}, false
	}
	return t, true
}

// archiveHasOversizedLines prevents a rewrite or whole-file eviction from
// discarding a line that the bounded scanner cannot inspect safely.
func archiveHasOversizedLines(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	reader := bufio.NewReaderSize(f, 64<<10)
	var buf []byte
	for {
		_, tooLong, eof, err := readArchiveLine(reader, &buf)
		if err != nil {
			return false, err
		}
		if tooLong {
			return true, nil
		}
		if eof {
			return false, nil
		}
	}
}

func (w *archiveWriter) pruneAllEvents() error {
	w.flush()
	cutoff := time.Now().Add(-24 * time.Hour)
	names, err := archiveNames(w.cfg.Dir)
	if err != nil {
		return err
	}
	for _, name := range names {
		path := filepath.Join(w.cfg.Dir, name)
		oversized, err := archiveHasOversizedLines(path)
		if err != nil {
			return err
		}
		if oversized {
			continue
		}
		changed := false
		tmp := path + ".retention.tmp"
		err = rewriteArchiveLines(path, tmp, func(line []byte) (bool, bool) {
			at, known := eventTimeFromJSON(line)
			if known && !at.After(cutoff) {
				changed = true
				return false, false
			}
			// Unknown or malformed records are retained for forensic safety.
			return true, false
		})
		if err != nil {
			_ = os.Remove(tmp)
			return err
		}
		if !changed {
			_ = os.Remove(tmp)
			continue
		}
		if w.path == path {
			w.closeFile()
		}
		if err := os.Rename(tmp, path); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	return w.refreshUsage()
}

func (w *archiveWriter) pruneBySizeLegacy() {
	entries, err := os.ReadDir(w.cfg.Dir)
	if err != nil {
		w.setErr(err)
		return
	}
	type item struct {
		path  string
		size  int64
		mtime time.Time
	}
	items := make([]item, 0, len(entries))
	var total int64
	cutoff := time.Time{}
	for _, entry := range entries {
		if entry.Type() != 0 || !strings.HasPrefix(entry.Name(), "requests-") || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(w.cfg.Dir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, item{path: path, size: info.Size(), mtime: info.ModTime()})
		total += info.Size()
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].mtime.Equal(items[j].mtime) {
			return items[i].path < items[j].path
		}
		return items[i].mtime.Before(items[j].mtime)
	})
	for _, it := range items {
		if it.path != w.path && (it.mtime.Before(cutoff) || total > w.cfg.MaxBytes) {
			unknown, err := archiveHasOversizedLines(it.path)
			if err != nil {
				w.setErr(err)
				continue
			}
			if unknown {
				continue
			}
			if err := scanArchiveLines(it.path, func(line []byte) bool {
				_, known := eventTimeFromJSON(line)
				if !known {
					unknown = true
					return false
				}
				return true
			}); err != nil {
				w.setErr(err)
				continue
			}
			if unknown {
				continue
			}
			if err := os.Remove(it.path); err == nil {
				total -= it.size
			}
		}
	}
	w.total = total
}

// knownArchiveEvent retains records with unknown fields or timestamps.
func knownArchiveEvent(line []byte) (Event, bool) {
	var e Event
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&e); err != nil {
		return e, false
	}
	return e, !e.Time.IsZero()
}

// pruneErrors 按事件时间执行 24 小时保留策略，同时丢弃旧版本遗留的成功记录。
// 不能依赖文件 mtime：目录恢复备份或同秒轮转都会让 mtime 与事件时间脱节。
// 只有内容发生变化时才重写文件，避免每秒产生无谓 IO。
func (w *archiveWriter) pruneErrors() error {
	w.flush()
	cutoff := time.Now().Add(-errorRetention)
	names, err := archiveNames(w.cfg.Dir)
	if err != nil {
		return err
	}
	for _, name := range names {
		path := filepath.Join(w.cfg.Dir, name)
		oversized, err := archiveHasOversizedLines(path)
		if err != nil {
			return err
		}
		if oversized {
			continue
		}
		changed, kept := false, 0
		tmp := path + ".tmp"
		err = rewriteArchiveLines(path, tmp, func(line []byte) (bool, bool) {
			// Retention depends on the timestamp, not on whether a newer version
			// added fields to the record. Otherwise valid old errors live forever.
			if at, ok := eventTimeFromJSON(line); ok && !at.After(cutoff) {
				changed = true
				return false, false
			}
			e, known := knownArchiveEvent(line)
			if !known {
				// Damaged legacy rows have no trustworthy timestamp; preserve them.
				kept++
				return true, false
			}
			if e.Time.IsZero() {
				kept++
				return true, false
			}
			clearlySuccess := e.OK || (e.Status >= 200 && e.Status < 300 && e.Outcome == OutcomeSuccess)
			if clearlySuccess || !e.Time.After(cutoff) {
				changed = true
				return false, false
			}
			kept++
			return true, false
		})
		if err != nil {
			_ = os.Remove(tmp)
			return err
		}
		if !changed {
			_ = os.Remove(tmp)
			continue
		}
		if w.path == path {
			w.closeFile()
		}
		if kept == 0 {
			_ = os.Remove(tmp)
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		if err := os.Rename(tmp, path); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	return w.refreshUsage()
}

func (w *archiveWriter) read(limit int, filter Filter) ([]Event, error) {
	if !w.enabled() {
		return nil, nil
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > defaultReadMax {
		limit = defaultReadMax
	}
	entries, err := os.ReadDir(w.cfg.Dir)
	if err != nil {
		return nil, err
	}
	// 文件读取顺序无关紧要：结果一律按事件时间排序。不能依赖归档文件的 mtime 还原时间
	// 顺序——同一秒内连续轮转写出的多个文件 mtime 经常完全相同（Linux 文件时间戳粒度粗），
	// os.ReadDir 的字典序又会把装着最早事件的基准文件 requests-<day>.jsonl 排在
	// requests-<day>.N.jsonl 之后；目录被整体拷贝 / 恢复备份后 mtime 更不可信。
	cutoff := time.Now().Add(-errorRetention)
	// Only the newest window is retained, so archive memory stays bounded by
	// the requested limit instead of the number of archived events.
	keepLimit := limit
	if w.cfg.ErrorsOnly && w.cfg.MaxEvents > 0 && w.cfg.MaxEvents < keepLimit {
		keepLimit = w.cfg.MaxEvents
	}
	kept := make([]Event, 0, keepLimit)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, "requests-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		err := scanArchiveLines(filepath.Join(w.cfg.Dir, name), func(line []byte) bool {
			var e Event
			if json.Unmarshal(line, &e) != nil || w.cfg.ErrorsOnly && !isError(&e) || !e.Time.After(cutoff) || !filterMatch(filter, e) {
				return true
			}
			kept = append(kept, e)
			return true
		})
		if err != nil {
			return kept, err
		}
		if len(kept) > 2*keepLimit {
			// Rebuild with a right-sized backing array; slicing alone would keep the
			// scan-time capacity alive until the next append.
			kept = append(make([]Event, 0, keepLimit), newestEvents(kept, keepLimit)...)
		}
	}
	// Contract: newest first, stable for equal timestamps. keepLimit only
	// tightens ErrorsOnly; the caller's limit still applies last.
	out := newestEvents(kept, keepLimit)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// find 按稳定事件 ID 读取单条错误事件，按事件时间倒序返回最新命中。
// 只读取一份归档目录，不缓存详情，避免额外内存占用。
func (w *archiveWriter) find(id string) (*Event, error) {
	if !w.enabled() {
		return nil, nil
	}
	entries, err := os.ReadDir(w.cfg.Dir)
	if err != nil {
		return nil, err
	}
	cutoff := time.Now().Add(-errorRetention)
	var found *Event
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, "requests-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		err := scanArchiveLines(filepath.Join(w.cfg.Dir, name), func(line []byte) bool {
			var e Event
			if json.Unmarshal(line, &e) != nil || w.cfg.ErrorsOnly && !isError(&e) || !e.Time.After(cutoff) {
				return true
			}
			if EventID(e) != id {
				return true
			}
			if found == nil || e.Time.After(found.Time) {
				copied := e
				found = &copied
			}
			return true
		})
		if err != nil {
			return found, err
		}
	}
	return found, nil
}

// newestEvents keeps the newest limit events, stable for equal timestamps. The
// result is a fresh slice so the caller never retains the scan-time backing
// array (which may be several times larger than the requested window).
func newestEvents(events []Event, limit int) []Event {
	if limit <= 0 || len(events) == 0 {
		return nil
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Time.After(events[j].Time) })
	if len(events) > limit {
		events = events[:limit]
	}
	out := make([]Event, len(events))
	copy(out, events)
	return out
}

// maxArchiveLineBytes bounds one JSONL record. Writers cap error records at
// 8 KiB, so this leaves headroom for legacy rows without buffering a whole file.
const maxArchiveLineBytes = 1 << 20

// readArchiveLine reads one bounded line. tooLong reports a record that exceeded
// maxArchiveLineBytes and was discarded up to its newline; eof reports that no
// further bytes remain. The returned slice is valid until the next call and
// points either into buf (spans) or into the reader's internal buffer.
func readArchiveLine(reader *bufio.Reader, buf *[]byte) (line []byte, tooLong, eof bool, err error) {
	*buf = (*buf)[:0]
	for {
		frag, readErr := reader.ReadSlice('\n')
		switch {
		case readErr == nil:
			if len(*buf)+len(trimArchiveLine(frag)) > maxArchiveLineBytes {
				return nil, true, false, nil
			}
			if len(*buf) == 0 {
				return trimArchiveLine(frag), false, false, nil
			}
			*buf = append(*buf, frag...)
			return trimArchiveLine(*buf), false, false, nil
		case errors.Is(readErr, bufio.ErrBufferFull):
			if len(*buf)+len(frag) > maxArchiveLineBytes {
				// Drop the rest of this record and resume at the next one, so a single
				// damaged row cannot hide the remainder of the archive.
				if err := discardArchiveLine(reader); err != nil {
					return nil, true, false, err
				}
				return nil, true, false, nil
			}
			*buf = append(*buf, frag...)
		case errors.Is(readErr, io.EOF):
			if len(*buf)+len(trimArchiveLine(frag)) > maxArchiveLineBytes {
				return nil, true, true, nil
			}
			if len(*buf) == 0 {
				return trimArchiveLine(frag), false, true, nil
			}
			*buf = append(*buf, frag...)
			return trimArchiveLine(*buf), false, true, nil
		default:
			return nil, false, false, readErr
		}
	}
}

// discardArchiveLine consumes bytes up to and including the next newline.
func discardArchiveLine(reader *bufio.Reader) error {
	for {
		_, err := reader.ReadSlice('\n')
		if err == nil {
			return nil
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
}

func trimArchiveLine(line []byte) []byte {
	for len(line) > 0 && (line[len(line)-1] == byte('\n') || line[len(line)-1] == byte('\r')) {
		line = line[:len(line)-1]
	}
	return line
}

// scanArchiveLines streams a JSONL archive one bounded line at a time. Returning
// false from visit stops the scan early. Oversized or damaged lines are skipped
// instead of aborting the scan: the archive is append-only telemetry.
func scanArchiveLines(path string, visit func(line []byte) bool) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	reader := bufio.NewReaderSize(f, 64<<10)
	var buf []byte
	for {
		line, tooLong, eof, err := readArchiveLine(reader, &buf)
		if err != nil {
			return err
		}
		if len(line) > 0 && !tooLong && !visit(line) {
			return nil
		}
		if eof {
			return nil
		}
	}
}

// rewriteArchiveLines streams path into tmp, asking keep for every non-empty
// line. Only one line is held in memory at a time. tmp is always created, so a
// caller that keeps nothing can detect that via kept and drop it.
func rewriteArchiveLines(path, tmp string, keep func(line []byte) (bool, bool)) (err error) {
	src, err := os.Open(path)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer := bufio.NewWriterSize(dst, 64<<10)
	defer func() {
		if closeErr := dst.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	reader := bufio.NewReaderSize(src, 64<<10)
	var buf []byte
	for {
		line, tooLong, eof, readErr := readArchiveLine(reader, &buf)
		if readErr != nil {
			return readErr
		}
		if len(line) > 0 && !tooLong {
			write, stop := keep(line)
			if write {
				if _, err := writer.Write(line); err != nil {
					return err
				}
				if err := writer.WriteByte(byte('\n')); err != nil {
					return err
				}
			}
			if stop {
				break
			}
		}
		if eof {
			break
		}
	}
	return writer.Flush()
}

func readFile(path string, filter Filter, cutoff time.Time, errorsOnly bool) ([]Event, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	var out []Event
	for scanner.Scan() {
		var e Event
		if json.Unmarshal(scanner.Bytes(), &e) != nil || errorsOnly && !isError(&e) || (!cutoff.IsZero() && !e.Time.After(cutoff)) || !filterMatch(filter, e) {
			continue
		}
		out = append(out, e)
	}
	return out, scanner.Err()
}

func archiveNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Type() != 0 || !strings.HasPrefix(entry.Name(), "requests-") || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names, nil
}

func filterMatch(f Filter, e Event) bool {
	if f.Outcome != "" && e.Outcome != f.Outcome {
		return false
	}
	if !containsFold(e.Account, f.Account) {
		return false
	}
	if !containsFold(e.Model, f.Model) {
		return false
	}
	if !containsFold(e.ClientIP, f.ClientIP) {
		return false
	}
	if !containsFold(e.UserAgent, f.UserAgent) {
		return false
	}
	if !f.From.IsZero() && e.Time.Before(f.From) {
		return false
	}
	if !f.To.IsZero() && e.Time.After(f.To) {
		return false
	}
	return true
}

// containsFold 大小写不敏感的子串匹配；needle 为空视为命中（不筛该字段）。
func containsFold(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func (w *archiveWriter) stats() ArchiveStats {
	s := ArchiveStats{Enabled: w.enabled(), Dir: w.cfg.Dir, DroppedWrites: w.dropped.Load(), LastError: w.errString()}
	if !s.Enabled {
		return s
	}
	entries, err := os.ReadDir(w.cfg.Dir)
	if err != nil {
		s.LastError = err.Error()
		return s
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "requests-") || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		if info, err := entry.Info(); err == nil {
			s.Files++
			s.Bytes += info.Size()
		}
	}
	return s
}

func (w *archiveWriter) close() {
	if !w.enabled() {
		return
	}
	w.closeOnce.Do(func() {
		close(w.stop)
		<-w.done
	})
}

func (w *archiveWriter) setErr(err error) {
	if err == nil {
		return
	}
	w.lastErrMu.Lock()
	w.lastErr = err.Error()
	w.lastErrMu.Unlock()
}

func (w *archiveWriter) errString() string {
	w.lastErrMu.Lock()
	defer w.lastErrMu.Unlock()
	return w.lastErr
}
