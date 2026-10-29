//go:build !linux

package panel

func serviceMemoryBytes() (uint64, bool) { return 0, false }
