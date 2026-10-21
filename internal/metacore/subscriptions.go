package metacore

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

func subscriptionURL(raw string) (*url.URL, error) {
	if len(raw) == 0 || len(raw) > 4096 {
		return nil, ErrInvalid
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" || u.Port() != "" && u.Port() != "443" {
		return nil, errors.New("subscription requires a public HTTPS URL on port 443")
	}
	if strings.ContainsAny(u.Hostname(), "\\%\x00\r\n ") {
		return nil, ErrInvalid
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !publicIP(ip) {
		return nil, errors.New("private subscription address rejected")
	}
	if strings.EqualFold(u.Hostname(), "localhost") || strings.HasSuffix(strings.ToLower(u.Hostname()), ".localhost") {
		return nil, ErrInvalid
	}
	return u, nil
}

var forbiddenNets = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/3"), netip.MustParsePrefix("::/96"), netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"), netip.MustParsePrefix("100::/64"), netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("fe80::/10"), netip.MustParsePrefix("ff00::/8"),
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, p := range forbiddenNets {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}
func publicDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, ErrInvalid
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("subscription DNS failed")
	}
	for _, ip := range ips {
		if !publicIP(ip) {
			return nil, errors.New("subscription DNS resolves to a reserved address")
		}
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	for _, ip := range ips {
		c, e := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if e == nil {
			return c, nil
		}
		if ctx.Err() != nil {
			break
		}
	}
	return nil, errors.New("subscription connection failed")
}
func fetchSubscription(ctx context.Context, raw string) ([]byte, error) {
	u, err := subscriptionURL(raw)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	tr := &http.Transport{Proxy: nil, DialContext: publicDial, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 8 * time.Second, DisableCompression: true, MaxResponseHeaderBytes: 32 << 10}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("redirect limit")
		}
		_, e := subscriptionURL(req.URL.String())
		return e
	}}
	req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	req.Header.Set("User-Agent", "WorkBuddy-Meta/0.2")
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("subscription download failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.ContentLength > maxSubscriptionBytes || resp.Header.Get("Content-Encoding") != "" && resp.Header.Get("Content-Encoding") != "identity" {
		return nil, errors.New("subscription response rejected")
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxSubscriptionBytes+1))
	if err != nil || len(b) == 0 || len(b) > maxSubscriptionBytes {
		return nil, errors.New("subscription exceeds 4 MiB or download failed")
	}
	return b, nil
}
func (m *Manager) AddSubscription(ctx context.Context, raw string) (SubscriptionResult, error) {
	return m.AddSubscriptionNamed(ctx, raw, "")
}

