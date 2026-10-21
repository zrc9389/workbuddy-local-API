//go:build windows

package metacore

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"os/user"
	"time"
)

func secureDirectory(path string) error {
	u, err := user.Current()
	if err != nil {
		return errors.New("cannot identify private meta directory owner")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "icacls.exe", path, "/inheritance:r", "/grant:r", "*"+u.Uid+":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F")
	hideProcess(cmd)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if cmd.Run() != nil {
		return errors.New("cannot protect private meta directory")
	}
	return nil
}
