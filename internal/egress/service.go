// Package egress owns bounded manual public-IP probes and read-only account grouping.
// It never sends credentials to the probe endpoint and never launches background probes.
package egress

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrBusy = errors.New("egress probe capacity reached")

type Doer interface {
	DoAccount(*http.Request, *auth.Auth) (*http.Response, error)
}
type Options struct {
	Endpoint                              string
	Timeout                               time.Duration
	MaxConcurrent, MaxCached, MaxAccounts int
	TTL                                   time.Duration
}
type Result struct {
	UID       string    `json:"uid"`
	Mode      string    `json:"mode"`
	Proxy     string    `json:"proxy,omitempty"`
	ConfigKey string    `json:"config_key"`
	IP        string    `json:"ip,omitempty"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	CheckedAt time.Time `json:"checked_at,omitempty"`
}
type Group struct {
	Key   string   `json:"key"`
	IP    string   `json:"ip,omitempty"`
	Count int      `json:"count"`
	UIDs  []string `json:"uids"`
}
type Matrix struct {
	Accounts  []Result `json:"accounts"`
	Groups    []Group  `json:"groups"`
	Truncated bool     `json:"truncated"`
}
type cachedResult struct {
	result    Result
	proxyHash [32]byte
}
type Service struct {
	mu      sync.Mutex
	opts    Options
	slots   chan struct{}
	results map[*auth.Auth]cachedResult
	active  map[*auth.Auth]bool
}

func New(o Options) *Service {
	if o.Endpoint == "" {
		o.Endpoint = "https://api.ipify.org?format=json"
	}
	if o.Timeout <= 0 {
		o.Timeout = 5 * time.Second
	}
	if o.Timeout > 15*time.Second {
		o.Timeout = 15 * time.Second
	}
	if o.TTL <= 0 || o.TTL > time.Hour {
		o.TTL = 10 * time.Minute
	}
	if o.MaxConcurrent < 1 {
		o.MaxConcurrent = 4
	}
	if o.MaxConcurrent > 8 {
		o.MaxConcurrent = 8
	}
	if o.MaxCached < 1 {
		o.MaxCached = 256
	}
	if o.MaxCached > 1024 {
		o.MaxCached = 1024
	}
	if o.MaxAccounts < 1 {
		o.MaxAccounts = 1000
	}
	if o.MaxAccounts > 10000 {
		o.MaxAccounts = 10000
	}
	return &Service{opts: o, slots: make(chan struct{}, o.MaxConcurrent), results: make(map[*auth.Auth]cachedResult), active: make(map[*auth.Auth]bool)}
}
func describe(a *auth.Auth, raw string) Result {
	r := Result{UID: a.UID, Mode: "direct", ConfigKey: "direct", Status: "not_probed"}
	if raw != "" {
		r.Mode = "proxy"
		sum := sha256.Sum256([]byte(raw))
		r.ConfigKey = "proxy-" + hex.EncodeToString(sum[:8])
		if auth.ValidateProxyURL(raw) == nil {
			u, _ := url.Parse(raw)
			u.User = nil
			r.Proxy = u.String()
		} else {
			r.Status = "invalid_proxy"
		}
	}
	return r
}

// Probe is explicitly invoked for one account, bounded in concurrency, duration and body size.
func (s *Service) Probe(ctx context.Context, d Doer, a *auth.Auth) (Result, error) {
	if a == nil || d == nil {
		return Result{}, errors.New("account or upstream unavailable")
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return Result{}, ErrBusy
	}
	s.mu.Lock()
	if s.active[a] {
		s.mu.Unlock()
		return Result{}, ErrBusy
	}
	s.active[a] = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.active, a); s.mu.Unlock() }()
	raw := a.ProxyURLValue()
	r := describe(a, raw)
	r.CheckedAt = time.Now().UTC()
	ctx, cancel := context.WithTimeout(ctx, s.opts.Timeout)
	defer cancel()
	var probeErr error
	if auth.ValidateProxyURL(raw) != nil {
		probeErr = errors.New("invalid proxy configuration")
	} else {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.opts.Endpoint, nil)
		if err != nil {
			probeErr = errors.New("invalid probe endpoint")
		} else {
			req.Header.Set("Accept", "application/json, text/plain")
			resp, err := d.DoAccount(req, a)
			if err != nil {
				if ctx.Err() != nil {
					probeErr = ctx.Err()
				} else {
					probeErr = errors.New("egress probe connection failed")
				}
			} else if resp == nil || resp.Body == nil {
				probeErr = errors.New("empty egress probe response")
			} else {
				body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4097))
				resp.Body.Close()
				if readErr != nil || len(body) > 4096 || resp.StatusCode != http.StatusOK {
					probeErr = errors.New("invalid egress probe response")
				} else {
					ipText := strings.TrimSpace(string(body))
					if strings.HasPrefix(ipText, "{") {
						var v struct {
							IP string `json:"ip"`
						}
						if json.Unmarshal(body, &v) == nil {
							ipText = v.IP
						}
					}
					ip := net.ParseIP(strings.TrimSpace(ipText))
					if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() {
						probeErr = errors.New("probe returned no public IP")
					} else {
						r.IP = ip.String()
					}
				}
			}
		}
	}
	if ctx.Err() != nil {
		probeErr = ctx.Err()
	}
	if probeErr != nil {
		r.Status = "error"
		r.Error = probeErr.Error()
	} else {
		r.Status = "ok"
	}
	// Never publish a result for an account whose routing changed during the request.
	if a.ProxyURLValue() != raw {
		return Result{}, errors.New("account proxy changed during probe")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for key, v := range s.results {
		if now.Sub(v.result.CheckedAt) > s.opts.TTL {
			delete(s.results, key)
		}
	}
	if _, ok := s.results[a]; !ok && len(s.results) >= s.opts.MaxCached {
		var oldest *auth.Auth
		var at time.Time
		for key, v := range s.results {
			if at.IsZero() || v.result.CheckedAt.Before(at) {
				oldest = key
				at = v.result.CheckedAt
			}
		}
		delete(s.results, oldest)
	}
	s.results[a] = cachedResult{r, sha256.Sum256([]byte(raw))}
	return r, probeErr
}
func (s *Service) Forget(a *auth.Auth) { s.mu.Lock(); delete(s.results, a); s.mu.Unlock() }

// Matrix never performs network I/O. Unknown/stale routes group by configuration;
// fresh successful probes group by observed public IP (not a claim of permanent identity).
func (s *Service) Matrix(accounts []*auth.Auth) Matrix {
	out := Matrix{Accounts: []Result{}, Groups: []Group{}}
	if len(accounts) > s.opts.MaxAccounts {
		accounts = accounts[:s.opts.MaxAccounts]
		out.Truncated = true
	}
	groups := make(map[string]*Group)
	now := time.Now()
	for _, a := range accounts {
		if a == nil {
			continue
		}
		raw := a.ProxyURLValue()
		r := describe(a, raw)
		s.mu.Lock()
		v, ok := s.results[a]
		s.mu.Unlock()
		if ok && v.proxyHash == sha256.Sum256([]byte(raw)) && now.Sub(v.result.CheckedAt) <= s.opts.TTL {
			r = v.result
		}
		out.Accounts = append(out.Accounts, r)
		key := r.ConfigKey
		if r.Status == "ok" && r.IP != "" {
			key = "ip-" + r.IP
		}
		g := groups[key]
		if g == nil {
			g = &Group{Key: key, IP: r.IP, UIDs: []string{}}
			groups[key] = g
		}
		g.Count++
		g.UIDs = append(g.UIDs, r.UID)
	}
	sort.Slice(out.Accounts, func(i, j int) bool { return out.Accounts[i].UID < out.Accounts[j].UID })
	for _, g := range groups {
		sort.Strings(g.UIDs)
		out.Groups = append(out.Groups, *g)
	}
	sort.Slice(out.Groups, func(i, j int) bool { return out.Groups[i].Key < out.Groups[j].Key })
	return out
}
