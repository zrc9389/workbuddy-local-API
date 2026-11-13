package pool

import (
	"reflect"
	"testing"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

// ---------------------------------------------------------------------------
// ModelBlocked：区分「号都在但都对这个模型关闭」与「池子真没号」
// ---------------------------------------------------------------------------

// TestModelBlockedAllAccountsCooled 全部账号都对该模型冷却 → Blocked，
// 且带出账号数、最早解封时间与上游原因。
func TestModelBlockedAllAccountsCooled(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.Add(&auth.Auth{UID: "u2"})
	base := time.Now()
	// 两个号对同一模型都有冷却，解封时间不同 → 应取最早的。
	p.mu.Lock()
	p.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: base.Add(2 * time.Hour), Reason: "11102 model [glm-5.3] service info not found"},
	}
	p.byUID["u2"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: base.Add(1 * time.Hour), Reason: "11102 model [glm-5.3] service info not found"},
	}
	p.mu.Unlock()

	st := p.ModelBlocked("glm-5.3")
	if !st.Blocked {
		t.Fatalf("全部账号冷却时 Blocked 应为 true，得到 %+v", st)
	}
	if st.Count != 2 {
		t.Errorf("Count=%d want 2", st.Count)
	}
	if st.Reason == "" {
		t.Errorf("Reason 应带出上游原因，得到空")
	}
	// 最早解封应接近 1h 后（u2），不是 2h（u1）。
	if d := time.Until(st.Until); d > 70*time.Minute || d < 50*time.Minute {
		t.Errorf("Until=%v 应取最早解封（约 1h 后），得到 %v", st.Until, d)
	}
}

// TestModelBlockedOneAccountStillServes 只要还有账号能服务该模型，就不算模型级阻塞
// ——否则会把「在途占满/积分保底」导致的选号失败误报成模型问题。
func TestModelBlockedOneAccountStillServes(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.Add(&auth.Auth{UID: "u2"})
	p.mu.Lock()
	p.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: time.Now().Add(time.Hour), Reason: "11102 ..."},
	}
	p.mu.Unlock()

	if st := p.ModelBlocked("glm-5.3"); st.Blocked {
		t.Fatalf("u2 仍可服务该模型，不应判定为模型级阻塞：%+v", st)
	}
	// 但 u2 对该模型无冷却这一点必须是真的（防止测试自身构造错误）。
	p.mu.RLock()
	cooled := p.byUID["u2"].modelCooled(time.Now(), "glm-5.3")
	p.mu.RUnlock()
	if cooled {
		t.Fatalf("测试构造有误：u2 不该对该模型冷却")
	}
}

// TestModelBlockedDisabledDoesNotCount 禁用号不参与判定：它不可用与模型无关，
// 既不构成"还能服务"的证明，也不该被算进被挡账号数。
func TestModelBlockedDisabledDoesNotCount(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.Add(&auth.Auth{UID: "u2"})
	p.mu.Lock()
	p.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: time.Now().Add(time.Hour), Reason: "11102 ..."},
	}
	p.byUID["u2"].disabled = true // 唯一还能服务的号被禁用了
	p.mu.Unlock()

	st := p.ModelBlocked("glm-5.3")
	if !st.Blocked {
		t.Fatalf("除禁用号外全部冷却 → 应判定为模型级阻塞，得到 %+v", st)
	}
	if st.Count != 1 {
		t.Errorf("Count=%d want 1（禁用号不计入）", st.Count)
	}
}

// TestModelBlockedAuditOnlyNotBlocking AuditOnly 条目只审计不拦截，不能算阻塞
// ——口径必须与选号的 modelCooled 一致，否则会把"其实能调"的模型报成不可用。
func TestModelBlockedAuditOnlyNotBlocking(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.mu.Lock()
	p.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: time.Now().Add(time.Hour), Reason: "audit", AuditOnly: true},
	}
	p.mu.Unlock()

	if st := p.ModelBlocked("glm-5.3"); st.Blocked {
		t.Fatalf("AuditOnly 条目不得判定为阻塞：%+v", st)
	}
}

// TestModelBlockedExpiredNotBlocking 已过期的冷却不算阻塞。
func TestModelBlockedExpiredNotBlocking(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.mu.Lock()
	p.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: time.Now().Add(-time.Minute), Reason: "11102 ..."},
	}
	p.mu.Unlock()

	if st := p.ModelBlocked("glm-5.3"); st.Blocked {
		t.Fatalf("已过期冷却不得判定为阻塞：%+v", st)
	}
}

