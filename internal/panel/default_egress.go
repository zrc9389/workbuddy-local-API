package panel

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
)

var defaultEgressMu sync.RWMutex
var defaultEgressFallbackSaveMu sync.Mutex
var currentDefaultNodeID string
var currentDefaultProxyURL string

// restoreDefaultEgressBackoffs 控制启动恢复默认出口的有界退避重试节奏（测试可覆写缩短）。
var restoreDefaultEgressBackoffs = []time.Duration{
	500 * time.Millisecond,
	1 * time.Second,
	2 * time.Second,
	4 * time.Second,
	8 * time.Second,
	15 * time.Second,
}

// DefaultEgressInfo 状态载荷
type DefaultEgressInfo struct {
	OK       bool   `json:"ok"`
	NodeID   string `json:"node_id"`
	NodeName string `json:"node_name"`
	ProxyURL string `json:"proxy_url,omitempty"`
}

func (p *Panel) GetDefaultEgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	defaultEgressMu.RLock()
	nodeID := currentDefaultNodeID
	defaultEgressMu.RUnlock()

	nodeName := ""
	if nodeID != "" && p.cfg.Meta != nil {
		nodes := p.cfg.Meta.Nodes().Nodes
		for _, n := range nodes {
			if n.ID == nodeID {
				nodeName = n.Name
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"node_id":   nodeID,
		"node_name": nodeName,
	})
}

func (p *Panel) SetDefaultEgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	m := p.metaManager(w)
	if m == nil {
		return
	}
	var v struct {
		Node string `json:"node"`
	}
	if decodeSingleJSON(w, r, 1024, &v) != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	// 1. 若传空：解绑默认出口
	if v.Node == "" {
		defaultEgressMu.Lock()
		currentDefaultNodeID = ""
		currentDefaultProxyURL = ""
		defaultEgressMu.Unlock()

		if p.cfg.Upstream != nil {
			p.cfg.Upstream.SetDefaultProxy("")
		}
		_ = setLoginProxy("")
		p.persistDefaultEgress("")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node_id": ""})
		return
	}

	// 2. 校验节点有效性与超时状态（杜绝向超时节点绑定）
	nodes := m.Nodes().Nodes
	var target *metacore.Node
	for i := range nodes {
		if nodes[i].ID == v.Node {
			target = &nodes[i]
			break
		}
	}
	if target == nil {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	if target.Status == "timeout" || target.Status == "error" {
		writeErr(w, http.StatusBadRequest, "节点处于超时或异常状态，不可作为默认出口")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()

	// 3. 复用 Mihomo 管理器，为系统专用标识 system_default_egress 绑定出口端口
	b, err := m.Bind(ctx, "system_default_egress", v.Node, func(proxy string) error {
		defaultEgressMu.Lock()
		currentDefaultNodeID = v.Node
		currentDefaultProxyURL = proxy
		defaultEgressMu.Unlock()

		if p.cfg.Upstream != nil {
			p.cfg.Upstream.SetDefaultProxy(proxy)
		}
		_ = setLoginProxy(proxy)
		p.persistDefaultEgress(v.Node)
		return nil
	})
	if err != nil {
		metaError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"node_id":   v.Node,
		"node_name": target.Name,
		"binding":   b,
	})
}

// persistDefaultEgress 将选定的默认出口持久化写回 config.json，与 cmd/server/main.go 共享 ConfigSaveMu 互斥锁。
func (p *Panel) persistDefaultEgress(nodeID string) {
	mu := p.cfg.ConfigSaveMu
	if mu == nil {
		mu = &defaultEgressFallbackSaveMu
	}
	mu.Lock()
	defer mu.Unlock()

	cfgPath := p.cfg.ConfigPath
	if cfgPath == "" {
		cfgPath = "/etc/workbuddy-local/config.json"
	}
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		return
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return
	}
	if nodeID == "" {
		delete(cfg, "login_default_node")
	} else {
		cfg["login_default_node"] = nodeID
	}
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err == nil {
		tmpPath := cfgPath + ".tmp"
		if wErr := os.WriteFile(tmpPath, out, 0600); wErr == nil {
			_ = os.Rename(tmpPath, cfgPath)
		}
	}
}

// RestoreDefaultEgress 在服务启动且 Meta 就绪后以有界退避重试自动恢复持久化的默认出口。
func (p *Panel) RestoreDefaultEgress(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	cfgPath := p.cfg.ConfigPath
	if cfgPath == "" {
		cfgPath = "/etc/workbuddy-local/config.json"
	}
	mu := p.cfg.ConfigSaveMu
	if mu == nil {
		mu = &defaultEgressFallbackSaveMu
	}
	mu.Lock()
	raw, err := os.ReadFile(cfgPath)
	mu.Unlock()
	if err != nil {
		return
	}
	var cfg struct {
		LoginDefaultNode string `json:"login_default_node"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil || cfg.LoginDefaultNode == "" {
		return
	}
	if p.cfg.Meta == nil {
		return
	}
	// 在后台异步以有界退避重试恢复绑定，等待 Meta 节点列表就绪且不覆盖人工新配置。
	go func() {
		m := p.cfg.Meta
		for attempt, wait := range restoreDefaultEgressBackoffs {
			if wait > 0 {
				timer := time.NewTimer(wait)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}
			// 若期间用户已手动指定默认出口，则停止自动恢复，避免覆盖人工选择。
			defaultEgressMu.RLock()
			alreadySet := currentDefaultNodeID != ""
			defaultEgressMu.RUnlock()
			if alreadySet {
				return
			}
			nodes := m.Nodes().Nodes
			var matched *metacore.Node
			for i := range nodes {
				if nodes[i].ID == cfg.LoginDefaultNode {
					matched = &nodes[i]
					break
				}
			}
			if matched == nil || matched.Status == "timeout" || matched.Status == "error" {
				continue
			}
			c, cancel := context.WithTimeout(ctx, 30*time.Second)
			_, bindErr := m.Bind(c, "system_default_egress", matched.ID, func(proxy string) error {
				defaultEgressMu.Lock()
				currentDefaultNodeID = matched.ID
				currentDefaultProxyURL = proxy
				defaultEgressMu.Unlock()
				if p.cfg.Upstream != nil {
					p.cfg.Upstream.SetDefaultProxy(proxy)
				}
				_ = setLoginProxy(proxy)
				return nil
			})
			cancel()
			if bindErr == nil {
				return
			}
			if attempt == len(restoreDefaultEgressBackoffs)-1 {
				log.Printf("WARN: [panel] restore default egress node=%s exhausted retries: %v", cfg.LoginDefaultNode, bindErr)
			}
		}
	}()
}
