package panel

import "net/http"

func (p *Panel) tasksScanAll(w http.ResponseWriter, r *http.Request) { p.cfg.Tasks.TasksScanAll(w, r) }
func (p *Panel) tasksRunQueue(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.TasksRunQueue(w, r)
}
func (p *Panel) tasksQueueStatus(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.TasksQueueStatus(w, r)
}
func (p *Panel) schoolVouchers(w http.ResponseWriter, r *http.Request) {
	p.cfg.Tasks.SchoolVouchers(w, r)
}

// RunGrowthQueueOnce is a compatibility shim; new schedulers should call tasks.Service directly.
func (p *Panel) RunGrowthQueueOnce() { p.cfg.Tasks.RunGrowthQueueOnce() }