// TestModelBlockedEmptyInputs 空模型名与空池都返回"未阻塞"：前者无从判断，
// 后者属于"真的没号"，绝不能冒充模型问题。
func TestModelBlockedEmptyInputs(t *testing.T) {
	p := New("")
	// 空池
	if st := p.ModelBlocked("glm-5.3"); st.Blocked {
		t.Fatalf("空池不应判定为模型阻塞：%+v", st)
	}
	// 空模型名
	p.Add(&auth.Auth{UID: "u1"})
	if st := p.ModelBlocked(""); st.Blocked {
		t.Fatalf("空模型名不应判定为模型阻塞：%+v", st)
	}
}

// TestModelBlockedThenClear 回归：BlockModelBackoff 写入后应判定为阻塞，
// BlockModelClear 清除后应恢复——覆盖真实的写入/清除通道，而不是只手搓 map。
func TestModelBlockedThenClear(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})

	p.BlockModelBackoff("u1", "glm-5.3", "11102 model [glm-5.3] service info not found")
	st := p.ModelBlocked("glm-5.3")
	if !st.Blocked || st.Count != 1 {
		t.Fatalf("写入负缓存后应阻塞：%+v", st)
	}
	if st.Reason == "" {
		t.Errorf("应带出 reason")
	}

	p.BlockModelClear("u1", "glm-5.3")
	if st := p.ModelBlocked("glm-5.3"); st.Blocked {
		t.Fatalf("清除后不应再阻塞：%+v", st)
	}
}

// TestModelBlockedPausedDoesNotMaskBlock 暂停号不构成「能服务」的证明：
// 除暂停号外全部模型冷却时仍应判定阻塞（合并 #113 时补的口径——
// 否则一个暂停的健康号会掩盖「其余号全被模型级冷却挡住」）。
func TestModelBlockedPausedDoesNotMaskBlock(t *testing.T) {
	p := New("")
	p.Add(&auth.Auth{UID: "u1"})
	p.Add(&auth.Auth{UID: "u2"})
	p.mu.Lock()
	p.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: time.Now().Add(time.Hour), Reason: "11102 ..."},
	}
	p.byUID["u2"].paused = true // 唯一「健康」的号在暂停让位
	p.mu.Unlock()

	st := p.ModelBlocked("glm-5.3")
	if !st.Blocked {
		t.Fatalf("暂停号不得掩盖模型级阻塞：%+v", st)
	}
	if st.Count != 1 {
		t.Errorf("Count=%d want 1（暂停号不计入）", st.Count)
	}
}

// TestModelBlockTTLShortEnoughToSelfHeal 11102 负缓存退避必须短到可快速自愈：
// 基数 <= 5m、封顶 <= 15m，且左移移位足以达到封顶以保留退避语义。
func TestModelBlockTTLShortEnoughToSelfHeal(t *testing.T) {
	if modelBlockBaseTTL > 5*time.Minute {
		t.Fatalf("modelBlockBaseTTL=%v 过长：单次误判不应长时间锁死模型", modelBlockBaseTTL)
	}
	if modelBlockMaxTTL > 15*time.Minute {
		t.Fatalf("modelBlockMaxTTL=%v 过长：反复命中也应在 15 分钟内自愈", modelBlockMaxTTL)
	}
	if modelBlockMaxTTL < modelBlockBaseTTL {
		t.Fatalf("modelBlockMaxTTL=%v 小于 modelBlockBaseTTL=%v", modelBlockMaxTTL, modelBlockBaseTTL)
	}
	if modelBlockBaseTTL<<modelBlockShift < modelBlockMaxTTL {
		t.Fatalf("退避无法到达封顶：base<<%d=%v < max=%v", modelBlockShift, modelBlockBaseTTL<<modelBlockShift, modelBlockMaxTTL)
	}

	poolInst := New("")
	poolInst.Add(&auth.Auth{UID: "u1"})
	expectedTTLs := []time.Duration{
		2 * time.Minute,
		4 * time.Minute,
		8 * time.Minute,
		10 * time.Minute,
		10 * time.Minute,
	}
	for hitIdx, wantTTL := range expectedTTLs {
		before := time.Now()
		poolInst.BlockModelBackoff("u1", "glm-5.3", "11102 model not available")
		after := time.Now()
		poolInst.mu.Lock()
		acctEntry := poolInst.byUID["u1"]
		modelEntry := acctEntry.modelCooldowns["glm-5.3"]
		recordedUntil := modelEntry.Until
		recordedHits := modelEntry.Hits
		modelEntry.Until = time.Now().Add(-time.Second)
		acctEntry.modelCooldowns["glm-5.3"] = modelEntry
		poolInst.mu.Unlock()

		if recordedHits != hitIdx+1 {
			t.Fatalf("hit %d: Hits=%d want %d", hitIdx+1, recordedHits, hitIdx+1)
		}
		if recordedUntil.Before(before.Add(wantTTL-time.Second)) || recordedUntil.After(after.Add(wantTTL+time.Second)) {
			t.Fatalf("hit %d: Until=%v 不在预期窗口 [%v, %v]", hitIdx+1, recordedUntil, before.Add(wantTTL), after.Add(wantTTL))
		}
	}
}

