package localauth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// BundleLifetime 60 秒惰性缓存生命周期
	BundleLifetime = 60 * time.Second
	// MaxIPUnlockFailures 单 IP 允许的连续错误尝试次数（基于客户端 IP 限流，彻底杜绝全局 DoS）
	MaxIPUnlockFailures = 5
	// IPCooldownDuration 单 IP 连续超限后的冷却时间
	IPCooldownDuration = 60 * time.Second
	// maxIPLimitEntries bounds attacker-controlled source identities kept in memory.
	maxIPLimitEntries = 1024
)

// PreloadBundleResponse 预加载密文包响应
type PreloadBundleResponse struct {
	Ciphertext string `json:"ciphertext"` // AES-256-GCM 密文 (Base64)
	IV         string `json:"iv"`         // 12 字节 IV (Base64)
	ExpiresIn  int    `json:"expires_in"` // 剩余有效期（秒）
	CachedAt   int64  `json:"cached_at"`  // 创建时 Unix 秒级时间戳
}

// UnlockRequest 极速验密请求体
type UnlockRequest struct {
	Password string `json:"password"`
}

// UnlockResponse 极速验密成功返回
type UnlockResponse struct {
	DataKey string `json:"data_key"` // 32 字节 Base64 密钥
}

type ipAttemptState struct {
	failCount   int
	lockedUntil time.Time
	lastSeen    time.Time
}

// PreloadManager 负责启动动画期密文预加载与极速验密下发
type PreloadManager struct {
	mu         sync.Mutex
	auth       *Auth
	dataKey    []byte    // 32 字节 AES-256 密钥（在 60 秒生命周期内安全供合法用户解密）
	iv         []byte    // 12 字节 IV
	ciphertext []byte    // AES-GCM 密文
	cachedAt   time.Time // 缓存生成时间戳
	provider   func() ([]byte, error)

	ipMu     sync.Mutex
	ipLimits map[string]*ipAttemptState
}

// NewPreloadManager 构造预加载管理器
func NewPreloadManager(a *Auth, provider ...func() ([]byte, error)) *PreloadManager {
	pm := &PreloadManager{
		auth:     a,
		ipLimits: make(map[string]*ipAttemptState),
	}
	if len(provider) > 0 && provider[0] != nil {
		pm.provider = provider[0]
	} else {
		pm.provider = pm.defaultSensitiveDataProvider
	}
	return pm
}

// defaultSensitiveDataProvider 默认核心敏感数据生成
func (pm *PreloadManager) defaultSensitiveDataProvider() ([]byte, error) {
	data := map[string]any{
		"initialized": true,
		"timestamp":   time.Now().UnixNano(),
		"auth_realm":  "local_boundary",
		"bundle_type": "core_kernel_sensitive_preload",
	}
	return json.Marshal(data)
}

// GetOrCreateBundle 互斥惰性获取或生成 60 秒加密包（Singleflight 模式）
func (pm *PreloadManager) GetOrCreateBundle() (*PreloadBundleResponse, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now()
	// 60 秒惰性缓存命中（多标签页、多客户端在 60 秒内共享同一密文包与密钥）
	if pm.dataKey != nil && pm.ciphertext != nil && now.Sub(pm.cachedAt) < BundleLifetime {
		remaining := int(BundleLifetime.Seconds() - now.Sub(pm.cachedAt).Seconds())
		if remaining < 0 {
			remaining = 0
		}
		return &PreloadBundleResponse{
			Ciphertext: base64.StdEncoding.EncodeToString(pm.ciphertext),
			IV:         base64.StdEncoding.EncodeToString(pm.iv),
			ExpiresIn:  remaining,
			CachedAt:   pm.cachedAt.Unix(),
		}, nil
	}

	// 缓存未命中或已过期：擦除旧密钥内存，生成新 Bundle
	pm.eraseDataKeyLocked()

	plaintext, err := pm.provider()
	if err != nil {
		return nil, fmt.Errorf("provider: %w", err)
	}

	// 生成随机 32 字节 Key 与 12 字节 IV
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("crypto rand key: %w", err)
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return nil, fmt.Errorf("crypto rand iv: %w", err)
	}

	// AES-256-GCM 加密
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher gcm: %w", err)
	}
	ciphertext := gcm.Seal(nil, iv, plaintext, nil)

	pm.dataKey = key
	pm.iv = iv
	pm.ciphertext = ciphertext
	pm.cachedAt = now

	return &PreloadBundleResponse{
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
		IV:         base64.StdEncoding.EncodeToString(iv),
		ExpiresIn:  int(BundleLifetime.Seconds()),
		CachedAt:   now.Unix(),
	}, nil
}

// ErrBundleExpired Bundle 已过期
var ErrBundleExpired = errors.New("bundle expired, please reload")

// ErrIncorrectPassword 密码错误
var ErrIncorrectPassword = errors.New("incorrect password")

// ErrRateLimited 单客户端 IP 尝试过于频繁触发限流（防爆破）
var ErrRateLimited = errors.New("too many unlock attempts, please try again later")

