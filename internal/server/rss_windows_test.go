//go:build windows

package server

import (
	"syscall"
	"unsafe"
)

var (
	psapi                = syscall.NewLazyDLL("psapi.dll")
	getProcessMemoryInfo = psapi.NewProc("GetProcessMemoryInfo")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	getCurrentProcess    = kernel32.NewProc("GetCurrentProcess")
)

type processMemoryCounters struct {
	cb                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

func currentRSSBytes() uint64 {
	h, _, _ := getCurrentProcess.Call()
	m := processMemoryCounters{cb: uint32(unsafe.Sizeof(processMemoryCounters{}))}
	ok, _, _ := getProcessMemoryInfo.Call(h, uintptr(unsafe.Pointer(&m)), uintptr(m.cb))
	if ok == 0 {
		return 0
	}
	return uint64(m.WorkingSetSize)
}
