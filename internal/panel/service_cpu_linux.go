//go:build linux

package panel

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// serviceCPUUsage 获取整个程序服务栈（WorkBuddy 主进程 + Meta 内核及其子进程）的 CPU 累计时间（微秒）。
func serviceCPUUsage() (uint64, bool) {
	// 优先从 cgroup 读取整组服务总 CPU（systemd 统一管理 WorkBuddy + Meta 内核，全面统计全栈 CPU）
	if data, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if !strings.HasPrefix(line, "0::/") {
				continue
			}
			data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(line, "0::/"), "cpu.stat"))
			if err != nil {
				continue
			}
			for _, row := range strings.Split(string(data), "\n") {
				fields := strings.Fields(row)
				if len(fields) == 2 && fields[0] == "usage_usec" {
					if value, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
						return value, true
					}
				}
			}
		}
	}

	// 兜底：若无 cgroup，累加主进程及子进程的 /proc/<pid>/stat (utime + stime)
	return readProcCPUFallback()
}

func readProcCPUFallback() (uint64, bool) {
	selfPid := os.Getpid()
	totalUsec := readPIDCPUUsec(selfPid)
	if totalUsec == 0 {
		return 0, false
	}
	if entries, err := os.ReadDir("/proc"); err == nil {
		for _, e := range entries {
			pid, err := strconv.Atoi(e.Name())
			if err != nil || pid == selfPid {
				continue
			}
			statPath := filepath.Join("/proc", e.Name(), "stat")
			if readProcessPPID(statPath) == selfPid {
				totalUsec += readPIDCPUUsec(pid)
			}
		}
	}
	return totalUsec, true
}

func readPIDCPUUsec(pid int) uint64 {
	statPath := filepath.Join("/proc", strconv.Itoa(pid), "stat")
	data, err := os.ReadFile(statPath)
	if err != nil {
		return 0
	}
	s := string(data)
	rparen := strings.LastIndex(s, ")")
	if rparen == -1 || rparen+1 >= len(s) {
		return 0
	}
	fields := strings.Fields(s[rparen+1:])
	// after ')': fields[0]=state, fields[1]=ppid, ..., fields[11]=utime, fields[12]=stime
	if len(fields) >= 13 {
		utime, err1 := strconv.ParseUint(fields[11], 10, 64)
		stime, err2 := strconv.ParseUint(fields[12], 10, 64)
		if err1 == nil && err2 == nil {
			return (utime + stime) * 10000
		}
	}
	return 0
}