// TestCooldownModelBusy 验证 14003 模型繁忙短冷却：
//   - 10s 起步指数退避并封顶 1m；
//   - 仅锁定触发模型，不写账号级 until，同号其他模型保持立即可用；
//   - 已有未过期冷却时不得缩短或延长既有截止。
func TestCooldownModelBusy(t *testing.T) {
	poolInst := New("")
	poolInst.Add(&auth.Auth{UID: "u1"})

	// 防御边界：空参数与未知账号安全忽略。
	poolInst.CooldownModelBusy("", "glm-5.3", "14003 busy")
	poolInst.CooldownModelBusy("u1", "", "14003 busy")
	poolInst.CooldownModelBusy("missing", "glm-5.3", "14003 busy")

	expectedDurs := []time.Duration{
		10 * time.Second,
		20 * time.Second,
		40 * time.Second,
		60 * time.Second,
		60 * time.Second,
	}
	for hitIdx, wantDur := range expectedDurs {
		before := time.Now()
		poolInst.CooldownModelBusy("u1", "glm-5.3", "14003 model busy")
		after := time.Now()

		poolInst.mu.RLock()
		acctEntry := poolInst.byUID["u1"]
		modelEntry := acctEntry.modelCooldowns["glm-5.3"]
		accountUntil := acctEntry.until
		now := time.Now()
		otherHealthy := acctEntry.healthyForModel(now, "other-model")
		sameHealthy := acctEntry.healthyForModel(now, "glm-5.3")
		poolInst.mu.RUnlock()

		if !accountUntil.IsZero() {
			t.Fatalf("hit %d: CooldownModelBusy 不得写账号级 until=%v", hitIdx+1, accountUntil)
		}
		if !otherHealthy {
			t.Fatalf("hit %d: 同号其他模型应仍可用", hitIdx+1)
		}
		if sameHealthy {
			t.Fatalf("hit %d: 被繁忙冷却的模型应不可选", hitIdx+1)
		}
		if modelEntry.Hits != hitIdx+1 {
			t.Fatalf("hit %d: Hits=%d want %d", hitIdx+1, modelEntry.Hits, hitIdx+1)
		}
		if modelEntry.Until.Before(before.Add(wantDur-time.Second)) || modelEntry.Until.After(after.Add(wantDur+time.Second)) {
			t.Fatalf("hit %d: Until=%v 不在 [%v, %v]", hitIdx+1, modelEntry.Until, before.Add(wantDur), after.Add(wantDur))
		}

		// 冷却尚在有效期内再次命中：不得延长或覆盖 Hits/Until。
		poolInst.CooldownModelBusy("u1", "glm-5.3", "14003 model busy retry")
		poolInst.mu.Lock()
		stillEntry := acctEntry.modelCooldowns["glm-5.3"]
		if !stillEntry.Until.Equal(modelEntry.Until) || stillEntry.Hits != modelEntry.Hits || stillEntry.Reason != "14003 model busy" {
			poolInst.mu.Unlock()
			t.Fatalf("hit %d: 有效期内重复调用不应改写冷却状态: got=%+v want=%+v", hitIdx+1, stillEntry, modelEntry)
		}
		// 模拟本次短冷却到期，供下一轮验证指数退避。
		stillEntry.Until = time.Now().Add(-time.Second)
		acctEntry.modelCooldowns["glm-5.3"] = stillEntry
		poolInst.mu.Unlock()
	}

	// 已有更长冷却（如 6004 5 分钟）时不得被 10s 繁忙冷却缩短或覆盖。
	longerUntil := time.Now().Add(5 * time.Minute)
	poolInst.CooldownSoftForModel("u1", time.Minute, longerUntil, "kimi-k3", "6004 model rate limit")
	poolInst.CooldownModelBusy("u1", "kimi-k3", "14003 model busy")
	poolInst.mu.RLock()
	preserved := poolInst.byUID["u1"].modelCooldowns["kimi-k3"]
	poolInst.mu.RUnlock()
	if preserved.Reason != "6004 model rate limit" || preserved.Until.Before(longerUntil.Add(-time.Second)) {
		t.Fatalf("已有更长冷却不得被缩短或覆盖: %+v", preserved)
	}
}

