package server

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func newTestRestrictGate(start time.Time) (*restrictGate, func(time.Duration)) {
	var clockMu sync.Mutex
	now := start
	gate := &restrictGate{
		nowFn: func() time.Time {
			clockMu.Lock()
			defer clockMu.Unlock()
			return now
		},
	}
	advance := func(delta time.Duration) {
		clockMu.Lock()
		defer clockMu.Unlock()
		now = now.Add(delta)
	}
	return gate, advance
}

// TestRestrictGateSingleAccountNeverTriggers 同一账号重复 11140 只更新时间戳，不得触发全池暂停。
func TestRestrictGateSingleAccountNeverTriggers(t *testing.T) {
	gate, advance := newTestRestrictGate(time.Unix(1_700_000_000, 0))
	hold := 1800 * time.Second

	for attempt := 0; attempt < 5; attempt++ {
		if gate.note("u1", hold) {
			t.Fatalf("attempt %d: 单账号重复受限不应触发全池暂停", attempt+1)
		}
		if isActive, remain := gate.active(); isActive || remain != 0 {
			t.Fatalf("attempt %d: active=(%v,%v) want (false,0)", attempt+1, isActive, remain)
		}
		advance(time.Minute)
	}
}

// TestRestrictGateEmptyUIDIgnored 空 UID 不得计入受限账号数。
func TestRestrictGateEmptyUIDIgnored(t *testing.T) {
	gate, _ := newTestRestrictGate(time.Unix(1_700_000_000, 0))
	if gate.note("", 10*time.Minute) {
		t.Fatal("空 UID 不应触发暂停")
	}
	if gate.note("u1", 10*time.Minute) {
		t.Fatal("仅有 1 个有效账号 u1 时不应触发暂停")
	}
}

// TestRestrictGateTwoDistinctAccountsActivateAndExpire 窗口内 2 个不同账号受限应激活全池暂停，
// 到期后自动解除且需要新一轮 2 个不同账号才能再次激活。
func TestRestrictGateTwoDistinctAccountsActivateAndExpire(t *testing.T) {
	gate, advance := newTestRestrictGate(time.Unix(1_700_000_000, 0))
	hold := 1800 * time.Second

	if gate.note("u1", hold) {
		t.Fatal("仅第 1 个账号受限时不应激活")
	}
	advance(restrictWindow - time.Second)
	if !gate.note("u2", hold) {
		t.Fatal("窗口内第 2 个不同账号受限应激活全池暂停")
	}

	isActive, remain := gate.active()
	if !isActive || remain != hold {
		t.Fatalf("激活后 active=(%v,%v) want (true,%v)", isActive, remain, hold)
	}

	advance(10 * time.Minute)
	isActive, remain = gate.active()
	wantRemain := hold - 10*time.Minute
	if !isActive || remain != wantRemain {
		t.Fatalf("暂停期内 active=(%v,%v) want (true,%v)", isActive, remain, wantRemain)
	}

	advance(wantRemain)
	if isActive, remain = gate.active(); isActive || remain != 0 {
		t.Fatalf("暂停期满后应自动解除，得到 active=(%v,%v)", isActive, remain)
	}

	// 解除后旧窗口已清空，单个新账号不得立刻再次激活。
	if gate.note("u3", hold) {
		t.Fatal("暂停解除后单个账号不应立即重新激活")
	}
	if !gate.note("u4", hold) {
		t.Fatal("暂停解除后第 2 个不同账号应能再次激活")
	}
}

// TestRestrictGateWindowExpiryPrunesOldHits 超过 15 分钟窗口的旧记录会被剪枝，不与新命中凑数。
func TestRestrictGateWindowExpiryPrunesOldHits(t *testing.T) {
	gate, advance := newTestRestrictGate(time.Unix(1_700_000_000, 0))
	hold := 10 * time.Minute

	if gate.note("u1", hold) {
		t.Fatal("第 1 个账号不应激活")
	}
	advance(restrictWindow + time.Second)

	// u1 已滑出 15 分钟窗口，仅剩 u2 不足阈值。
	if gate.note("u2", hold) {
		t.Fatal("u1 已超出 15m 窗口，u2 单独命中不应激活")
	}
	if isActive, remain := gate.active(); isActive || remain != 0 {
		t.Fatalf("active=(%v,%v) want (false,0)", isActive, remain)
	}

	// 在 u2 的窗口内再命中 u3，应触发激活。
	advance(5 * time.Minute)
	if !gate.note("u3", hold) {
		t.Fatal("u2 与 u3 同在窗口内，应触发激活")
	}
}

