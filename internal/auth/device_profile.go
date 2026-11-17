package auth

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	mathrand "math/rand/v2"
	"strings"

	"github.com/linguo2625469/workbuddy2api-panel/internal/logfmt"
)

// DeviceProfile 每账号独立持久化的虚拟设备指纹画像。
// MachineID / SessionID / WebMachineID 均由 crypto/rand 独立随机生成（与 UID 无数学派生关系），
// 硬件参数从真实消费级 PC 档位库中随机选取并落盘到 auth 文件顶层 "device_profile"，
// 保证同账号跨重启稳定、账号间彼此异构。
type DeviceProfile struct {
	MachineID    string `json:"machine_id"`
	SessionID    string `json:"session_id"`
	WebMachineID string `json:"web_machine_id"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	OSVersion    string `json:"os_version"`
	CPUCores     int    `json:"cpu_cores"`
	MemorySize   int    `json:"memory_size"`
}

type hardwarePreset struct {
	OS         string
	Arch       string
	OSVersion  string
	CPUCores   int
	MemorySize int
}

// consumerHardwarePresets 真实消费级 Windows 10/11 PC 硬件档位库（win32/x64 与桌面端/Web 上报协议的
// Windows 路径及浏览器 UA 保持 OS 一致，避免跨字段 OS 矛盾，同时彻底消除全池同构）。
var consumerHardwarePresets = []hardwarePreset{
	{OS: "win32", Arch: "x64", OSVersion: "10.0.19045", CPUCores: 6, MemorySize: 16},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.19045", CPUCores: 8, MemorySize: 16},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.19045", CPUCores: 12, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22621", CPUCores: 8, MemorySize: 16},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22621", CPUCores: 12, MemorySize: 16},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22621", CPUCores: 12, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22621", CPUCores: 16, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22631", CPUCores: 8, MemorySize: 16},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22631", CPUCores: 12, MemorySize: 24},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22631", CPUCores: 16, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.22631", CPUCores: 20, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26100", CPUCores: 8, MemorySize: 16},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26100", CPUCores: 12, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26100", CPUCores: 16, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26100", CPUCores: 16, MemorySize: 64},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26100", CPUCores: 20, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26200", CPUCores: 12, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26200", CPUCores: 16, MemorySize: 32},
	{OS: "win32", Arch: "x64", OSVersion: "10.0.26200", CPUCores: 20, MemorySize: 64},
}

// NewRandomDeviceProfile 生成一份全新的随机消费级设备指纹画像。
func NewRandomDeviceProfile() DeviceProfile {
	p := randomHardwarePreset()
	return DeviceProfile{
		MachineID:    randomHex36(),
		SessionID:    randomHex36(),
		WebMachineID: randomHex36(),
		OS:           p.OS,
		Arch:         p.Arch,
		OSVersion:    p.OSVersion,
		CPUCores:     p.CPUCores,
		MemorySize:   p.MemorySize,
	}
}

func randomHex36() string {
	var b [18]byte
	if _, err := cryptorand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	return fmt.Sprintf("%016x%016x%04x", mathrand.Uint64(), mathrand.Uint64(), uint16(mathrand.Uint64()))
}

func randomHardwarePreset() hardwarePreset {
	n := len(consumerHardwarePresets)
	if v, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(n))); err == nil {
		return consumerHardwarePresets[v.Int64()]
	}
	return consumerHardwarePresets[mathrand.IntN(n)]
}

func isValidHex36(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func (dp *DeviceProfile) normalize() {
	if dp == nil {
		return
	}
	dp.MachineID = strings.ToLower(strings.TrimSpace(dp.MachineID))
	dp.SessionID = strings.ToLower(strings.TrimSpace(dp.SessionID))
	dp.WebMachineID = strings.ToLower(strings.TrimSpace(dp.WebMachineID))
	dp.OS = strings.TrimSpace(dp.OS)
	dp.Arch = strings.TrimSpace(dp.Arch)
	dp.OSVersion = strings.TrimSpace(dp.OSVersion)
}

func (dp *DeviceProfile) isEmpty() bool {
	if dp == nil {
		return true
	}
	return dp.MachineID == "" &&
		dp.SessionID == "" &&
		dp.WebMachineID == "" &&
		dp.OS == "" &&
		dp.Arch == "" &&
		dp.OSVersion == "" &&
		dp.CPUCores <= 0 &&
		dp.MemorySize <= 0
}

// ensureDeviceProfileLocked 在已持有 a.mu 的前提下补全缺失或非法的设备画像字段，
// 保留既有合法字段；若发生任何初始化/补全返回 true。
func (a *Auth) ensureDeviceProfileLocked() bool {
	changed := false
	if a.DeviceProfile == nil {
		a.DeviceProfile = &DeviceProfile{}
		changed = true
	}
	dp := a.DeviceProfile
	dp.normalize()

	if !isValidHex36(dp.MachineID) {
		dp.MachineID = randomHex36()
		changed = true
	}
	if !isValidHex36(dp.SessionID) {
		dp.SessionID = randomHex36()
		changed = true
	}
	if !isValidHex36(dp.WebMachineID) {
		dp.WebMachineID = randomHex36()
		changed = true
	}
	if dp.OS == "" || dp.Arch == "" || dp.OSVersion == "" || dp.CPUCores <= 0 || dp.MemorySize <= 0 {
		p := randomHardwarePreset()
		if dp.OS == "" {
			dp.OS = p.OS
			changed = true
		}
		if dp.Arch == "" {
			dp.Arch = p.Arch
			changed = true
		}
		if dp.OSVersion == "" {
			dp.OSVersion = p.OSVersion
			changed = true
		}
		if dp.CPUCores <= 0 {
			dp.CPUCores = p.CPUCores
			changed = true
		}
		if dp.MemorySize <= 0 {
			dp.MemorySize = p.MemorySize
			changed = true
		}
	}
	return changed
}

// EnsureDeviceProfile 确保账号具备完整设备指纹画像并返回其值副本。
// 首次初始化或补全缺失字段时，若 FilePath 非空、账号未 retired 且 AccessToken 非空，
// 在同一把锁内调用 saveAtomicLocked 原子落盘；磁盘不可写时仅打 WARN 并降级为内存保持。
// 严禁伪造或修改 DeviceToken。
func (a *Auth) EnsureDeviceProfile() DeviceProfile {
	if a == nil {
		return NewRandomDeviceProfile()
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	changed := a.ensureDeviceProfileLocked()
	if changed && !a.retired && a.FilePath != "" && strings.TrimSpace(a.AccessToken) != "" {
		if err := a.saveAtomicLocked(); err != nil {
			log.Printf("WARN: auth %s device_profile persist: %v", logfmt.Label(a.UID, a.Nickname), err)
		}
	}
	return *a.DeviceProfile
}

// DeviceProfileValue 线程安全地返回账号持久化设备指纹画像的副本（缺失时自动补全并按需落盘）。
func (a *Auth) DeviceProfileValue() DeviceProfile {
	return a.EnsureDeviceProfile()
}
