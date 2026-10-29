// Package metacore manages an optional isolated Mihomo sidecar. It never changes
// the system proxy or accepts remote core configurations.
package metacore

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"

	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrUnavailable          = errors.New("verified Mihomo kernel unavailable")
	ErrBusy                 = errors.New("meta operation already running")
	ErrInvalid              = errors.New("invalid meta request")
	ErrNodeTimeout          = errors.New("node timed out; test it again before binding")
	ErrApply                = errors.New("meta configuration not applied; previous binding retained")
	ErrRollback             = errors.New("meta rollback failed; sidecar stopped to prevent misrouting")
	ErrSubscriptionInUse    = errors.New("subscription has bound accounts; unbind them first")
	ErrSubscriptionNotFound = errors.New("subscription not found")
	ErrSubscriptionNoURL    = errors.New("subscription has no stored URL")
)

const (
	maxProviders         = 16
	maxNodes             = 1000
	maxBindings          = 256
	maxSubscriptionBytes = 4 << 20
	maxStoredBytes       = 64 << 20
)

type Options struct {
	Demo        bool
	Dir         string
	Binary      string
	IdleTimeout time.Duration
}
type Binding struct {
	UID     string `json:"uid"`
	Node    string `json:"node"`
	RouteID string `json:"route_id"`
	Port    int    `json:"port"`
}
type bindingRecord struct {
	Binding
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Password string `json:"password"`
}
type provider struct {
	ID            string    `json:"id"`
	File          string    `json:"file"`
	Name          string    `json:"name"`
	URL           string    `json:"url,omitempty"`
	Enabled       bool      `json:"enabled"`
	CreatedAt     time.Time `json:"created_at,omitempty"`
	UpdatedAt     time.Time `json:"updated_at,omitempty"`
	LastRefreshAt time.Time `json:"last_refresh_at,omitempty"`
	LastError     string    `json:"last_error,omitempty"`
}
type diskState struct {
	PendingDelete string          `json:"pending_delete,omitempty"`
	Version       int             `json:"version"`
	Providers     []provider      `json:"providers"`
	Bindings      []bindingRecord `json:"bindings"`
	// NodeHistory stores the last latency samples independently of the live
	// Mihomo inventory.  Keeping it in the durable state makes the chart
	// survive a service restart and lets a removed node be pruned atomically
	// with its provider state.
	NodeHistory map[string][]History `json:"node_history,omitempty"`
}
type History struct {
	Delay  int       `json:"delay"`
	Time   time.Time `json:"time"`
	Status string    `json:"status,omitempty"`
}
type Node struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	DisplayName  string     `json:"display_name"`
	Type         string     `json:"type"`
	Provider     string     `json:"provider"`
	ProviderName string     `json:"provider_name,omitempty"`
	BindingCount int        `json:"binding_count"`
	Status       string     `json:"status"`
	DelayMS      *int       `json:"delay_ms,omitempty"`
	TestedAt     *time.Time `json:"tested_at,omitempty"`
	History      []History  `json:"history"`
}
type coreNode struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type NodesResponse struct {
	Demo     bool      `json:"demo"`
	Nodes    []Node    `json:"nodes"`
	Bindings []Binding `json:"bindings"`
	Total    int       `json:"total"`
}
type Status struct {
	Demo                 bool   `json:"demo"`
	Available            bool   `json:"available"`
	Running              bool   `json:"running"`
	State                string `json:"state"`
	Version              string `json:"version"`
	Subscriptions        int    `json:"subscriptions"`
	EnabledSubscriptions int    `json:"enabled_subscriptions"`
	Nodes                int    `json:"nodes"`
	Bindings             int    `json:"bindings"`
	Error                string `json:"error,omitempty"`
}

