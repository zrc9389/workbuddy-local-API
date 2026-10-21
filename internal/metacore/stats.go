package metacore

import (
	"context"
	"time"
)

type AccountStats struct {
	UID               string `json:"uid"`
	UploadTotal       int64  `json:"upload_total"`
	DownloadTotal     int64  `json:"download_total"`
	UploadSpeed       int64  `json:"upload_speed"`
	DownloadSpeed     int64  `json:"download_speed"`
	ActiveConnections int    `json:"active_connections"`
}
type Stats struct {
	Demo              bool           `json:"demo"`
	Running           bool           `json:"running"`
	UploadTotal       int64          `json:"upload_total"`
	DownloadTotal     int64          `json:"download_total"`
	UploadSpeed       int64          `json:"upload_speed"`
	DownloadSpeed     int64          `json:"download_speed"`
	ActiveConnections int            `json:"active_connections"`
	Estimated         bool           `json:"estimated"`
	Accounts          []AccountStats `json:"accounts"`
	SampledAt         *time.Time     `json:"sampled_at,omitempty"`
}
type connection struct {
	ID       string `json:"id"`
	Upload   int64  `json:"upload"`
	Download int64  `json:"download"`
	Metadata struct {
		InboundName string `json:"inboundName"`
		InboundPort string `json:"inboundPort"`
	} `json:"metadata"`
}
type connectionsSnapshot struct {
	UploadTotal   int64        `json:"uploadTotal"`
	DownloadTotal int64        `json:"downloadTotal"`
	Connections   []connection `json:"connections"`
}

func (m *Manager) Stats() Stats {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.stats
	s.Demo = m.opts.Demo
	s.Running = m.core.Alive()
	s.Accounts = append([]AccountStats{}, s.Accounts...)
	if !s.Running {
		s.UploadSpeed = 0
		s.DownloadSpeed = 0
		s.ActiveConnections = 0
		for i := range s.Accounts {
			s.Accounts[i].UploadSpeed = 0
			s.Accounts[i].DownloadSpeed = 0
			s.Accounts[i].ActiveConnections = 0
		}
	}
	return s
}
func (m *Manager) monitor() {
	defer m.wg.Done()
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-tick.C:
			if !m.core.Alive() {
				continue
			}
			ctx, cancel := context.WithTimeout(m.ctx, 3*time.Second)
			var snapshot connectionsSnapshot
			err := m.core.Request(ctx, "GET", "/connections", nil, &snapshot)
			cancel()
			if err != nil {
				continue
			}
			m.recordStats(snapshot)
			m.maybeIdle(snapshot)
		}
	}
}
func (m *Manager) recordStats(s connectionsSnapshot) {
	now := time.Now().UTC()
	m.mu.Lock()
	defer m.mu.Unlock()
	elapsed := now.Sub(m.lastSample).Seconds()
	if m.lastSample.IsZero() || elapsed <= 0 {
		elapsed = 2
	}
	up := s.UploadTotal - m.lastCoreUpload
	down := s.DownloadTotal - m.lastCoreDownload
	if up < 0 {
		up = s.UploadTotal
	}
	if down < 0 {
		down = s.DownloadTotal
	}
	m.stats.UploadTotal += up
	m.stats.DownloadTotal += down
	m.stats.UploadSpeed = int64(float64(up) / elapsed)
	m.stats.DownloadSpeed = int64(float64(down) / elapsed)
	m.stats.ActiveConnections = len(s.Connections)
	m.stats.Running = true
	m.stats.SampledAt = &now
	m.lastCoreUpload = s.UploadTotal
	m.lastCoreDownload = s.DownloadTotal
	m.lastSample = now
	byUID := map[string]AccountStats{}
	for _, a := range m.stats.Accounts {
		a.ActiveConnections = 0
		a.UploadSpeed = 0
		a.DownloadSpeed = 0
		byUID[a.UID] = a
	}
	routes := map[string]string{}
	for _, b := range m.state.Bindings {
		routes[b.RouteID] = b.UID
		if _, ok := byUID[b.UID]; !ok {
			byUID[b.UID] = AccountStats{UID: b.UID}
		}
	}
	next := map[string]connection{}
	for _, c := range s.Connections {
		next[c.ID] = c
		uid := routes[c.Metadata.InboundName]
		if uid == "" {
			continue
		}
		previous := m.prevConnections[c.ID]
		du := c.Upload - previous.Upload
		dd := c.Download - previous.Download
		if du < 0 {
			du = 0
		}
		if dd < 0 {
			dd = 0
		}
		a := byUID[uid]
		a.UploadTotal += du
		a.DownloadTotal += dd
		a.UploadSpeed += int64(float64(du) / elapsed)
		a.DownloadSpeed += int64(float64(dd) / elapsed)
		a.ActiveConnections++
		byUID[uid] = a
	}
	m.prevConnections = next
	m.stats.Accounts = []AccountStats{}
	for _, b := range m.state.Bindings {
		m.stats.Accounts = append(m.stats.Accounts, byUID[b.UID])
	}
}
func (m *Manager) maybeIdle(s connectionsSnapshot) {
	if len(s.Connections) != 0 {
		return
	}
	if err := m.lock(); err != nil {
		return
	}
	defer m.unlock()
	m.mu.Lock()
	idle := m.leases == 0 && !m.job.Running && time.Since(m.lastUse) > m.opts.IdleTimeout
	m.mu.Unlock()
	if !idle {
		return
	}
	ctx, cancel := context.WithTimeout(m.ctx, 2*time.Second)
	defer cancel()
	var fresh connectionsSnapshot
	if m.core.Request(ctx, "GET", "/connections", nil, &fresh) != nil || len(fresh.Connections) > 0 {
		return
	}
	m.recordStats(fresh)
	_ = m.core.Stop()
}