func (m *Manager) AddSubscriptionNamed(ctx context.Context, raw, name string) (SubscriptionResult, error) {
	if m.opts.Demo {
		return SubscriptionResult{}, errors.New("subscriptions disabled in demo mode")
	}
	if name != "" && !validSubscriptionName(name) {
		return SubscriptionResult{}, ErrInvalid
	}
	// URL and all embedded tokens are only used by this downloader, never passed
	// to native provider/config APIs, reflected to clients, or retained on disk.
	if _, err := subscriptionURL(raw); err != nil {
		return SubscriptionResult{}, err
	}
	id := "sub-" + shortHash(raw)
	if name == "" {
		m.mu.Lock()
		for _, p := range m.state.Providers {
			if p.ID == id {
				name = p.Name
				break
			}
		}
		m.mu.Unlock()
		if name == "" {
			name = "订阅 " + shortHash(raw)[:8]
		}
	}
	if err := m.lock(); err != nil {
		return SubscriptionResult{}, err
	}
	defer m.unlock()
	if !m.core.Available() {
		return SubscriptionResult{}, ErrUnavailable
	}
	fetcher := m.fetchURL
	if fetcher == nil {
		fetcher = fetchSubscription
	}
	b, err := fetcher(ctx, raw)
	if err != nil {
		return SubscriptionResult{}, err
	}
	now := time.Now().UTC()
	return m.importLocked(ctx, id, b, provider{ID: id, Name: name, URL: raw, Enabled: true, CreatedAt: now, UpdatedAt: now, LastRefreshAt: now})
}
func (m *Manager) importBytes(ctx context.Context, id string, b []byte) (SubscriptionResult, error) {
	if err := m.lock(); err != nil {
		return SubscriptionResult{}, err
	}
	defer m.unlock()
	return m.importLocked(ctx, id, b)
}
func (m *Manager) importLocked(ctx context.Context, id string, b []byte, details ...provider) (SubscriptionResult, error) {
	if !safeID(id) || len(b) == 0 || len(b) > maxSubscriptionBytes {
		return SubscriptionResult{}, ErrInvalid
	}
	m.mu.Lock()
	busy := m.job.Running
	m.mu.Unlock()
	if busy {
		return SubscriptionResult{}, ErrBusy
	}
	if err := m.ensure(ctx); err != nil {
		return SubscriptionResult{}, err
	}
	old := m.snapshot()
	next := m.snapshot()
	index := -1
	for i, p := range next.Providers {
		if p.ID == id {
			index = i
		}
	}
	if index < 0 && len(next.Providers) >= maxProviders {
		return SubscriptionResult{}, errors.New("subscription limit reached")
	}
	// A file provider invokes Mihomo's genuine YAML / URI / Base64 parser. Raw
	// subscriptions are NEVER merged with the application-owned core config.
	file := "providers/" + id + "-" + shortHash(string(b)) + ".txt"
	path := filepath.Join(m.opts.Dir, filepath.FromSlash(file))
	if _, err := os.Stat(path); os.IsNotExist(err) {
		entries, e := os.ReadDir(filepath.Join(m.opts.Dir, "providers"))
		if e != nil {
			return SubscriptionResult{}, errors.New("cannot inspect provider storage")
		}
		var total int64
		for _, entry := range entries {
			info, e := entry.Info()
			if e != nil {
				return SubscriptionResult{}, errors.New("cannot inspect provider storage")
			}
			total += info.Size()
		}
		if total+int64(len(b)) > maxStoredBytes {
			return SubscriptionResult{}, errors.New("provider storage limit reached; manual maintenance required")
		}
		if err = atomicWrite(path, b); err != nil {
			return SubscriptionResult{}, errors.New("cannot persist provider")
		}
	}
	now := time.Now().UTC()
	p := provider{ID: id, File: file, Name: "订阅 " + id, Enabled: true, CreatedAt: now, UpdatedAt: now, LastRefreshAt: now}
	if len(details) > 0 {
		p = details[0]
		p.ID, p.File = id, file
		p.Enabled = effectiveProviderEnabled(p)
		if index >= 0 {
			previous := next.Providers[index]
			if p.Name == "" {
				p.Name = previous.Name
			}
			if p.URL == "" {
				p.URL = previous.URL
			}
			p.CreatedAt = previous.CreatedAt
		}
		if p.Name == "" {
			p.Name = "订阅 " + id
		}
		if p.CreatedAt.IsZero() {
			p.CreatedAt = now
		}
		p.UpdatedAt, p.LastRefreshAt = now, now
	}
	if index >= 0 {
		p.CreatedAt = next.Providers[index].CreatedAt
	}
	if index >= 0 {
		next.Providers[index] = p
	} else {
		next.Providers = append(next.Providers, p)
	}
	if err := m.apply(ctx, old, next); err != nil {
		return SubscriptionResult{}, err
	}
	count := 0
	for _, n := range m.Nodes().Nodes {
		if n.Provider == id {
			count++
		}
	}
	return SubscriptionResult{OK: true, Provider: id, Nodes: count}, nil
}

func validSubscriptionName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func (m *Manager) subscriptionIndexLocked(id string) int {
	for i, p := range m.state.Providers {
		if p.ID == id {
			return i
		}
	}
	return -1
}

func (m *Manager) bindingCountLocked(providerID string) int {
	count := 0
	for _, b := range m.state.Bindings {
		if b.Provider == providerID {
			count++
		}
	}
	return count
}

func (m *Manager) UpdateSubscription(ctx context.Context, id string, name *string, enabled *bool) (Subscription, error) {
	if !safeID(id) || name == nil && enabled == nil {
		return Subscription{}, ErrInvalid
	}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if !validSubscriptionName(trimmed) {
			return Subscription{}, ErrInvalid
		}
		name = &trimmed
	}
	if err := m.lock(); err != nil {
		return Subscription{}, err
	}
	defer m.unlock()
	index := m.subscriptionIndexLocked(id)
	if index < 0 {
		return Subscription{}, ErrSubscriptionNotFound
	}
	if !m.core.Available() {
		return Subscription{}, ErrUnavailable
	}
	old := m.snapshot()
	next := m.snapshot()
	p := next.Providers[index]
	p.Enabled = effectiveProviderEnabled(old.Providers[index])
	if name != nil {
		p.Name = *name
	}
	enabledChanged := false
	if enabled != nil {
		enabledChanged = p.Enabled != *enabled
		if enabledChanged && !*enabled && m.bindingCountLocked(id) > 0 {
			return Subscription{}, ErrSubscriptionInUse
		}
		p.Enabled = *enabled
	}
	if !enabledChanged {
		p.UpdatedAt = time.Now().UTC()
		next.Providers[index] = p
		if err := m.persist(next); err != nil {
			return Subscription{}, err
		}
		m.mu.Lock()
		m.state = next
		m.mu.Unlock()
		return m.Subscription(id)
	}
	p.UpdatedAt = time.Now().UTC()
	next.Providers[index] = p
	if err := m.ensure(ctx); err != nil {
		return Subscription{}, err
	}
	if err := m.apply(ctx, old, next); err != nil {
		return Subscription{}, err
	}
	return m.Subscription(id)
}