type Subscription struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Enabled       bool      `json:"enabled"`
	Status        string    `json:"status"`
	NodeCount     int       `json:"node_count"`
	Bindings      int       `json:"bindings"`
	CreatedAt     time.Time `json:"created_at,omitempty"`
	UpdatedAt     time.Time `json:"updated_at,omitempty"`
	LastRefreshAt time.Time `json:"last_refresh_at,omitempty"`
	LastError     string    `json:"last_error,omitempty"`
	URLPreview    string    `json:"url_preview,omitempty"`
	HasURL        bool      `json:"has_url"`
}
type SubscriptionResult struct {
	OK       bool   `json:"ok"`
	Provider string `json:"provider"`
	Nodes    int    `json:"nodes"`
}
type engine interface {
	Available() bool
	Alive() bool
	Validate(context.Context, []byte) error
	Start(context.Context, []byte) error
	Apply(context.Context, []byte) error
	Request(context.Context, string, string, any, any) error
	Stop() error
}
type Manager struct {
	leases                           int
	mu                               sync.Mutex
	op                               chan struct{}
	opts                             Options
	core                             engine
	state                            diskState
	nodes                            map[string]Node
	controller, secret               string
	version, lastError               string
	lastUse                          time.Time
	closed                           bool
	ctx                              context.Context
	cancel                           context.CancelFunc
	wg                               sync.WaitGroup
	job                              TestJob
	testCancel                       context.CancelFunc
	stats                            Stats
	prevConnections                  map[string]connection
	lastCoreUpload, lastCoreDownload int64
	lastSample                       time.Time
	refreshInterval                  time.Duration
	refreshWake                      chan struct{}
	fetchURL                         func(context.Context, string) ([]byte, error)
	persistMu                        sync.Mutex
}

func (m *Manager) setFetcher(fetch func(context.Context, string) ([]byte, error)) {
	m.mu.Lock()
	m.fetchURL = fetch
	m.mu.Unlock()
}

func New(o Options) (*Manager, error) { return newManager(o, nil) }
func newManager(o Options, e engine) (*Manager, error) {
	if o.Dir == "" {
		return nil, ErrInvalid
	}
	dir, err := filepath.Abs(o.Dir)
	if err != nil {
		return nil, ErrInvalid
	}
	o.Dir = dir
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = 2 * time.Minute
	}
	if o.IdleTimeout < 30*time.Second {
		o.IdleTimeout = 30 * time.Second
	}
	if err = os.MkdirAll(dir, 0700); err == nil {
		err = secureDirectory(dir)
	}
	if err == nil {
		err = os.MkdirAll(filepath.Join(dir, "providers"), 0700)
	}
	if err != nil {
		return nil, errors.New("cannot initialize private meta directory")
	}
	addr, err := freeAddress()
	if err != nil {
		return nil, err
	}
	secret, err := randomToken()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{opts: o, op: make(chan struct{}, 1), nodes: map[string]Node{}, controller: addr, secret: secret, ctx: ctx, cancel: cancel, lastUse: time.Now(), prevConnections: map[string]connection{}, refreshWake: make(chan struct{}, 1), fetchURL: fetchSubscription}
	m.state = diskState{Version: 2, Providers: []provider{}, Bindings: []bindingRecord{}, NodeHistory: map[string][]History{}}
	var b []byte
	err = os.ErrNotExist
	if !o.Demo {
		b, err = readBoundedFile(filepath.Join(dir, "state.json"), 2<<20)
	}
	if err == nil {
		if json.Unmarshal(b, &m.state) != nil {
			cancel()
			return nil, errors.New("invalid persisted meta state")
		}
		v1 := m.state.Version == 1
		if v1 {
			for i := range m.state.Providers {
				m.state.Providers[i].Name = fmt.Sprintf("订阅 %d", i+1)
				m.state.Providers[i].Enabled = true
			}
			m.state.Version = 2
		}
		for i := range m.state.Providers {
			m.state.Providers[i].Enabled = effectiveProviderEnabled(m.state.Providers[i])
		}
		if v1 {
			if err := m.persist(m.state); err != nil {
				cancel()
				return nil, errors.New("cannot migrate persisted meta state")
			}
		}
		if !validState(m.state) {
			cancel()
			return nil, errors.New("invalid persisted meta state")
		}
		if m.state.NodeHistory == nil {
			m.state.NodeHistory = map[string][]History{}
		}
	} else if !os.IsNotExist(err) {
		cancel()
		return nil, errors.New("cannot read meta state")
	}
	if e == nil {
		if o.Demo {
			e = newDemoCore()
			m.state = demoState()
			m.nodes = demoNodes()
		} else {
			e = newNative(o, addr, secret)
		}
	}
	m.core = e
	m.stats = Stats{Accounts: []AccountStats{}, Estimated: true}
	m.wg.Add(1)
	go m.monitor()
	return m, nil
}
func (m *Manager) lock() error {
	return m.lockOperation(false)
}
func (m *Manager) lockOperation(allowPending bool) error {
	select {
	case m.op <- struct{}{}:
		m.mu.Lock()
		closed := m.closed
		pending := m.state.PendingDelete != ""
		m.mu.Unlock()
		if closed {
			<-m.op
			return ErrUnavailable
		}
		if pending && !allowPending {
			<-m.op
			return ErrBusy
		}
		return nil
	default:
		return ErrBusy
	}
}
func (m *Manager) unlock() { <-m.op }
func (m *Manager) snapshot() diskState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

