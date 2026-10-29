package metacore

import (
	"context"
	"testing"
	"time"
)

func TestTestNodeDoesNotResurrectRemovedNode(t *testing.T) {
	m, core := fixtureManager(t)
	core.delay = 100 * time.Millisecond
	n := Node{ID: "node", Provider: "sub", Name: "fixture"}
	m.mu.Lock()
	m.nodes[n.ID] = n
	m.mu.Unlock()
	done := make(chan struct{})
	go func() { m.testNode(context.Background(), n); close(done) }()
	deadline := time.After(time.Second)
	for {
		core.mu.Lock()
		active := core.active
		core.mu.Unlock()
		if active > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("test did not start")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	m.mu.Lock()
	delete(m.nodes, n.ID)
	m.mu.Unlock()
	<-done
	m.mu.Lock()
	_, exists := m.nodes[n.ID]
	m.mu.Unlock()
	if exists {
		t.Fatal("removed node was recreated by completed test")
	}
}
