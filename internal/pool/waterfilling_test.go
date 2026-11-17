package pool

import (
	"testing"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

// TestWaterFillingSWRRScheduling 验证水位均衡填平（Water-Filling）与单号 3 并发硬上限：
// 1. 2 个账号各 3 并发下连续 6 次请求严格按 1:1 -> 2:2 -> 3:3 阶梯均匀摊满；
// 2. 满载 6 并发后，第 7 次选号返回 nil（上游 503 保护）；
// 3. 释放 1 次租约后，空出的账号可再次被成功选出。
func TestWaterFillingSWRRScheduling(t *testing.T) {
	p := New("")
	p.SetMaxInFlight(3)

	p.Add(&auth.Auth{UID: "u1"})
	p.Add(&auth.Auth{UID: "u2"})
	p.SetCredits("u1", 2000, 2000)
	p.SetCredits("u2", 2000, 2000)

	// 第 1 轮（第 1 次与第 2 次）：各选 1 个，达到 1:1
	a1 := p.Pick()
	if a1 == nil {
		t.Fatalf("step 1: expected candidate, got nil")
	}
	if !p.Acquire(a1.UID) {
		t.Fatalf("step 1: failed to acquire %s", a1.UID)
	}

	a2 := p.Pick()
	if a2 == nil {
		t.Fatalf("step 2: expected candidate, got nil")
	}
	if a2.UID == a1.UID {
		t.Fatalf("step 2: expected water-filling to pick different account, got duplicate %s", a2.UID)
	}
	if !p.Acquire(a2.UID) {
		t.Fatalf("step 2: failed to acquire %s", a2.UID)
	}

	// 校验当前在途：各 1 个 (1:1)
	inf1, _ := p.InFlightOf("u1")
	inf2, _ := p.InFlightOf("u2")
	if inf1 != 1 || inf2 != 1 {
		t.Fatalf("expected 1:1 in-flight, got u1=%d, u2=%d", inf1, inf2)
	}

	// 第 2 轮（第 3 次与第 4 次）：各再选 1 个，达到 2:2
	a3 := p.Pick()
	if a3 == nil {
		t.Fatalf("step 3: expected candidate, got nil")
	}
	if !p.Acquire(a3.UID) {
		t.Fatalf("step 3: failed to acquire %s", a3.UID)
	}

	a4 := p.Pick()
	if a4 == nil {
		t.Fatalf("step 4: expected candidate, got nil")
	}
	if a4.UID == a3.UID {
		t.Fatalf("step 4: expected water-filling to pick different account, got duplicate %s", a4.UID)
	}
	if !p.Acquire(a4.UID) {
		t.Fatalf("step 4: failed to acquire %s", a4.UID)
	}

	// 校验当前在途：各 2 个 (2:2)
	inf1, _ = p.InFlightOf("u1")
	inf2, _ = p.InFlightOf("u2")
	if inf1 != 2 || inf2 != 2 {
		t.Fatalf("expected 2:2 in-flight, got u1=%d, u2=%d", inf1, inf2)
	}

	// 第 3 轮（第 5 次与第 6 次）：各再选 1 个，达到 3:3 打满
	a5 := p.Pick()
	if a5 == nil {
		t.Fatalf("step 5: expected candidate, got nil")
	}
	if !p.Acquire(a5.UID) {
		t.Fatalf("step 5: failed to acquire %s", a5.UID)
	}

	a6 := p.Pick()
	if a6 == nil {
		t.Fatalf("step 6: expected candidate, got nil")
	}
	if a6.UID == a5.UID {
		t.Fatalf("step 6: expected water-filling to pick different account, got duplicate %s", a6.UID)
	}
	if !p.Acquire(a6.UID) {
		t.Fatalf("step 6: failed to acquire %s", a6.UID)
	}

	// 校验当前在途：各 3 个 (3:3)
	inf1, _ = p.InFlightOf("u1")
	inf2, _ = p.InFlightOf("u2")
	if inf1 != 3 || inf2 != 3 {
		t.Fatalf("expected 3:3 in-flight, got u1=%d, u2=%d", inf1, inf2)
	}

	// 第 7 次选号：池已满载（3+3=6），必须返回 nil
	a7 := p.Pick()
	if a7 != nil {
		t.Fatalf("step 7: expected nil when all accounts are full at max_in_flight=3, got %s", a7.UID)
	}

	// 释放 u1 一次：u1 在途降为 2
	p.Release("u1")
	inf1, _ = p.InFlightOf("u1")
	if inf1 != 2 {
		t.Fatalf("expected u1 in-flight=2 after release, got %d", inf1)
	}

	// 再次选号：必须成功选出空出名额的 u1
	a8 := p.Pick()
	if a8 == nil {
		t.Fatalf("step 8: expected candidate after release, got nil")
	}
	if a8.UID != "u1" {
		t.Fatalf("step 8: expected u1 to be picked, got %s", a8.UID)
	}
}