// TestBlockModelClearClears11158 验证 BlockModelClear 同时清除 11102 与 11158 负缓存，
// 且不影响 6004 与 14003 等独立模型冷却。
func TestBlockModelClearClears11158(t *testing.T) {
	poolInst := New("")
	poolInst.Add(&auth.Auth{UID: "u1"})

	poolInst.BlockModelBackoff("u1", "claude-opus-4-6", "11158 model not allowed")
	poolInst.BlockModelBackoff("u1", "glm-5.3", "11102 model not found")
	poolInst.CooldownSoftForModel("u1", time.Minute, time.Now().Add(5*time.Minute), "kimi-k3", "6004 rate limit")
	poolInst.CooldownModelBusy("u1", "deepseek-v4", "14003 model busy")

	if st := poolInst.ModelBlocked("claude-opus-4-6"); !st.Blocked {
		t.Fatalf("清除前 11158 模型应判定阻塞: %+v", st)
	}

	poolInst.BlockModelClear("u1", "claude-opus-4-6")
	poolInst.BlockModelClear("u1", "glm-5.3")
	poolInst.BlockModelClear("u1", "kimi-k3")
	poolInst.BlockModelClear("u1", "deepseek-v4")

	if st := poolInst.ModelBlocked("claude-opus-4-6"); st.Blocked {
		t.Fatalf("11158 清除后不应再阻塞: %+v", st)
	}
	if st := poolInst.ModelBlocked("glm-5.3"); st.Blocked {
		t.Fatalf("11102 清除后不应再阻塞: %+v", st)
	}
	if st := poolInst.ModelBlocked("kimi-k3"); !st.Blocked {
		t.Fatalf("6004 冷却不得被 BlockModelClear 误删: %+v", st)
	}
	if st := poolInst.ModelBlocked("deepseek-v4"); !st.Blocked {
		t.Fatalf("14003 冷却不得被 BlockModelClear 误删: %+v", st)
	}
}

// TestModelBlockedReasons 验证 ModelBlocked 汇总所有冷却账号的非空 Reason 并忽略空字符串。
func TestModelBlockedReasons(t *testing.T) {
	poolInst := New("")
	poolInst.Add(&auth.Auth{UID: "u1"})
	poolInst.Add(&auth.Auth{UID: "u2"})
	poolInst.Add(&auth.Auth{UID: "u3"})

	expiry := time.Now().Add(2 * time.Minute)
	poolInst.mu.Lock()
	poolInst.byUID["u1"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: expiry, Reason: "14003 model busy"},
	}
	poolInst.byUID["u2"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: expiry, Reason: "11102 model not found"},
	}
	poolInst.byUID["u3"].modelCooldowns = map[string]modelCooldown{
		"glm-5.3": {Until: expiry, Reason: ""},
	}
	poolInst.mu.Unlock()

	st := poolInst.ModelBlocked("glm-5.3")
	if !st.Blocked || st.Count != 3 {
		t.Fatalf("预期全部 3 个账号阻塞，got=%+v", st)
	}
	wantReasons := []string{"11102 model not found", "14003 model busy"}
	if !reflect.DeepEqual(st.Reasons, wantReasons) {
		t.Fatalf("Reasons=%v want %v", st.Reasons, wantReasons)
	}

	// 若存在仍可服务账号，Reasons 应随 Blocked=false 返回 nil。
	poolInst.Add(&auth.Auth{UID: "u4"})
	st = poolInst.ModelBlocked("glm-5.3")
	if st.Blocked || len(st.Reasons) != 0 {
		t.Fatalf("存在健康账号时不应阻塞且 Reasons 应为空，got=%+v", st)
	}
}
