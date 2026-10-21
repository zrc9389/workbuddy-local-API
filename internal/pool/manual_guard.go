package pool

func (p *Pool) SetBalanceGuard(low int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if low < 0 {
		low = 0
	}
	p.balanceGuardLow = low
	for _, e := range p.byUID {
		e.guardLow = low
	}
}
func (p *Pool) SetManualDisabled(uid string, v bool) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.byUID[uid]
	if e == nil {
		return false
	}
	e.manualDisabled = v
	p.dirty.Store(true)
	return true
}
func (p *Pool) BalanceGuard() int64 { p.mu.RLock(); defer p.mu.RUnlock(); return p.balanceGuardLow }
