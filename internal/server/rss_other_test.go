//go:build !linux && !windows

package server

func currentRSSBytes() uint64 { return 0 }
