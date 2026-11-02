//go:build linux

package panel

import (
	"os"
	"strconv"
	"strings"
)

// serviceMemoryBytes 获取 WorkBuddy 自身进程的真实常驻物理内存（RSS），
// 准确统计属于 WorkBuddy 核心服务的物理开销，排除 Linux 全局 Page Cache 与外部子进程干扰。
func serviceMemoryBytes() (uint64, bool) {
	pageSize := uint64(os.Getpagesize())
	selfRSS := readStatmRSS("/proc/self/statm", pageSize)
	if selfRSS == 0 {
		return 0, false
	}
	return selfRSS, true
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
