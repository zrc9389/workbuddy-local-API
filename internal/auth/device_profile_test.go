package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestDeviceProfileIndependentRandomAndHeterogeneous(t *testing.T) {
	t.Parallel()

	// 同 UID 的两个独立账号对象也必须生成互不相同的随机设备 ID（严禁由 UID 派生）。
	a1 := &Auth{UID: "same-uid", AccessToken: "at"}
	a2 := &Auth{UID: "same-uid", AccessToken: "at"}
	a3 := &Auth{UID: "other-uid", AccessToken: "at"}

	dp1 := a1.EnsureDeviceProfile()
	dp2 := a2.EnsureDeviceProfile()
	dp3 := a3.EnsureDeviceProfile()

	for name, dp := range map[string]DeviceProfile{"a1": dp1, "a2": dp2, "a3": dp3} {
		if !isValidHex36(dp.MachineID) || !isValidHex36(dp.SessionID) || !isValidHex36(dp.WebMachineID) {
			t.Fatalf("%s invalid 36-hex IDs: %+v", name, dp)
		}
		if dp.MachineID == dp.SessionID || dp.MachineID == dp.WebMachineID || dp.SessionID == dp.WebMachineID {
			t.Fatalf("%s IDs must be mutually distinct: %+v", name, dp)
		}
		if dp.OS == "" || dp.Arch == "" || dp.OSVersion == "" {
			t.Fatalf("%s missing OS/Arch/OSVersion: %+v", name, dp)
		}
		if dp.CPUCores < 4 || dp.CPUCores > 32 || dp.MemorySize < 8 || dp.MemorySize > 128 {
			t.Fatalf("%s hardware out of consumer PC range: %+v", name, dp)
		}
		if dp.OSVersion == "10.0.26220" {
			t.Fatalf("%s must not hardcode legacy 10.0.26220: %+v", name, dp)
		}
	}

	if dp1.MachineID == dp2.MachineID || dp1.SessionID == dp2.SessionID || dp1.WebMachineID == dp2.WebMachineID {
		t.Fatalf("same UID accounts must not derive identical IDs: dp1=%+v dp2=%+v", dp1, dp2)
	}
	if dp1.MachineID == dp3.MachineID || dp1.SessionID == dp3.SessionID || dp1.WebMachineID == dp3.WebMachineID {
		t.Fatalf("different UID accounts collided: dp1=%+v dp3=%+v", dp1, dp3)
	}

	// 核验不是旧的 sha256("wb2a:machine:" + uid) 或 sha256("machine:" + uid)。
	for _, legacy := range []string{"wb2a:machine:same-uid", "machine:same-uid"} {
		sum := sha256.Sum256([]byte(legacy))
		legacyID := hex.EncodeToString(sum[:18])
		if dp1.MachineID == legacyID || dp2.MachineID == legacyID {
			t.Fatalf("MachineID matched legacy UID-derived hash %s", legacyID)
		}
	}

	// 同一账号多次访问保持稳定。
	if again := a1.DeviceProfileValue(); again != dp1 {
		t.Fatalf("DeviceProfile drifted on same account: first=%+v again=%+v", dp1, again)
	}

	// 批量生成应体现硬件档位异构性（非全池同构）。
	seenHW := map[hardwarePreset]bool{}
	for i := 0; i < 40; i++ {
		dp := NewRandomDeviceProfile()
		seenHW[hardwarePreset{
			OS: dp.OS, Arch: dp.Arch, OSVersion: dp.OSVersion,
			CPUCores: dp.CPUCores, MemorySize: dp.MemorySize,
		}] = true
	}
	if len(seenHW) < 3 {
		t.Fatalf("expected heterogeneous consumer hardware presets, only saw %d unique combinations", len(seenHW))
	}
}