// TestRestrictGateHoldDisabled hold <= 0 时关闭全池暂停，既不激活也不残留历史计数。
func TestRestrictGateHoldDisabled(t *testing.T) {
	gate, _ := newTestRestrictGate(time.Unix(1_700_000_000, 0))

	for _, uid := range []string{"u1", "u2", "u3"} {
		if gate.note(uid, 0) {
			t.Fatalf("hold=0 时账号 %s 不应激活", uid)
		}
		if gate.note(uid, -time.Second) {
			t.Fatalf("hold<0 时账号 %s 不应激活", uid)
		}
	}
	if isActive, remain := gate.active(); isActive || remain != 0 {
		t.Fatalf("hold<=0 后 active=(%v,%v) want (false,0)", isActive, remain)
	}

	// 后续即使开启正 hold，此前在 hold<=0 期间的事件不应累积为前置计数。
	if gate.note("u4", time.Minute) {
		t.Fatal("hold<=0 期间未追踪账号，u4 单账号不应激活")
	}
}

// TestRestrictGateActiveHoldDoesNotRenewOrPollute 暂停激活期内的新命中不得延长截止时间，
// 也不得残留进暂停结束后的新一轮窗口。
func TestRestrictGateActiveHoldDoesNotRenewOrPollute(t *testing.T) {
	gate, advance := newTestRestrictGate(time.Unix(1_700_000_000, 0))
	shortHold := 5 * time.Minute

	_ = gate.note("u1", shortHold)
	if !gate.note("u2", shortHold) {
		t.Fatal("应激活暂停")
	}

	advance(2 * time.Minute)
	if !gate.note("u3", shortHold) {
		t.Fatal("暂停期内 note 应报告仍处于激活态")
	}
	isActive, remain := gate.active()
	if !isActive || remain != 3*time.Minute {
		t.Fatalf("暂停期内新命中不得续期：active=(%v,%v) want (true,3m)", isActive, remain)
	}

	// 暂停结束后，暂停期内出现的 u3 不得残留在窗口里导致单个 u4 就重新激活。
	advance(3 * time.Minute)
	if isActive, remain = gate.active(); isActive || remain != 0 {
		t.Fatalf("预期暂停结束，得到 active=(%v,%v)", isActive, remain)
	}
	if gate.note("u4", shortHold) {
		t.Fatal("暂停期内的 u3 不应污染后续窗口，u4 单次命中不应激活")
	}
}

// TestRestrictGateReset reset 应立即清空暂停状态与窗口内命中计数。
func TestRestrictGateReset(t *testing.T) {
	gate, _ := newTestRestrictGate(time.Unix(1_700_000_000, 0))

	// 清理待触发窗口中的单个命中。
	_ = gate.note("u1", 10*time.Minute)
	gate.reset()
	if gate.note("u2", 10*time.Minute) {
		t.Fatal("reset 清空窗口后，单个 u2 不应触发激活")
	}

	// 激活后 reset 应立即解除暂停。
	if !gate.note("u3", 10*time.Minute) {
		t.Fatal("u2+u3 应触发激活")
	}
	if isActive, _ := gate.active(); !isActive {
		t.Fatal("预期已激活")
	}
	gate.reset()
	if isActive, remain := gate.active(); isActive || remain != 0 {
		t.Fatalf("reset 后 active=(%v,%v) want (false,0)", isActive, remain)
	}
}

// TestRestrictGateConcurrentAccess 并发调用 note/active/reset 无竞态且门控状态一致。
func TestRestrictGateConcurrentAccess(t *testing.T) {
	var gate restrictGate
	var wg sync.WaitGroup
	for workerIdx := 0; workerIdx < 8; workerIdx++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for step := 0; step < 50; step++ {
				uid := fmt.Sprintf("u-%d-%d", idx, step%3)
				gate.note(uid, 50*time.Millisecond)
				gate.active()
				if step%17 == 0 {
					gate.reset()
				}
			}
		}(workerIdx)
	}
	wg.Wait()
	gate.reset()
	if isActive, remain := gate.active(); isActive || remain != 0 {
		t.Fatalf("并发结束 reset 后应处于未激活状态: active=(%v,%v)", isActive, remain)
	}
}
