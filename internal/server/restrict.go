// restrict.go 11140 风控连坐保护状态机：
//
// 当同一出口 IP / 设备在短窗口内连续出现多个不同账号触发 11140（账号异常限制）时，
// 暂停全池派发一段时间（hold），避免单次请求或并发流量顺着轮转把剩余健康号逐个撞封。
// 进程内运行态保存、重启清零。
package server

import (
	"log"
	"sync"
	"time"
)

// restrictWindow 判定连坐风控的时间窗口；restrictThreshold 窗口内触发暂停的
// 不同账号数阈值（单号反复命中不计入多号，只按去重后的账号数统计）。
var restrictWindow = 15 * time.Minute

const restrictThreshold = 2

// restrictGate 11140 全池连坐保护门控（Handler 内嵌，零值可用）。
type restrictGate struct {
	mu    sync.Mutex
	hits  map[string]time.Time // uid -> 最近一次命中 11140 的时刻（窗口内惰性剪枝）
	until time.Time            // 全池暂停派发截止时刻；零值表示未暂停
	nowFn func() time.Time     // 测试注入时钟钩子；nil 时使用 time.Now
}

func (gate *restrictGate) currentTime() time.Time {
	if gate.nowFn != nil {
		return gate.nowFn()
	}
	return time.Now()
}

// note 记录一次账号级 11140 风控受限事件，返回调用后全池暂停保护是否处于激活状态。
//   - hold <= 0 表示关闭全池暂停保护：不记录命中窗口，直接返回 false；
//   - 已在暂停期内（now < until）：保守自然解除语义——不续期、不把在途残留命中带入下一轮窗口，返回 true；
//   - 同一 uid 重复命中只刷新其最近命中时刻，不增加去重计数；
//   - 窗口内去重账号数达到 restrictThreshold 时激活暂停至 now+hold，并清空命中窗口。
func (gate *restrictGate) note(uid string, hold time.Duration) (activated bool) {
	if hold <= 0 || uid == "" {
		return false
	}
	now := gate.currentTime()
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if now.Before(gate.until) {
		return true
	}
	if gate.hits == nil {
		gate.hits = make(map[string]time.Time)
	}
	for hitUID, hitAt := range gate.hits {
		if now.Sub(hitAt) > restrictWindow {
			delete(gate.hits, hitUID)
		}
	}
	gate.hits[uid] = now
	if len(gate.hits) < restrictThreshold {
		return false
	}
	gate.until = now.Add(hold)
	gate.hits = make(map[string]time.Time)
	log.Printf("WARN: [server] upstream 11140 restriction wave: %d accounts restricted within %s, dispatch paused %s (until %s)",
		restrictThreshold, restrictWindow, hold, gate.until.Format(time.RFC3339))
	return true
}

// active 返回当前是否处于全池暂停保护期以及剩余等待时长；未激活或已过期返回 (false, 0)。
func (gate *restrictGate) active() (bool, time.Duration) {
	now := gate.currentTime()
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if gate.until.IsZero() {
		return false, 0
	}
	remain := gate.until.Sub(now)
	if remain <= 0 {
		return false, 0
	}
	return true, remain
}

// reset 手动清除当前暂停状态与窗口内已记录的命中账号。
func (gate *restrictGate) reset() {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	gate.hits = nil
	gate.until = time.Time{}
}
