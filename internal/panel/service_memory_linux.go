//go:build linux

package panel

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// serviceMemoryBytes 获取 WorkBuddy 自身进程及受管子进程（如 Mihomo）的真实常驻物理内存（RSS），
// 准确统计属于当前服务的真实物理开销，绝不统计 Linux 全局 Page Cache 与整组系统开销。
func serviceMemoryBytes() (uint64, bool) {
	pageSize := uint64(os.Getpagesize())
	var totalRSS uint64

	// 1. 读取主进程自身的物理 RSS
	selfRSS := readStatmRSS("/proc/self/statm", pageSize)
	if selfRSS == 0 {
		return 0, false
	}
	totalRSS += selfRSS

	// 2. 累加由当前服务拉起的子进程（如受管的 Mihomo 代理内核）真实物理 RSS
	if tasks, err := os.ReadDir("/proc/self/task"); err == nil {
		seenPids := make(map[string]bool)
		for _, t := range tasks {
			childrenPath := filepath.Join("/proc/self/task", t.Name(), "children")
			data, err := os.ReadFile(childrenPath)
			if err != nil {
				continue
			}
			for _, pidStr := range strings.Fields(string(data)) {
				if seenPids[pidStr] {
					continue
				}
				seenPids[pidStr] = true
				statmPath := filepath.Join("/proc", pidStr, "statm")
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
