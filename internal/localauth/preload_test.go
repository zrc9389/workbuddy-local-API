package localauth

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// TestPreloadAndUnlock_MultiTabSupport 验证预加载与验密解密完整流程及多标签页支持
func TestPreloadAndUnlock_MultiTabSupport(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	a, err := New(authPath)
	if err != nil {
		t.Fatalf("new auth failed: %v", err)
	}

	handler := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	setup := localRequest("POST", "/auth/login", `{"password":"initial-pass"}`)
	setupRec := httptest.NewRecorder()
	handler.ServeHTTP(setupRec, setup)
	if setupRec.Code != http.StatusOK {
		t.Fatalf("initial password setup status=%d body=%s", setupRec.Code, setupRec.Body.String())
	}

	// 1. GET /api/preload-bundle 预加载密文
	reqBundle := localRequest("GET", "/api/preload-bundle", "")
	recBundle := httptest.NewRecorder()
	handler.ServeHTTP(recBundle, reqBundle)

	if recBundle.Code != http.StatusOK {
		t.Fatalf("GET /api/preload-bundle status=%d, body=%s", recBundle.Code, recBundle.Body.String())
	}

	var bundleResp PreloadBundleResponse
	if err := json.Unmarshal(recBundle.Body.Bytes(), &bundleResp); err != nil {
		t.Fatalf("unmarshal bundle response failed: %v", err)
	}

	if bundleResp.Ciphertext == "" || bundleResp.IV == "" {
		t.Fatal("ciphertext and IV must not be empty")
	}

	// 2. 验证 60 秒惰性缓存（多次请求应返回相同密文和 IV）
	recBundle2 := httptest.NewRecorder()
	handler.ServeHTTP(recBundle2, reqBundle)
	var bundleResp2 PreloadBundleResponse
	_ = json.Unmarshal(recBundle2.Body.Bytes(), &bundleResp2)
	if bundleResp2.Ciphertext != bundleResp.Ciphertext || bundleResp2.IV != bundleResp.IV {
		t.Fatal("subsequent GET within 60s must return cached bundle")
	}

	// 3. POST /api/unlock 校验密码并获取 dataKey（标签页 1 解锁）
	unlockBody := `{"password":"initial-pass"}`
	reqUnlock1 := localRequest("POST", "/api/unlock", unlockBody)
	reqUnlock1.Header.Set("Content-Type", "application/json")
	recUnlock1 := httptest.NewRecorder()
	handler.ServeHTTP(recUnlock1, reqUnlock1)

	if recUnlock1.Code != http.StatusOK {
		t.Fatalf("POST /api/unlock (tab 1) status=%d, body=%s", recUnlock1.Code, recUnlock1.Body.String())
	}

	var unlockResp1 UnlockResponse
	if err := json.Unmarshal(recUnlock1.Body.Bytes(), &unlockResp1); err != nil {
		t.Fatalf("unmarshal unlock response failed: %v", err)
	}

	keyBytes, err := base64.StdEncoding.DecodeString(unlockResp1.DataKey)
	if err != nil || len(keyBytes) != 32 {
		t.Fatalf("dataKey must be valid 32 bytes AES-256 key, got len=%d, err=%v", len(keyBytes), err)
	}

	// 4. 端到端解密验证：用解密密钥解开密文
	ciphertext, _ := base64.StdEncoding.DecodeString(bundleResp.Ciphertext)
	iv, _ := base64.StdEncoding.DecodeString(bundleResp.IV)

	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		t.Fatalf("aes cipher init failed: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("gcm init failed: %v", err)
	}
	decrypted, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		t.Fatalf("failed to decrypt bundle with returned dataKey: %v", err)
	}

	var sensitiveData map[string]any
	if err := json.Unmarshal(decrypted, &sensitiveData); err != nil {
		t.Fatalf("unmarshal decrypted payload failed: %v", err)
	}
	if sensitiveData["bundle_type"] != "core_kernel_sensitive_preload" {
		t.Fatalf("unexpected decrypted sensitive data: %v", sensitiveData)
	}

	// 5. 验证多标签页支持：标签页 2 在同一 60s 周期内解锁同样成功，不再因“即用即焚”误杀其他标签页
	recUnlock2 := httptest.NewRecorder()
	reqUnlock2 := localRequest("POST", "/api/unlock", unlockBody)
	reqUnlock2.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recUnlock2, reqUnlock2)

	if recUnlock2.Code != http.StatusOK {
		t.Fatalf("second tab unlock within 60s must succeed, got status: %d", recUnlock2.Code)
	}
}

