//go:build !windows

package metacore

import "os"

func secureDirectory(path string) error { return os.Chmod(path, 0700) }
