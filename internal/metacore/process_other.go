//go:build !windows

package metacore

import "os/exec"

func hideProcess(cmd *exec.Cmd) {}
