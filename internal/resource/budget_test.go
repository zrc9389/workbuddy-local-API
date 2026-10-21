package resource

import (
	"bytes"
	"io"
	"testing"
)

func TestBudget(t *testing.T) {
	g := NewBudget(10)
	if !g.Acquire(8) || g.Acquire(3) {
		t.Fatal("over budget")
	}
	g.Release(8)
	if !g.Acquire(10) {
		t.Fatal("not released")
	}
}
func TestBoundedResponse(t *testing.T) {
	r := LimitResponse(io.NopCloser(bytes.NewReader(make([]byte, 20))), 10)
	b, e := io.ReadAll(r)
	if e == nil || len(b) != 10 {
		t.Fatal(len(b), e)
	}
}
