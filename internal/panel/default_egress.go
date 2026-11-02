package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/metacore"
)

var defaultEgressMu sync.RWMutex
var currentDefaultNodeID string
var currentDefaultProxyURL string

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

// persistDefaultEgress 将选定的默认出口持久化写回 /etc/workbuddy-local/config.json
func (p *Panel) persistDefaultEgress(nodeID string) {
	cfgPath := "/etc/workbuddy-local/config.json"
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
		if wErr := os.WriteFile(tmpPath, out, 0644); wErr == nil {
			_ = os.Rename(tmpPath, cfgPath)
		}
	}
}

// RestoreDefaultEgress 在服务启动且 Meta 就绪后自动恢复持久化的默认出口
func (p *Panel) RestoreDefaultEgress(ctx context.Context) {
	cfgPath := "/etc/workbuddy-local/config.json"
	raw, err := os.ReadFile(cfgPath)
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
	// 在后台异步尝试恢复绑定
	go func() {
		time.Sleep(1 * time.Second)
		m := p.cfg.Meta
		nodes := m.Nodes().Nodes
		for _, n := range nodes {
			if n.ID == cfg.LoginDefaultNode && n.Status != "timeout" && n.Status != "error" {
				c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				_, _ = m.Bind(c, "system_default_egress", n.ID, func(proxy string) error {
					defaultEgressMu.Lock()
					currentDefaultNodeID = n.ID
					currentDefaultProxyURL = proxy
					defaultEgressMu.Unlock()
					if p.cfg.Upstream != nil {
						p.cfg.Upstream.SetDefaultProxy(proxy)
					}
					_ = setLoginProxy(proxy)
					return nil
				})
				cancel()
				break
			}
		}
	}()
}