// TestPreloadAndUnlock_IPRateLimiting 验证单客户端 IP 连续输错触发 429 限流，绝不破坏全局 Bundle
func TestPreloadAndUnlock_IPRateLimiting(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	a, err := New(authPath)
	if err != nil {
		t.Fatalf("new auth failed: %v", err)
	}

	handler := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	setup := localRequest("POST", "/auth/login", `{"password":"initial-pass"}`)
	setupRec := httptest.NewRecorder()
	handler.ServeHTTP(setupRec, setup)
	if setupRec.Code != http.StatusOK {
		t.Fatalf("initial password setup status=%d body=%s", setupRec.Code, setupRec.Body.String())
	}

	// 生成 Bundle
	reqBundle := localRequest("GET", "/api/preload-bundle", "")
	recBundle := httptest.NewRecorder()
	handler.ServeHTTP(recBundle, reqBundle)
	if recBundle.Code != http.StatusOK {
		t.Fatalf("bundle status=%d", recBundle.Code)
	}

	badBody := `{"password":"wrong_password"}`

	// 恶意 IP 连续输错 5 次
	for i := 1; i <= 5; i++ {
		rec := httptest.NewRecorder()
		req := localRequest("POST", "/api/unlock", badBody)
		req.RemoteAddr = "127.0.0.2:12345"
		req.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d status=%d want 401", i, rec.Code)
		}
	}

	// 第 6 次该 IP 被限制 -> 429 Too Many Requests
	recBlocked := httptest.NewRecorder()
	reqBlocked := localRequest("POST", "/api/unlock", badBody)
	reqBlocked.RemoteAddr = "127.0.0.2:12345"
	reqBlocked.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recBlocked, reqBlocked)
	if recBlocked.Code != http.StatusTooManyRequests {
		t.Fatalf("blocked IP attempt should return 429, got: %d", recBlocked.Code)
	}

	// 另一个正常客户端 IP 即使在此时输入正确密码，依然 100% 正常解锁（无 DoS）
	recNormal := httptest.NewRecorder()
	reqNormal := localRequest("POST", "/api/unlock", `{"password":"initial-pass"}`)
	reqNormal.RemoteAddr = "127.0.0.1:54321"
	reqNormal.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recNormal, reqNormal)
	if recNormal.Code != http.StatusOK {
		t.Fatalf("normal user from another IP must not be affected by attacker, got status: %d", recNormal.Code)
	}
}

func TestPreloadIPLimitStateIsBounded(t *testing.T) {
	pm := &PreloadManager{ipLimits: make(map[string]*ipAttemptState)}
	for i := 0; i < maxIPLimitEntries+128; i++ {
		pm.noteIPAttemptResult(fmt.Sprintf("198.51.%d.%d", i/255, i%255), false)
	}
	pm.ipMu.Lock()
	count := len(pm.ipLimits)
	if count > maxIPLimitEntries {
		pm.ipMu.Unlock()
		t.Fatalf("ip limit state grew to %d entries, max %d", count, maxIPLimitEntries)
	}
	// Expired entries are removed during the next insertion.
	for _, state := range pm.ipLimits {
		state.failCount = 0
		state.lastSeen = time.Now().Add(-2 * IPCooldownDuration)
	}
	pm.ipMu.Unlock()
	pm.noteIPAttemptResult("127.0.0.1", false)
	pm.ipMu.Lock()
	count = len(pm.ipLimits)
	pm.ipMu.Unlock()
	if count != 1 {
		t.Fatalf("expired IP states were not pruned: %d", count)
	}
}
