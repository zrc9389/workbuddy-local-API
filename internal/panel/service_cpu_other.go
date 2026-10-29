//go:build !linux

package panel

func serviceCPUUsage() (uint64, bool) { return 0, false }
