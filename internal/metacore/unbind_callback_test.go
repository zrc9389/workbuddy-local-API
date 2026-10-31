package metacore

import (
	"context"
	"testing"
	"time"
)

func TestSubscriptionDisableAndRemoveTriggersUnbind(t *testing.T) {
	unbound := make(map[string]int)
	m, _ := seededSubscriptions(t, 2)
	m.opts.OnUnbind = func(uid string) error {
		unbound[uid]++
		return nil
	}

	first := m.Subscriptions()[0]
	var node Node
	for _, candidate := range m.Nodes().Nodes {
		if candidate.Provider == first.ID {
			node = candidate
			break
		}
	}
	if node.ID == "" {
		t.Fatal("no node for first subscription")
	}
	if _, err := m.Bind(context.Background(), "acct-1", node.ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}

	// 1. 停用订阅：不能返回 in-use，必须触发 OnUnbind
	disabled := false
	updated, err := m.UpdateSubscription(context.Background(), first.ID, nil, &disabled)
	if err != nil || updated.Enabled {
		t.Fatalf("disable subscription failed: %v", err)
	}
	if unbound["acct-1"] != 1 {
		t.Fatalf("expected OnUnbind called once on disable, got %d", unbound["acct-1"])
	}

	// 2. 重新启用并再次绑定
	enabled := true
	if _, err := m.UpdateSubscription(context.Background(), first.ID, nil, &enabled); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Bind(context.Background(), "acct-1", node.ID, func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}

	// 3. 删除订阅：不能返回 in-use，必须触发 OnUnbind 且节点清除
	if err := m.RemoveSubscription(context.Background(), first.ID); err != nil {
		t.Fatalf("remove subscription failed: %v", err)
	}
	if unbound["acct-1"] != 2 {
		t.Fatalf("expected OnUnbind called again on remove, got %d", unbound["acct-1"])
	}
	for _, n := range m.Nodes().Nodes {
		if n.Provider == first.ID {
			t.Fatal("nodes of removed subscription must be cleared")
		}
	}
}

func TestNodeHistoryRetainsRecent7(t *testing.T) {
	m, _ := seededSubscriptions(t, 1)
	nodeID := m.Nodes().Nodes[0].ID

	m.mu.Lock()
	n := m.nodes[nodeID]
	for i := 0; i < 15; i++ {
		n.History = append(n.History, History{Delay: i * 10, Time: time.Now()})
		if len(n.History) > 7 {
			n.History = append([]History{}, n.History[len(n.History)-7:]...)
		}
	}
	m.nodes[nodeID] = n
	m.mu.Unlock()

	res := m.Nodes()
	var checked *Node
	for i := range res.Nodes {
		if res.Nodes[i].ID == nodeID {
			checked = &res.Nodes[i]
			break
		}
	}
	if checked == nil || len(checked.History) != 7 {
		t.Fatalf("node history length = %d, want 7", len(checked.History))
	}
	if checked.History[6].Delay != 140 {
		t.Fatalf("latest history delay = %d, want 140", checked.History[6].Delay)
	}
}
