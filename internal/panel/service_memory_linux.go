//go:build linux

package panel

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func serviceMemoryBytes() (uint64, bool) {
	data, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "0::/") {
			continue
		}
		group := strings.TrimPrefix(line, "0::/")
		path := filepath.Join("/sys/fs/cgroup", group, "memory.current")
		contents, err := os.ReadFile(path)
		if err != nil {
			return 0, false
		}
		value, err := strconv.ParseUint(strings.TrimSpace(string(contents)), 10, 64)
		return value, err == nil
	}
	return 0, false
}
