// Package resource bounds transient work independently of logging and persistence.
package resource

import (
	"errors"
	"io"
	"sync/atomic"
)

type Budget struct {
	limit int64
	used  atomic.Int64
}

func NewBudget(limit int64) *Budget { return &Budget{limit: limit} }
func (b *Budget) Acquire(n int64) bool {
	if n < 0 || n > b.limit {
		return false
	}
	for {
		u := b.used.Load()
		if n > b.limit-u {
			return false
		}
		if b.used.CompareAndSwap(u, u+n) {
			return true
		}
	}
}
func (b *Budget) Release(n int64) { b.used.Add(-n) }
func (b *Budget) Used() int64     { return b.used.Load() }

type responseReader struct {
	io.ReadCloser
	left int64
}

func LimitResponse(r io.ReadCloser, n int64) io.ReadCloser { return &responseReader{r, n} }
func (r *responseReader) Read(p []byte) (int, error) {
	if r.left <= 0 {
		return 0, errors.New("upstream response exceeds local byte budget")
	}
	if int64(len(p)) > r.left {
		p = p[:r.left]
	}
	n, e := r.ReadCloser.Read(p)
	r.left -= int64(n)
	return n, e
}
