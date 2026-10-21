package panel

import "net/http"

func (p *Panel) accountTaskAuto(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.AccountTaskAuto(w, r)
}
func (p *Panel) accountTaskAutoAll(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.AccountTaskAutoAll(w, r)
}
func (p *Panel) tryLockAccount(uid string) bool { return p.cfg.Tasks.TryLockAccount(uid) }
func (p *Panel) unlockAccount(uid string)       { p.cfg.Tasks.UnlockAccount(uid) }
