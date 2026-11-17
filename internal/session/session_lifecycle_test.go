package session

import (
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/redisstore"
)

// TestSessionExplicitMaxTurnsReassign 验证改造 3：显式会话轮数上限
// 达到 MaxTurns 后自动解绑并重新分配。
func TestSessionExplicitMaxTurnsReassign(t *testing.T) {
	st := redisstore.Noop{}
	avail := []string{"u1", "u2"}

	// 配置最大轮数上限为 3 轮
	r := New(Config{
		TTL:        time.Hour,
		MaxTurns:   3,
		Store:      st,
		Available:  func() []string { return avail },
	})

	key := "conv-12345"

	// 轮数 1
	got1, ok := r.Resolve(key)
	if !ok {
		t.Fatalf("turn 1: expected ok")
	}

	// 轮数 2
	got2, ok := r.Resolve(key)
	if !ok || got2 != got1 {
		t.Fatalf("turn 2: expected %s, got %s", got1, got2)
	}

	// 轮数 3
	got3, ok := r.Resolve(key)
	if !ok || got3 != got1 {
		t.Fatalf("turn 3: expected %s, got %s", got1, got3)
	}

	// 检查内部状态
	r.mu.RLock()
	e := r.entries[key]
	r.mu.RUnlock()
	if e.turns != 3 {
		t.Fatalf("expected turns=3, got %d", e.turns)
	}

	// 轮数 4: 此时已达到 MaxTurns=3，必须触发解绑重分配，turns 重置为 1
	got4, ok := r.Resolve(key)
	if !ok {
		t.Fatalf("turn 4: expected ok, got false")
	}

	r.mu.RLock()
	e4 := r.entries[key]
	r.mu.RUnlock()
	if e4.turns != 1 {
		t.Fatalf("expected turns to reset to 1 after unbind, got %d", e4.turns)
	}
	_ = got4
}

// TestSessionDerivedKeyMaxTurnsAndTTL 验证改造 3：派生兜底会话 (d- 前缀)
// 收敛轮数上限 (MaxDerivedTurns) 与更短的 DerivedTTL。
func TestSessionDerivedKeyMaxTurnsAndTTL(t *testing.T) {
	st := redisstore.Noop{}
	avail := []string{"u1", "u2"}

	r := New(Config{
		TTL:             time.Hour,
		DerivedTTL:      50 * time.Millisecond,
		MaxTurns:        10,
		MaxDerivedTurns: 2,
		Store:           st,
		Available:       func() []string { return avail },
	})

	derivedKey := "d-0123456789abcdef"

	// 第 1 轮
	_, ok := r.Resolve(derivedKey)
	if !ok {
		t.Fatal("turn 1 failed")
	}

	// 第 2 轮
	_, ok = r.Resolve(derivedKey)
	if !ok {
		t.Fatal("turn 2 failed")
	}

	r.mu.RLock()
	e := r.entries[derivedKey]
	r.mu.RUnlock()
	if e.turns != 2 {
		t.Fatalf("expected turns=2, got %d", e.turns)
	}

	// 第 3 轮：达到 MaxDerivedTurns=2，触发重选
	_, ok = r.Resolve(derivedKey)
	if !ok {
		t.Fatal("turn 3 failed")
	}

	r.mu.RLock()
	e3 := r.entries[derivedKey]
	r.mu.RUnlock()
	if e3.turns != 1 {
		t.Fatalf("expected turns reset to 1, got %d", e3.turns)
	}

	// 验证 DerivedTTL 较短过期机制
	ttlKey := "d-ttl-expiry-test"
	r.Resolve(ttlKey)

	// 等待超过 DerivedTTL (50ms)
	time.Sleep(65 * time.Millisecond)

	// 快路径判定过期，落入慢路径重分配
	r.mu.RLock()
	expiredEntry := r.entries[ttlKey]
	r.mu.RUnlock()
	if !expired(expiredEntry, time.Now(), 50*time.Millisecond) {
		t.Fatalf("expected derived entry to be expired after 65ms")
	}

	_, ok = r.Resolve(ttlKey)
	if !ok {
		t.Fatal("resolve after DerivedTTL expiry should succeed")
	}
}

// TestSessionPickBestSWRRIntegration 验证改造 3：首次选号接入 SWRR
func TestSessionPickBestSWRRIntegration(t *testing.T) {
	st := redisstore.Noop{}
	avail := []string{"low-credit", "high-credit"}

	calledModel := ""
	calledCandidates := []string{}

	r := New(Config{
		TTL:       time.Hour,
		Store:     st,
		Available: func() []string { return avail },
		AvailableForModel: func(model string) []string {
			return avail
		},
		PickBest: func(model string, candidates []string) string {
			calledModel = model
			calledCandidates = candidates
			return "high-credit" // SWRR 策略返回高余额账号
		},
	})

	got, ok := r.ResolveForModel("new-session-key", "glm-5.2")
	if !ok {
		t.Fatal("expected ok")
	}
	if got != "high-credit" {
		t.Fatalf("expected high-credit picked via PickBest SWRR, got %s", got)
	}
	if calledModel != "glm-5.2" {
		t.Fatalf("expected model passed to PickBest, got %s", calledModel)
	}
	if len(calledCandidates) == 0 {
		t.Fatalf("expected candidates passed to PickBest")
	}
}