func (m *Manager) Subscription(id string) (Subscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, subscription := range m.subscriptionsLocked() {
		if subscription.ID == id {
			return subscription, nil
		}
	}
	return Subscription{}, ErrSubscriptionNotFound
}

func (m *Manager) RefreshSubscription(ctx context.Context, id string) (SubscriptionResult, error) {
	if !safeID(id) {
		return SubscriptionResult{}, ErrInvalid
	}
	if err := m.lock(); err != nil {
		return SubscriptionResult{}, err
	}
	defer m.unlock()
	index := m.subscriptionIndexLocked(id)
	if index < 0 {
		return SubscriptionResult{}, ErrSubscriptionNotFound
	}
	previous := m.state.Providers[index]
	if previous.URL == "" {
		return SubscriptionResult{}, ErrSubscriptionNoURL
	}
	if !m.core.Available() {
		return SubscriptionResult{}, ErrUnavailable
	}
	fetcher := m.fetchURL
	if fetcher == nil {
		fetcher = fetchSubscription
	}
	b, err := fetcher(ctx, previous.URL)
	if err != nil {
		m.mu.Lock()
		if i := m.subscriptionIndexLocked(id); i >= 0 {
			updated := m.state
			updated.Providers = append([]provider(nil), m.state.Providers...)
			updated.Bindings = append([]bindingRecord(nil), m.state.Bindings...)
			updated.Providers[i].LastError = err.Error()
			updated.Providers[i].UpdatedAt = time.Now().UTC()
			_ = m.persist(updated)
			m.state = updated
		}
		m.mu.Unlock()
		return SubscriptionResult{}, err
	}
	previous.Enabled = effectiveProviderEnabled(previous)
	previous.LastError = ""
	result, err := m.importLocked(ctx, id, b, previous)
	if err != nil {
		return SubscriptionResult{}, err
	}
	if !previous.Enabled {
		count := 0
		for _, n := range m.Nodes().Nodes {
			if n.Provider == id {
				count++
			}
		}
		result.Nodes = count
	}
	m.mu.Lock()
	updatedFile := ""
	if index := m.subscriptionIndexLocked(id); index >= 0 {
		updatedFile = m.state.Providers[index].File
	}
	m.mu.Unlock()
	if previous.File != "" && previous.File != updatedFile {
		m.removeProviderFile(previous.File, id)
	}
	return result, nil
}

func (m *Manager) RemoveSubscription(ctx context.Context, id string) error {
	if !safeID(id) {
		return ErrInvalid
	}
	if err := m.lock(); err != nil {
		return err
	}
	defer m.unlock()
	index := m.subscriptionIndexLocked(id)
	if index < 0 {
		return ErrSubscriptionNotFound
	}
	if m.bindingCountLocked(id) > 0 {
		return ErrSubscriptionInUse
	}
	if !m.core.Available() {
		return ErrUnavailable
	}
	old := m.snapshot()
	next := m.snapshot()
	next.Providers = append(next.Providers[:index], next.Providers[index+1:]...)
	if err := m.ensure(ctx); err != nil {
		return err
	}
	if err := m.apply(ctx, old, next); err != nil {
		return err
	}
	m.removeProviderFile(old.Providers[index].File, id)
	m.mu.Lock()
	remaining := make(map[string]Node, len(m.nodes))
	for nodeID, node := range m.nodes {
		if node.Provider != id {
			remaining[nodeID] = node
		}
	}
	m.nodes = remaining
	m.mu.Unlock()
	return nil
}

func (m *Manager) removeProviderFile(file, providerID string) {
	if file == "" {
		return
	}
	m.mu.Lock()
	dir := m.opts.Dir
	m.mu.Unlock()
	prefix := "providers/" + providerID + "-"
	if !strings.HasPrefix(filepath.ToSlash(file), prefix) || strings.Contains(file, "..") {
		return
	}
	if err := os.Remove(filepath.Join(dir, filepath.FromSlash(file))); err != nil && !os.IsNotExist(err) {
		return
	}
}

func (m *Manager) SubscriptionURL(id string) (string, error) {
	if !safeID(id) {
		return "", ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.state.Providers {
		if p.ID != id {
			continue
		}
		if p.URL == "" {
			return "", ErrSubscriptionNoURL
		}
		return p.URL, nil
	}
	return "", ErrSubscriptionNotFound
}
func atomicWrite(path string, b []byte) error {
	tmp := path + ".pending"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
func readBoundedFile(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, errors.New("file limit exceeded")
	}
	return b, nil
}
func decodeBounded(r io.Reader, out any) error {
	b, err := io.ReadAll(io.LimitReader(r, 8<<20+1))
	if err != nil || len(b) > 8<<20 {
		return errors.New("controller response exceeds limit")
	}
	return json.Unmarshal(b, out)
}
