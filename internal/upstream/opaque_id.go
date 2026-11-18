package upstream

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// chromeAutoWebUA 与 uTLS HelloChrome_Auto（HelloChrome_133）严格一致的桌面 Chrome Web UA。
// 所有携带 x-client-platform: web 或模拟浏览器 Web 控制台的出站请求统一使用本常量，
// 消除 TLS 指纹（Chrome 133）与 HTTP User-Agent（旧 Chrome 120 / 虚构 Chrome 152 / CLI UA）之间的矛盾。
const chromeAutoWebUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

// NewRandomUUID 生成标准 RFC 4122 v4 随机 UUID，用于发往上游的会话/请求 ID，
// 严禁携带 wb2api-/wb2a- 等自暴露网关前缀。
func NewRandomUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		now := uint64(time.Now().UnixNano())
		for i := 0; i < 8; i++ {
			b[i] = byte(now >> (i * 8))
			b[i+8] = byte((now ^ 0x9e3779b97f4a7c15) >> (i * 8))
		}
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// NewRandomHex 生成 nBytes 字节随机数据的纯小写十六进制串（长度 2*nBytes）。
func NewRandomHex(nBytes int) string {
	if nBytes <= 0 {
		nBytes = 16
	}
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		now := uint64(time.Now().UnixNano())
		for i := range b {
			b[i] = byte(now >> ((i % 8) * 8))
		}
	}
	return hex.EncodeToString(b)
}
