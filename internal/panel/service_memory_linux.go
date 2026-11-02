//go:build linux

package panel

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// serviceMemoryBytes 获取 WorkBuddy 自身进程及受管子进程（包括 Meta/Mihomo 内核）的真实常驻物理内存（RSS），
// 准确统计整个程序栈的全部物理开销，排除 Linux 全局 Page Cache 与系统整机开销。
func serviceMemoryBytes() (uint64, bool) {
	pageSize := uint64(os.Getpagesize())
	var totalRSS uint64

	// 1. 读取 WorkBuddy 主进程自身的物理 RSS
	selfRSS := readStatmRSS("/proc/self/statm", pageSize)
	if selfRSS == 0 {
		return 0, false
	}
	totalRSS += selfRSS

	// 2. 累加由当前服务拉起的外置内核子进程（如受管的 Meta/Mihomo 内核）真实物理 RSS
	selfPid := os.Getpid()
	seenPids := make(map[int]bool)

	// 路径 A: 检查 /proc/self/task/*/children (Linux 内核 CONFIG_PROC_CHILDREN 支持)
	if tasks, err := os.ReadDir("/proc/self/task"); err == nil {
		for _, t := range tasks {
			childrenPath := filepath.Join("/proc/self/task", t.Name(), "children")
			data, err := os.ReadFile(childrenPath)
			if err != nil {
				continue
			}
			for _, pidStr := range strings.Fields(string(data)) {
				if pid, err := strconv.Atoi(pidStr); err == nil && !seenPids[pid] {
					seenPids[pid] = true
					statmPath := filepath.Join("/proc", pidStr, "statm")
					totalRSS += readStatmRSS(statmPath, pageSize)
				}
			}
		}
	}

	// 路径 B: 遍历 /proc 兜底发现以当前进程为父进程的子进程（保障所有内核与命名空间环境均生效）
	if entries, err := os.ReadDir("/proc"); err == nil {
		for _, e := range entries {
			pid, err := strconv.Atoi(e.Name())
			if err != nil || seenPids[pid] || pid == selfPid {
				continue
			}
			statPath := filepath.Join("/proc", e.Name(), "stat")
			ppid := readProcessPPID(statPath)
			if ppid == selfPid {
				seenPids[pid] = true
				statmPath := filepath.Join("/proc", e.Name(), "statm")
				totalRSS += readStatmRSS(statmPath, pageSize)
			}
		}
	}

	return totalRSS, true
}

func readStatmRSS(path string, pageSize uint64) uint64 {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 2 {
		pages, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			return pages * pageSize
		}
	}
	return 0
}

func readProcessPPID(statPath string) int {
	data, err := os.ReadFile(statPath)
	if err != nil {
		return -1
	}
	s := string(data)
	rparen := strings.LastIndex(s, ")")
	if rparen == -1 || rparen+1 >= len(s) {
		return -1
	}
	fields := strings.Fields(s[rparen+1:])
	// fields[0]=state, fields[1]=ppid
	if len(fields) >= 2 {
		ppid, err := strconv.Atoi(fields[1])
		if err == nil {
			return ppid
		}
	}
	return -1
}