// checkIPRateLimit 检查客户端 IP 是否被限流
func (pm *PreloadManager) checkIPRateLimit(ip string) error {
	pm.ipMu.Lock()
	defer pm.ipMu.Unlock()

	state, exists := pm.ipLimits[ip]
	if !exists {
		return nil
	}
	now := time.Now()
	state.lastSeen = now
	if now.Before(state.lockedUntil) {
		return ErrRateLimited
	}
	return nil
}

func (pm *PreloadManager) pruneIPLimitsLocked(now time.Time) {
	for ip, state := range pm.ipLimits {
		if state == nil || (state.failCount == 0 && now.Sub(state.lastSeen) > IPCooldownDuration) || now.Sub(state.lastSeen) > 2*IPCooldownDuration {
			delete(pm.ipLimits, ip)
		}
	}
	for len(pm.ipLimits) >= maxIPLimitEntries {
		var oldestIP string
		var oldest time.Time
		for ip, state := range pm.ipLimits {
			if state == nil || oldestIP == "" || state.lastSeen.Before(oldest) {
				oldestIP, oldest = ip, state.lastSeen
			}
		}
		if oldestIP == "" {
			return
		}
		delete(pm.ipLimits, oldestIP)
	}
}

// noteIPAttemptResult 记录客户端 IP 尝试结果
func (pm *PreloadManager) noteIPAttemptResult(ip string, success bool) {
	pm.ipMu.Lock()
	defer pm.ipMu.Unlock()

	now := time.Now()
	pm.pruneIPLimitsLocked(now)
	state, exists := pm.ipLimits[ip]
	if !exists {
		state = &ipAttemptState{lastSeen: now}
		pm.ipLimits[ip] = state
	}
	state.lastSeen = now

	if success {
		// 解锁成功立即清零该 IP 的错误计数
		state.failCount = 0
		state.lockedUntil = time.Time{}
		return
	}

	state.failCount++
	if state.failCount >= MaxIPUnlockFailures {
		state.lockedUntil = now.Add(IPCooldownDuration)
	}
}

// Unlock 验密并返回当前 Bundle 的 32 字节 Base64 密钥
func (pm *PreloadManager) Unlock(ip, password string) (string, error) {
	// 1. 先做 IP 级别速率限制检查
	if err := pm.checkIPRateLimit(ip); err != nil {
		return "", err
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now()
	if pm.dataKey == nil || pm.ciphertext == nil || now.Sub(pm.cachedAt) >= BundleLifetime {
		return "", ErrBundleExpired
	}

	// 2. 常量时间校验密码
	valid := false
	if pm.auth != nil && len(password) <= 1024 {
		pm.auth.mu.Lock()
		valid = !pm.auth.record.Default && pm.auth.matches(password)
		pm.auth.mu.Unlock()
	}
	if !valid {
		pm.noteIPAttemptResult(ip, false)
		return "", ErrIncorrectPassword
	}

	// 校验成功，清零当前 IP 错误计数
	pm.noteIPAttemptResult(ip, true)

	// 3. 返回密钥（保持在 60 秒生命周期内可被同周期的合法多标签页复用，绝不擅自清空全局 Bundle）
	keyB64 := base64.StdEncoding.EncodeToString(pm.dataKey)
	return keyB64, nil
}

// eraseDataKeyLocked 擦除内存旧密钥
func (pm *PreloadManager) eraseDataKeyLocked() {
	if pm.dataKey != nil {
		for i := range pm.dataKey {
			pm.dataKey[i] = 0
		}
		pm.dataKey = nil
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// ServeHTTP 挂载并处理 GET /api/preload-bundle 与 POST /api/unlock 路由
func (pm *PreloadManager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/api/preload-bundle" && r.Method == http.MethodGet:
		bundle, err := pm.GetOrCreateBundle()
		if err != nil {
			deny(w, http.StatusInternalServerError, "failed to create preload bundle: "+err.Error())
			return
		}
		jsonReply(w, http.StatusOK, bundle)

	case r.URL.Path == "/api/unlock" && r.Method == http.MethodPost:
		var req UnlockRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			deny(w, http.StatusBadRequest, "invalid request body")
			return
		}
		ip := clientIP(r)
		key, err := pm.Unlock(ip, req.Password)
		if err != nil {
			switch {
			case errors.Is(err, ErrRateLimited):
				deny(w, http.StatusTooManyRequests, "too many unlock attempts, please wait 60s")
			case errors.Is(err, ErrIncorrectPassword):
				deny(w, http.StatusUnauthorized, "incorrect password")
			case errors.Is(err, ErrBundleExpired):
				deny(w, http.StatusGone, "bundle expired, please refresh")
			default:
				deny(w, http.StatusBadRequest, err.Error())
			}
			return
		}
		jsonReply(w, http.StatusOK, UnlockResponse{DataKey: key})

	default:
		deny(w, http.StatusNotFound, "not found")
	}
}
