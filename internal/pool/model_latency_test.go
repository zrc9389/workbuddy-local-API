package pool

import (
	"testing"
)

func TestModelLatencyRetainsRecent20AndClears(t *testing.T) {
	p := New("")
	model := "test-model"

	// 记录 25 次延迟
	for i := 1; i <= 25; i++ {
		p.RecordModelLatency(model, int64(i*10))
	}

	samples := p.ModelLatencies(model)
	if len(samples) != 20 {
		t.Fatalf("expected 20 samples, got %d", len(samples))
	}
	// 最近一次应该是 250，最旧一次应该是 60 (25 - 20 + 1 = 6, 6 * 10 = 60)
	if samples[0] != 60 {
		t.Fatalf("expected oldest sample 60, got %d", samples[0])
	}
	if samples[19] != 250 {
		t.Fatalf("expected latest sample 250, got %d", samples[19])
	}

	// 清除模型延迟
	p.ClearModelLatency(model)
	if len(p.ModelLatencies(model)) != 0 {
		t.Fatal("expected empty samples after ClearModelLatency")
	}
}