// snapshotLocked clones durable state. The caller must hold m.mu.
func (m *Manager) snapshotLocked() diskState {
	s := m.state
	s.Providers = append([]provider(nil), s.Providers...)
	s.Bindings = append([]bindingRecord(nil), s.Bindings...)
	s.NodeHistory = cloneHistoryMap(s.NodeHistory)
	return s
}
func (m *Manager) Status() Status {
	if m == nil {
		return Status{State: "unavailable"}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	enabledSubscriptions := 0
	for _, p := range m.state.Providers {
		if effectiveProviderEnabled(p) {
			enabledSubscriptions++
		}
	}
	s := Status{Demo: m.opts.Demo, Available: m.core.Available(), Running: m.core.Alive(), Version: m.version, Subscriptions: len(m.state.Providers), EnabledSubscriptions: enabledSubscriptions, Nodes: len(m.nodes), Bindings: len(m.state.Bindings), Error: m.lastError}
	s.State = "stopped"
	if !s.Available {
		s.State = "unavailable"
	}
	if s.Running {
		s.State = "running"
	}
	if m.closed {
		s.State = "closed"
	}
	return s
}

func effectiveProviderEnabled(p provider) bool {
	if p.Name == "" {
		return true
	}
	return p.Enabled
}

func subscriptionPreview(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host + "/…"
}

func (m *Manager) Subscriptions() []Subscription {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.subscriptionsLocked()
}

func (m *Manager) subscriptionsLocked() []Subscription {
	result := make([]Subscription, 0, len(m.state.Providers))
	for _, p := range m.state.Providers {
		enabled := effectiveProviderEnabled(p)
		nodes := 0
		for _, n := range m.nodes {
			if n.Provider == p.ID {
				nodes++
			}
		}
		bindings := 0
		for _, b := range m.state.Bindings {
			if b.Provider == p.ID {
				bindings++
			}
		}
		status := "disabled"
		if enabled {
			status = "ready"
		}
		result = append(result, Subscription{ID: p.ID, Name: p.Name, Enabled: enabled, Status: status, NodeCount: nodes, Bindings: bindings, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, LastRefreshAt: p.LastRefreshAt, LastError: p.LastError, URLPreview: subscriptionPreview(p.URL), HasURL: p.URL != ""})
	}
	return result
}

// IsBound reports whether uid currently owns a Meta route. It is a read-only
// snapshot used by account mutation guards; callers must still handle a
// concurrent unbind/bind outcome through their normal operation result.
func (m *Manager) IsBound(uid string) bool {
	if m == nil || !safeID(uid) {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, b := range m.state.Bindings {
		if b.UID == uid {
			return true
		}
	}
	return false
}

// ExportAccountBinding is only for explicit, authenticated credential exports.
// Subscription URLs may contain secrets and must not be included in normal listings.
func (m *Manager) ExportAccountBinding(uid string) (string, string, bool) {
	if m == nil {
		return "", "", false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, b := range m.state.Bindings {
		if b.UID == uid {
			for _, p := range m.state.Providers {
				if p.ID == b.Provider {
					return p.URL, b.Name, true
				}
			}
			return "", b.Name, true
		}
	}
	return "", "", false
}

func (m *Manager) Nodes() NodesResponse {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := NodesResponse{Demo: m.opts.Demo, Nodes: []Node{}, Bindings: []Binding{}}
	providerNames := make(map[string]string, len(m.state.Providers))
	bindingCounts := make(map[string]int, len(m.state.Bindings))
	for _, b := range m.state.Bindings {
		bindingCounts[b.Node]++
	}
	for _, p := range m.state.Providers {
		providerNames[p.ID] = p.Name
	}
	for _, n := range m.nodes {
		n.History = append([]History{}, n.History...)
		n.BindingCount = bindingCounts[n.ID]
		n.ProviderName = providerNames[n.Provider]
		n.DisplayName = nodeDisplayName(n.Name, n.Provider)
		r.Nodes = append(r.Nodes, n)
	}
	sort.Slice(r.Nodes, func(i, j int) bool { return r.Nodes[i].ID < r.Nodes[j].ID })
	for _, b := range m.state.Bindings {
		r.Bindings = append(r.Bindings, b.Binding)
	}
	r.Total = len(r.Nodes)
	return r
}

func nodeDisplayName(name, provider string) string {
	prefix := provider + "/"
	if provider != "" && strings.HasPrefix(name, prefix) && len(name) > len(prefix) {
		return strings.TrimPrefix(name, prefix)
	}
	return name
}
func (m *Manager) EnsureStarted(ctx context.Context) error {
	if err := m.lock(); err != nil {
		return err
	}
	defer m.unlock()
	return m.ensure(ctx)
}

// StartSubscriptionRefresh periodically refreshes enabled providers whose cached
// data is older than interval. The loop is owned by Manager so every refresh
// uses the same serialized operation gate and Mihomo apply/rollback path as a
// manual refresh. It stops with ctx and never overlaps another refresh.
func (m *Manager) SetSubscriptionRefreshInterval(interval time.Duration) {
	if m == nil || interval <= 0 {
		return
	}
	m.mu.Lock()
	if m.refreshInterval == interval {
		m.mu.Unlock()
		return
	}
	m.refreshInterval = interval
	m.mu.Unlock()
	select {
	case m.refreshWake <- struct{}{}:
	default:
	}
}

func (m *Manager) StartSubscriptionRefresh(ctx context.Context, interval time.Duration) {
	if m == nil || interval <= 0 {
		return
	}
	m.mu.Lock()
	m.refreshInterval = interval
	m.mu.Unlock()
	go func() {
		retryAfter := make(map[string]time.Time)
		refreshDue := func() {
			m.mu.Lock()
			interval := m.refreshInterval
			m.mu.Unlock()
			for _, sub := range m.Subscriptions() {
				if ctx.Err() != nil {
					return
				}
				if time.Now().Before(retryAfter[sub.ID]) {
					continue
				}
				if !sub.Enabled || !sub.HasURL || (!sub.LastRefreshAt.IsZero() && time.Since(sub.LastRefreshAt) < interval) {
					continue
				}
				refreshCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				_, err := m.RefreshSubscription(refreshCtx, sub.ID)
				cancel()
				if err != nil && !errors.Is(err, context.Canceled) {
					retryAfter[sub.ID] = time.Now().Add(interval)
					log.Printf("metacore: scheduled subscription refresh %s failed: %v", sub.ID, err)
				} else {
					delete(retryAfter, sub.ID)
				}
			}
		}
		// Recover providers that were already stale when the process started.
		refreshDue()
		// Re-evaluate at most a minute after a subscription becomes due.
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				refreshDue()
			case <-m.refreshWake:
				clear(retryAfter)
				refreshDue()
			}
		}
	}()
}

func (m *Manager) ensure(ctx context.Context) error {
	m.mu.Lock()
	m.lastUse = time.Now()
	m.mu.Unlock()
	if m.core.Alive() {
		return nil
	}
	if !m.core.Available() {
		return ErrUnavailable
	}
	s := m.snapshot()
	b, err := renderConfig(s, m.controller, m.secret)
	if err != nil {
		return err
	}
	if err = m.core.Validate(ctx, b); err != nil {
		return ErrApply
	}
	if err = m.core.Start(ctx, b); err != nil {
		return ErrUnavailable
	}
	nodes, err := m.awaitStartupNodes(ctx, s)
	if err != nil {
		_ = m.core.Stop()
		return fmt.Errorf("%w: startup provider readiness", ErrApply)
	}
	if err = m.selectBindings(ctx, s); err != nil {
		_ = m.core.Stop()
		return fmt.Errorf("%w: startup route selection", ErrApply)
	}
	if err = m.verifyBindings(ctx, s); err != nil {
		_ = m.core.Stop()
		return fmt.Errorf("%w: startup route verification", ErrApply)
	}
	var v struct {
		Version string `json:"version"`
	}
	_ = m.core.Request(ctx, "GET", "/version", nil, &v)
	m.mu.Lock()
	m.nodes = nodes
	m.version = v.Version
	m.lastError = ""
	m.lastCoreUpload = 0
	m.lastCoreDownload = 0
	m.prevConnections = map[string]connection{}
	m.mu.Unlock()
	return nil
}

// Bind applies a validated per-account route, commits manager state, then calls
// saveProxy. saveProxy must be atomic on error (auth.SetProxyAndSave is suitable).
// No caller credentials or controller secret are returned in Binding.
func (m *Manager) Bind(ctx context.Context, uid, nodeID string, saveProxy func(string) error) (Binding, error) {
	if !safeID(uid) || saveProxy == nil {
		return Binding{}, ErrInvalid
	}
	if err := m.lock(); err != nil {
		return Binding{}, err
	}
	defer m.unlock()
	return m.bindLocked(ctx, uid, nodeID, saveProxy)
}

func (m *Manager) bindLocked(ctx context.Context, uid, nodeID string, saveProxy func(string) error) (Binding, error) {
	if err := m.ensure(ctx); err != nil {
		return Binding{}, err
	}
	m.mu.Lock()
	n, ok := m.nodes[nodeID]
	testing := m.job.Running
	m.mu.Unlock()
	if !ok {
		return Binding{}, ErrInvalid
	}
	if testing {
		return Binding{}, ErrBusy
	}
	if n.Status == "timeout" {
		return Binding{}, ErrNodeTimeout
	}
	old := m.snapshot()
	next := m.snapshot()
	index := -1
	for i, b := range next.Bindings {
		if b.UID == uid {
			index = i
			break
		}
	}
	var b bindingRecord
	if index >= 0 {
		b = next.Bindings[index]
	} else {
		if len(next.Bindings) >= maxBindings {
			return Binding{}, errors.New("account route limit reached")
		}
		addr, err := freeAddress()
		if err != nil {
			return Binding{}, err
		}
		_, port, _ := net.SplitHostPort(addr)
		var pn int
		_, _ = fmt.Sscan(port, &pn)
		pw, err := randomToken()
		if err != nil {
			return Binding{}, err
		}
		b = bindingRecord{Binding: Binding{UID: uid, RouteID: "acct-" + shortHash(uid), Port: pn}, Password: pw}
	}
	b.Node = n.ID
	b.Provider = n.Provider
	b.Name = n.Name
	if index >= 0 {
		next.Bindings[index] = b
	} else {
		next.Bindings = append(next.Bindings, b)
	}
	if index >= 0 {
		return m.switchBinding(ctx, old, next, b, saveProxy)
	}
	if err := m.apply(ctx, old, next); err != nil {
		return Binding{}, err
	}
	proxy := url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", b.Port), User: url.UserPassword("workbuddy", b.Password)}
	if err := saveProxy(proxy.String()); err != nil {
		if e := m.rollback(old); e != nil {
			return Binding{}, e
		}
		return Binding{}, errors.New("account proxy persistence failed; route rolled back")
	}
	return b.Binding, nil
}
func (m *Manager) apply(ctx context.Context, old, next diskState) error {
	m.mu.Lock()
	leased := m.leases > 0 || m.job.Running
	m.mu.Unlock()
	if leased {
		return ErrBusy
	}
	var active connectionsSnapshot
	if err := m.core.Request(ctx, "GET", "/connections", nil, &active); err != nil {
		return ErrApply
	}
	if len(active.Connections) > 0 {
		return ErrBusy
	}
	b, err := renderConfig(next, m.controller, m.secret)
	if err != nil {
		return ErrApply
	}
	if err = m.core.Validate(ctx, b); err != nil {
		return ErrApply
	}
	if err = m.core.Apply(ctx, b); err != nil {
		if e := m.rollback(old); e != nil {
			return e
		}
		return ErrApply
	}
	nodes, err := m.readNodes(ctx, next)
	if err == nil {
		err = m.selectBindings(ctx, next)
		if err == nil {
			err = m.verifyBindings(ctx, next)
		}
	}
	// Carry latency history into the candidate state before persisting it.
	// Persisting first would silently drop the history on every subscription
	// refresh or binding update, so a restart would lose the chart samples.
	if err == nil {
		next.NodeHistory = make(map[string][]History, len(nodes))
		for id, n := range nodes {
			if h := old.NodeHistory[id]; len(h) > 0 {
				next.NodeHistory[id] = append([]History(nil), h...)
			} else if len(n.History) > 0 {
				next.NodeHistory[id] = append([]History(nil), n.History...)
			}
		}
		err = m.persist(next)
	}
	if err != nil {
		if e := m.rollback(old); e != nil {
			return e
		}
		return ErrApply
	}
	m.mu.Lock()
	for id, n := range nodes {
		if oldNode, ok := m.nodes[id]; ok {
			n.Status = oldNode.Status
			n.DelayMS = oldNode.DelayMS
			n.TestedAt = oldNode.TestedAt
			n.History = oldNode.History
			nodes[id] = n
		}
	}
	m.state = next
	m.nodes = nodes
	m.lastUse = time.Now()
	m.lastError = ""
	m.mu.Unlock()
	return nil
}

func cloneHistoryMap(in map[string][]History) map[string][]History {
	out := make(map[string][]History, len(in))
	for id, h := range in {
		if len(h) == 0 {
			continue
		}
		if len(h) > 10 {
			h = h[len(h)-10:]
		}
		out[id] = append([]History(nil), h...)
	}
	return out
}
func (m *Manager) rollback(s diskState) error {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	b, _ := renderConfig(s, m.controller, m.secret)
	err := m.core.Apply(ctx, b)
	if err == nil {
		err = m.selectBindings(ctx, s)
		if err == nil {
			err = m.verifyBindings(ctx, s)
		}
	}
	if err == nil {
		err = m.persist(s)
	}
	m.mu.Lock()
	m.state = s
	m.mu.Unlock()
	if err != nil {
		_ = m.core.Stop()
		m.mu.Lock()
		m.lastError = ErrRollback.Error()
		m.mu.Unlock()
		return ErrRollback
	}
	nodes, e := m.readNodes(ctx, s)
	if e == nil {
		m.mu.Lock()
		m.nodes = nodes
		m.mu.Unlock()
	}
	return nil
}
func (m *Manager) persist(s diskState) error {
	if m.opts.Demo {
		return nil
	}
	m.persistMu.Lock()
	defer m.persistMu.Unlock()
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(m.opts.Dir, "state.json"), b)
}
func (m *Manager) readNodes(ctx context.Context, s diskState) (map[string]Node, error) {
	result := map[string]Node{}
	for _, p := range s.Providers {
		if !effectiveProviderEnabled(p) {
			continue
		}
		var r struct {
			Proxies []coreNode `json:"proxies"`
		}
		if err := m.core.Request(ctx, "GET", "/providers/proxies/"+url.PathEscape(p.ID), nil, &r); err != nil {
			return nil, err
		}
		if len(r.Proxies) == 0 {
			return nil, errors.New("provider has no usable nodes")
		}
		for _, n := range r.Proxies {
			if len(n.Name) > 512 || n.Name == "" || !allowedNodeType(n.Type) {
				return nil, errors.New("unsupported provider node")
			}
			id := shortHash(p.ID + "\x00" + n.Name)
			if _, ok := result[id]; ok {
				return nil, ErrInvalid
			}
			history := append([]History(nil), s.NodeHistory[id]...)
			if len(history) > 10 {
				history = history[len(history)-10:]
			}
			node := Node{ID: id, Name: n.Name, Type: n.Type, Provider: p.ID, Status: "untested", History: history}
			if len(history) > 0 {
				last := history[len(history)-1]
				if !last.Time.IsZero() {
					tested := last.Time
					node.TestedAt = &tested
					if last.Delay > 0 {
						delay := last.Delay
						node.Status, node.DelayMS = "ok", &delay
					} else if last.Status == "timeout" {
						node.Status = "timeout"
					} else {
						node.Status = "error"
					}
				}
			}
			result[id] = node
			if len(result) > maxNodes {
				return nil, errors.New("node limit exceeded")
			}
		}
	}
	for _, b := range s.Bindings {
		n, ok := result[b.Node]
		if !ok || n.Name != b.Name || n.Provider != b.Provider {
			return nil, errors.New("subscription removes a bound node")
		}
	}
	return result, nil
}
func allowedNodeType(t string) bool {
	switch strings.ToLower(t) {
	case "http", "socks5", "ss", "shadowsocks", "ssr", "shadowsocksr", "vmess", "vless", "trojan", "snell", "hysteria", "hysteria2", "tuic", "wireguard", "ssh", "anytls", "mieru":
		return true
	}
	return false
}
func (m *Manager) verifyBindings(ctx context.Context, s diskState) error {
	// A 204 from /configs is insufficient: native listener errors are logged, not
	// returned. Authenticate every managed local listener before committing.
	if _, ok := m.core.(*nativeCore); !ok {
		return nil
	}
	for _, b := range s.Bindings {
		var group struct {
			Now string   `json:"now"`
			All []string `json:"all"`
		}
		if err := m.core.Request(ctx, "GET", "/proxies/"+url.PathEscape(b.RouteID), nil, &group); err != nil {
			return err
		}
		if group.Now != b.Name {
			return errors.New("route selection mismatch")
		}
		if err := verifyLocalListener(ctx, b); err != nil {
			return err
		}
	}
	return nil
}
func renderConfig(s diskState, controller, secret string) ([]byte, error) {
	providers := map[string]any{}
	names := []string{}
	for _, p := range s.Providers {
		if !effectiveProviderEnabled(p) {
			continue
		}
		names = append(names, p.ID)
		providers[p.ID] = map[string]any{"type": "file", "path": p.File, "interval": 0, "health-check": map[string]any{"enable": false}, "exclude-type": "direct|reject|pass|dns", "override": map[string]any{"additional-prefix": p.ID + "/", "dialer-proxy": "", "interface-name": "", "routing-mark": 0, "udp": false, "tfo": false}}
	}
	groups := []any{}
	if len(names) > 0 {
		groups = append(groups, map[string]any{"name": "inventory", "type": "select", "use": names, "lazy": true})
	}
	listeners := []any{}
	for _, b := range s.Bindings {
		if _, ok := providers[b.Provider]; !ok {
			continue
		}
		groups = append(groups, map[string]any{"name": b.RouteID, "type": "select", "use": names, "lazy": true})
		listeners = append(listeners, map[string]any{"name": b.RouteID, "type": "http", "listen": "127.0.0.1", "port": b.Port, "proxy": b.RouteID, "users": []any{map[string]string{"username": "workbuddy", "password": b.Password}}})
	}
	c := map[string]any{"port": 0, "socks-port": 0, "mixed-port": 0, "redir-port": 0, "tproxy-port": 0, "allow-lan": false, "bind-address": "127.0.0.1", "mode": "rule", "ipv6": false, "log-level": "silent", "external-controller": controller, "secret": secret, "external-controller-cors": map[string]any{"allow-origins": []string{}, "allow-private-network": false}, "external-ui": "", "external-controller-unix": "", "external-controller-pipe": "", "tun": map[string]any{"enable": false}, "dns": map[string]any{"enable": false}, "sniffer": map[string]any{"enable": false}, "profile": map[string]any{"store-selected": false, "store-fake-ip": false}, "find-process-mode": "off", "geodata-mode": false, "geo-auto-update": false, "listeners": listeners, "proxy-providers": providers, "proxy-groups": groups, "rules": []string{"MATCH,REJECT"}}
	return json.Marshal(c)
}
func safeID(s string) bool {
	if len(s) == 0 || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func validState(s diskState) bool {
	if s.Version != 2 || len(s.Providers) > maxProviders || len(s.Bindings) > maxBindings {
		return false
	}
	ids := map[string]bool{}
	enabled := map[string]bool{}
	for _, p := range s.Providers {
		if !safeID(p.ID) || ids[p.ID] || filepath.IsAbs(p.File) || !strings.HasPrefix(filepath.ToSlash(p.File), "providers/") || strings.Contains(p.File, "..") || strings.Contains(p.File, "\\") {
			return false
		}
		ids[p.ID] = true
		if effectiveProviderEnabled(p) {
			enabled[p.ID] = true
		}
	}
	if s.PendingDelete != "" && !ids[s.PendingDelete] {
		return false
	}
	uids := map[string]bool{}
	ports := map[int]bool{}
	for _, b := range s.Bindings {
		if !safeID(b.UID) || uids[b.UID] || ports[b.Port] || !enabled[b.Provider] || b.RouteID != "acct-"+shortHash(b.UID) || b.Port < 1024 || b.Port > 65535 || len(b.Password) != 48 || b.Node != shortHash(b.Provider+"\x00"+b.Name) {
			return false
		}
		uids[b.UID] = true
		ports[b.Port] = true
	}
	return true
}
func shortHash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:12]) }
func randomToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func freeAddress() (string, error) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", errors.New("cannot allocate local meta port")
	}
	defer l.Close()
	return l.Addr().String(), nil
}
func (m *Manager) Close(ctx context.Context) error {
	m.CancelTests()
	select {
	case m.op <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer m.unlock()
	m.mu.Lock()
	leased := m.leases > 0
	m.mu.Unlock()
	if leased {
		return ErrBusy
	}
	if m.core.Alive() {
		var c connectionsSnapshot
		if err := m.core.Request(ctx, "GET", "/connections", nil, &c); err != nil {
			return errors.New("cannot verify sidecar is idle")
		}
		if len(c.Connections) > 0 {
			return ErrBusy
		}
	}
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
	m.cancel()
	m.wg.Wait()
	return m.core.Stop()
}

// The controller version endpoint can become ready before native file providers
// finish asynchronous initialization. Wait on read-only inventory checks before
// admitting account traffic; do not clear bindings or silently use another node.
func (m *Manager) awaitStartupNodes(ctx context.Context, s diskState) (map[string]Node, error) {
	ready, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for {
		nodes, e := m.readNodes(ready, s)
		if e == nil {
			return nodes, nil
		}
		select {
		case <-ready.Done():
			return nil, ready.Err()
		case <-t.C:
		}
	}
}