func TestDeviceProfilePersistAndReloadNestedAndFlat(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		raw  string
	}{
		{
			name: "nested",
			raw:  `{"auth":{"accessToken":"at-n","refreshToken":"rt-n","expiresAt":1800000000,"domain":"www.codebuddy.cn","realm":"cn"},"account":{"uid":"u-nested","enterpriseId":"e1","nickname":"nick1"},"proxy":"http://127.0.0.1:8080"}`,
		},
		{
			name: "flat",
			raw:  `{"accessToken":"at-f","refreshToken":"rt-f","expiresAt":1800000000,"domain":"www.codebuddy.cn","realm":"cn","uid":"u-flat","enterpriseId":"e2","nickname":"nick2","proxy":"socks5://127.0.0.1:1080"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			fp := filepath.Join(dir, "workbuddy-"+tc.name+".json")
			if err := os.WriteFile(fp, []byte(tc.raw), 0o600); err != nil {
				t.Fatal(err)
			}

			a, err := Parse([]byte(tc.raw))
			if err != nil {
				t.Fatalf("Parse failed: %v", err)
			}
			a.FilePath = fp

			// 首次 EnsureDeviceProfile 生成画像并原子落盘，且严禁伪造空 DeviceToken。
			dp := a.EnsureDeviceProfile()
			if a.DeviceToken != "" {
				t.Fatalf("DeviceToken must stay empty, got %q", a.DeviceToken)
			}

			diskRaw, err := os.ReadFile(fp)
			if err != nil {
				t.Fatalf("ReadFile after persist: %v", err)
			}
			var rawDoc map[string]any
			if err := json.Unmarshal(diskRaw, &rawDoc); err != nil {
				t.Fatalf("invalid json on disk: %v", err)
			}
			if _, hasDT := rawDoc["device_token"]; hasDT {
				t.Fatalf("empty device_token must not be forged on disk: %s", string(diskRaw))
			}
			if _, hasDP := rawDoc["device_profile"]; !hasDP {
				t.Fatalf("device_profile missing from persisted json: %s", string(diskRaw))
			}

			reloaded, err := Parse(diskRaw)
			if err != nil {
				t.Fatalf("re-Parse failed: %v", err)
			}
			if reloaded.DeviceProfile == nil {
				t.Fatal("reloaded DeviceProfile is nil")
			}
			if *reloaded.DeviceProfile != dp {
				t.Fatalf("reloaded DeviceProfile mismatch: got=%+v want=%+v", *reloaded.DeviceProfile, dp)
			}
			if reloaded.AccessToken != a.AccessToken ||
				reloaded.RefreshToken != a.RefreshToken ||
				reloaded.UID != a.UID ||
				reloaded.EnterpriseID != a.EnterpriseID ||
				reloaded.Nickname != a.Nickname ||
				reloaded.ProxyURL != a.ProxyURL ||
				reloaded.DeviceToken != "" {
				t.Fatalf("existing fields corrupted on roundtrip: got=%+v want=%+v", reloaded, a)
			}
		})
	}
}

func TestDeviceProfileParseFlatAndNestedPreservesExplicitValues(t *testing.T) {
	t.Parallel()

	want := DeviceProfile{
		MachineID:    "0123456789abcdef0123456789abcdef0123",
		SessionID:    "fedcba9876543210fedcba9876543210fedc",
		WebMachineID: "aaaa1111bbbb2222cccc3333dddd4444eeee",
		OS:           "win32",
		Arch:         "x64",
		OSVersion:    "10.0.26100",
		CPUCores:     16,
		MemorySize:   32,
	}

	nested := `{"auth":{"accessToken":"at"},"account":{"uid":"u1"},"device_profile":{"machine_id":"0123456789ABCDEF0123456789ABCDEF0123","session_id":"fedcba9876543210fedcba9876543210fedc","web_machine_id":"aaaa1111bbbb2222cccc3333dddd4444eeee","os":"win32","arch":"x64","os_version":"10.0.26100","cpu_cores":16,"memory_size":32}}`
	flat := `{"accessToken":"at","uid":"u2","device_profile":{"machine_id":"0123456789abcdef0123456789abcdef0123","session_id":"fedcba9876543210fedcba9876543210fedc","web_machine_id":"aaaa1111bbbb2222cccc3333dddd4444eeee","os":"win32","arch":"x64","os_version":"10.0.26100","cpu_cores":16,"memory_size":32}}`

	for name, raw := range map[string]string{"nested": nested, "flat": flat} {
		a, err := Parse([]byte(raw))
		if err != nil {
			t.Fatalf("%s parse: %v", name, err)
		}
		got := a.EnsureDeviceProfile()
		if got != want {
			t.Fatalf("%s DeviceProfile = %+v want %+v", name, got, want)
		}
	}
}

func TestDeviceProfilePartialCompletionAndReadOnlyFallback(t *testing.T) {
	t.Parallel()

	// 部分字段存在时应保留已有合法字段、仅补全缺失部分。
	raw := `{"auth":{"accessToken":"at"},"account":{"uid":"u-part"},"device_profile":{"machine_id":"111122223333444455556666777788889999","cpu_cores":12}}`
	a, err := Parse([]byte(raw))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	// 制造只读/落盘失败场景（预置同名 .tmp 目录）。
	dir := t.TempDir()
	fp := filepath.Join(dir, "workbuddy-part.json")
	if err := os.WriteFile(fp, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(fp+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	a.FilePath = fp

	dp := a.EnsureDeviceProfile()
	if dp.MachineID != "111122223333444455556666777788889999" {
		t.Fatalf("existing valid MachineID overwritten: %q", dp.MachineID)
	}
	if dp.CPUCores != 12 {
		t.Fatalf("existing valid CPUCores overwritten: %d", dp.CPUCores)
	}
	if !isValidHex36(dp.SessionID) || !isValidHex36(dp.WebMachineID) || dp.OS == "" || dp.MemorySize <= 0 {
		t.Fatalf("missing fields not completed: %+v", dp)
	}
	// 内存保持稳定（不会因上次落盘失败而重新随机）。
	if again := a.DeviceProfileValue(); again != dp {
		t.Fatalf("in-memory fallback drifted: %+v vs %+v", again, dp)
	}
}

func TestDeviceProfileConcurrentEnsureRaceFree(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	fp := filepath.Join(dir, "workbuddy-race.json")
	a := &Auth{
		AccessToken:  "at-race",
		RefreshToken: "rt-race",
		ExpiresAt:    1800000000,
		UID:          "u-race",
		FilePath:     fp,
	}

	const workers = 32
	results := make([]DeviceProfile, workers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			if idx%2 == 0 {
				results[idx] = a.EnsureDeviceProfile()
			} else {
				results[idx] = a.DeviceProfileValue()
			}
		}(i)
	}
	close(start)
	wg.Wait()

	first := results[0]
	for i := 1; i < workers; i++ {
		if results[i] != first {
			t.Fatalf("worker %d saw different DeviceProfile: %+v vs %+v", i, results[i], first)
		}
	}

	// 验证落盘结果与所有 goroutine 观测完全一致。
	raw, err := os.ReadFile(fp)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	reloaded, err := Parse(raw)
	if err != nil {
		t.Fatalf("re-Parse: %v", err)
	}
	if reloaded.DeviceProfile == nil || *reloaded.DeviceProfile != first {
		t.Fatalf("on-disk profile mismatch: got=%+v want=%+v", reloaded.DeviceProfile, first)
	}
}

func TestImportCredentialsPreservesDeviceProfile(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	fp := filepath.Join(dir, "workbuddy-imp.json")
	old := &Auth{UID: "u-imp", AccessToken: "old-at", FilePath: fp}
	wantDP := old.EnsureDeviceProfile()

	next := &Auth{UID: "u-imp", AccessToken: "new-at", Nickname: "updated"}
	if err := old.ImportCredentialsAndSave(next, true); err != nil {
		t.Fatalf("ImportCredentialsAndSave: %v", err)
	}
	if next.DeviceProfile == nil || *next.DeviceProfile != wantDP {
		t.Fatalf("replacement lost DeviceProfile: got=%+v want=%+v", next.DeviceProfile, wantDP)
	}
	raw, err := os.ReadFile(fp)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.DeviceProfile == nil || *reloaded.DeviceProfile != wantDP {
		t.Fatalf("reloaded replacement lost DeviceProfile: got=%+v want=%+v", reloaded.DeviceProfile, wantDP)
	}
}
