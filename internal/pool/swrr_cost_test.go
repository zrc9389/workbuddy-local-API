package pool

import (
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

// TestFractionalCostAccumulator 验证改造 1：小数扣费累加器
// 连续 20 次 0.2 积分扣费能真实累计扣除 4 点整数 credits，
// 且在 SetCredits 同步回读时 creditFrac 会被清零重置。
func TestFractionalCostAccumulator(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.SetCredits("u1", 100, 100)

	// 连续 20 次 0.2 积分扣费
	for i := 0; i < 20; i++ {
		p.NoteModelCost("u1", "test-model", 0.2, 500)
	}

	p.mu.Lock()
	e := p.byUID["u1"]
	credits := e.credits
	frac := e.creditFrac
	p.mu.Unlock()

	// 20 * 0.2 = 4.0，credits 应从 100 降为 96
	if credits != 96 {
		t.Fatalf("expected credits=96 after 20*0.2 deduction, got %d", credits)
	}
	if frac > 0.0001 || frac < -0.0001 {
		t.Fatalf("expected creditFrac ~= 0, got %f", frac)
	}

	// 单次 0.3 扣费：不足 1.0，credits 仍为 96，frac 累加至 0.3
	p.NoteModelCost("u1", "test-model", 0.3, 500)
	p.mu.Lock()
	credits = e.credits
	frac = e.creditFrac
	p.mu.Unlock()

	if credits != 96 {
		t.Fatalf("expected credits=96 after 0.3 deduction, got %d", credits)
	}
	if frac < 0.29 || frac > 0.31 {
		t.Fatalf("expected creditFrac ~= 0.3, got %f", frac)
	}

	// SetCredits 远程回读同步余额，creditFrac 应清零
	p.SetCredits("u1", 200, 200)
	p.mu.Lock()
	credits = e.credits
	frac = e.creditFrac
	p.mu.Unlock()

	if credits != 200 {
		t.Fatalf("expected credits=200, got %d", credits)
	}
	if frac != 0 {
		t.Fatalf("expected creditFrac=0 after SetCredits, got %f", frac)
	}

	// 跨过整数边界测试：0.8 + 0.4 = 1.2 -> 扣除 1 点，剩余 0.2
	p.NoteModelCost("u1", "test-model", 0.8, 500)
	p.NoteModelCost("u1", "test-model", 0.4, 500)
	p.mu.Lock()
	credits = e.credits
	frac = e.creditFrac
	p.mu.Unlock()

	if credits != 199 {
		t.Fatalf("expected credits=199 after 0.8+0.4=1.2 deduction, got %d", credits)
	}
	if frac < 0.19 || frac > 0.21 {
		t.Fatalf("expected creditFrac ~= 0.2, got %f", frac)
	}
}

// TestSWRRSmoothRoundRobinDistribution 验证改造 2：Nginx SWRR 平滑加权轮询
// 模拟高低余额账号池在 >1s 正常请求间隔下，高余额账号稳定按权重比例平滑命中，
// 不出现单号连续突发连击且最高余额账号吃零蛋的现象。
func TestSWRRSmoothRoundRobinDistribution(t *testing.T) {
	p := New("")
	// 账号 A: 2000 积分；账号 B: 1000 积分；账号 C: 1000 积分
	p.Add(&auth.Auth{UID: "acct-high"})
	p.Add(&auth.Auth{UID: "acct-mid1"})
	p.Add(&auth.Auth{UID: "acct-mid2"})

	p.SetCredits("acct-high", 2000, 2000)
	p.SetCredits("acct-mid1", 1000, 1000)
	p.SetCredits("acct-mid2", 1000, 1000)

	counts := map[string]int{}
	var history []string

	// 连续调度 46 次请求，模拟正常业务请求（每次请求间隔 > 1s）
	const rounds = 46
	for i := 0; i < rounds; i++ {
		// 模拟请求到达时距上次调用已超过 1.5 秒（消除秒级冷却衰减影响）
		p.mu.Lock()
		for _, e := range p.byUID {
			if !e.lastUsed.IsZero() {
				e.lastUsed = e.lastUsed.Add(-2 * time.Second)
			}
		}
		p.mu.Unlock()

		got := p.Pick()
		if got == nil {
			t.Fatalf("round %d: Pick returned nil", i)
		}
		counts[got.UID]++
		history = append(history, got.UID)
	}

	t.Logf("SWRR pick counts: %v", counts)

	// 1. 最高余额账号必须获得最多配额且绝不能吃零蛋
	if counts["acct-high"] == 0 {
		t.Fatalf("acct-high got 0 picks! starved!")
	}
	if counts["acct-high"] < counts["acct-mid1"] || counts["acct-high"] < counts["acct-mid2"] {
		t.Fatalf("acct-high (%d) should get more picks than mid accounts (%d, %d)",
			counts["acct-high"], counts["acct-mid1"], counts["acct-mid2"])
	}

	// 2. 中等余额账号也必须得到合理服务，不能被饿死
	if counts["acct-mid1"] == 0 || counts["acct-mid2"] == 0 {
		t.Fatalf("mid accounts starved: %v", counts)
	}

	// 3. 平滑性检查：同一账号在 SWRR 下不应出现连续超过 2 次的爆发式连击
	maxStreak := 1
	currentStreak := 1
	for i := 1; i < len(history); i++ {
		if history[i] == history[i-1] {
			currentStreak++
			if currentStreak > maxStreak {
				maxStreak = currentStreak
			}
		} else {
			currentStreak = 1
		}
	}
	if maxStreak > 2 {
		t.Fatalf("detected un-smooth consecutive streak of %d picks for account %v in sequence: %v",
			maxStreak, history, counts)
	}
}
