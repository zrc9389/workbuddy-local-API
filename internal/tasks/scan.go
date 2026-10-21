package tasks

import (
	"context"
	"log"
	"sync"
)

func (p *Service) Scan(ctx context.Context) (ScanResult, error) {
	if err := ctx.Err(); err != nil {
		return ScanResult{}, err
	}
	if err := p.ready(); err != nil {
		return ScanResult{}, err
	}
	states := p.cfg.Pool.List()
	items := make([]ScanAccountItem, len(states))
	var wg sync.WaitGroup
	for i, st := range states {
		if st.Disabled {
			continue
		}
		if err := p.acquireScan(ctx); err != nil {
			wg.Wait()
			return ScanResult{}, err
		}
		wg.Add(1)
		go func(i int, uid string) {
			defer wg.Done()
			defer p.releaseScan()
			a := p.cfg.Pool.AuthByUID(uid)
			if a == nil {
				return
			}
			it := &items[i]
			it.UID, it.Nickname = uid, a.Nickname
			// D4 门控：global 账号无 CN 成长任务体系，不发起任何上游调用。
			if a.IsGlobal() {
				return
			}
			// 企业版门控：同上——企业版无个人成长体系（GET /v2/activity/growth/tasks
			// 上游 403「growth system is only available for personal users」）。
			if a.IsEnterprise() {
				return
			}
			if tasks, err := p.cfg.Upstream.ListTasks(a); err != nil {
				it.GrowthErr = err.Error()
			} else {
				for _, t := range tasks {
					if growthPending(t) {
						it.Growth = append(it.Growth, t)
					}
				}
			}
			// 小程序口径任务（school_season 校园日 / Sequential_Tasks_1 小程序首对话）
			// 仅在 mp 头列表下发，与默认口径不重叠——合并进待办列表；mp 列表失败
			// 静默（无 mp 任务的部署/活动结束时零影响）。
			if mpTasks, err := p.cfg.Upstream.ListTasksMP(a); err == nil {
				seen := map[string]bool{}
				for _, t := range it.Growth {
					seen[t.TaskCode] = true
				}
				for _, t := range mpTasks {
					if growthPending(t) && !seen[t.TaskCode] {
						it.Growth = append(it.Growth, t)
						seen[t.TaskCode] = true
					}
				}
			}
		}(i, st.UID)
	}
	wg.Wait()
	pending := 0
	for _, it := range items {
		pending += len(it.Growth)
	}
	log.Printf("panel: 队列扫描完成：全部账号待办 %d 项", pending)
	return ScanResult{OK: true, Accounts: items, PendingCount: pending}, ctx.Err()
}
