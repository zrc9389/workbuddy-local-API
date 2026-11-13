package panel

import (
	"net/http"
	"time"
)

func (p *Panel) accountTasks(w http.ResponseWriter, r *http.Request) { p.cfg.Tasks.AccountTasks(w, r) }
func (p *Panel) accountTaskAccept(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.AccountTaskAccept(w, r)
}
func (p *Panel) taskAcceptAll(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.TaskAcceptAll(w, r)
}
func (p *Panel) accountTaskClaim(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.AccountTaskClaim(w, r)
	if p.cfg.Scheduler != nil {
		go func() {
			time.Sleep(500 * time.Millisecond)
			p.cfg.Scheduler.RunBalanceRefreshNow()
		}()
	}
}
