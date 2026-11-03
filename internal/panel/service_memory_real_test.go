package panel

import (
	"testing"
)

func TestCheckCurrentMemory(t *testing.T) {
	bytes, ok := serviceMemoryBytes()
	t.Logf("serviceMemoryBytes: bytes=%d, MB=%.2f, ok=%v", bytes, float64(bytes)/(1024*1024), ok)
}
