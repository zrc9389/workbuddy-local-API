package metacore

import "path/filepath"

const (
	LinuxAMD64SHA256 = "7a0d59da2e678d56c899a3db996a2ad8963286c4f3634b0451435db248f13fa1"
	LinuxARM64SHA256 = "c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754"
)

type kernelPlatform struct {
	filename string
	sha256   string
}

// pinnedPlatform is a closed allowlist. All pins refer to the same official
// KernelVersion release; see third_party/meta/manifest.json for archive provenance.
func pinnedPlatform(goos, goarch string) (kernelPlatform, bool) {
	switch goos + "/" + goarch {
	case "windows/amd64":
		return kernelPlatform{"mihomo.exe", WindowsAMD64SHA256}, true
	case "linux/amd64":
		return kernelPlatform{"mihomo", LinuxAMD64SHA256}, true
	case "linux/arm64":
		return kernelPlatform{"mihomo", LinuxARM64SHA256}, true
	default:
		return kernelPlatform{}, false
	}
}

// KernelPath returns the pinned kernel path relative to the application/repository
// root. Unsupported platforms have no path. Callers outside that root should join
// the result to an explicit root, or use Options.Binary with an absolute path.
func KernelPath(goos, goarch string) (string, bool) {
	p, ok := pinnedPlatform(goos, goarch)
	if !ok {
		return "", false
	}
	return filepath.Join("third_party", "meta", "bin", goos+"-"+goarch, p.filename), true
}
