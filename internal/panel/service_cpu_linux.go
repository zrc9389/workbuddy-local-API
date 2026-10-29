//go:build linux

package panel

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func serviceCPUUsage() (uint64, bool) {
	data, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "0::/") {
			continue
		}
		data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(line, "0::/"), "cpu.stat"))
		if err != nil {
			return 0, false
		}
		for _, row := range strings.Split(string(data), "\n") {
			fields := strings.Fields(row)
			if len(fields) == 2 && fields[0] == "usage_usec" {
				value, err := strconv.ParseUint(fields[1], 10, 64)
				return value, err == nil
			}
		}
	}
	return 0, false
}
