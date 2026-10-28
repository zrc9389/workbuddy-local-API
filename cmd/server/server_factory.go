package main

import (
	"net/http"
	"time"
)

// DefaultServerMaxHeaderBytes 默认请求头限制上限（1 MiB，防止畸形巨型 Header 耗尽内存）
const DefaultServerMaxHeaderBytes = 1 << 20

// DefaultServerReadHeaderTimeout 默认防 Slowloris 读取头超时（15 秒）
const DefaultServerReadHeaderTimeout = 15 * time.Second

// DefaultServerIdleTimeout 默认空闲连接回收超时（120 秒）
const DefaultServerIdleTimeout = 120 * time.Second

// NewHardenedServer 创建经过安全加固配置的 http.Server 实例：
// 1. 显式 ReadHeaderTimeout 抵御慢速请求头攻击（Slowloris）；
// 2. 显式 MaxHeaderBytes 防止恶意特大请求头耗尽服务器内存；
// 3. 显式 IdleTimeout 保证空闲 Keep-Alive 连接及时释放；
// 4. ReadTimeout 覆盖请求体读取周期。
func NewHardenedServer(addr string, handler http.Handler, readTimeout time.Duration) *http.Server {
	readHeaderTimeout := DefaultServerReadHeaderTimeout
	if readTimeout > 0 && readTimeout < readHeaderTimeout {
		readHeaderTimeout = readTimeout
	}
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		IdleTimeout:       DefaultServerIdleTimeout,
		MaxHeaderBytes:    DefaultServerMaxHeaderBytes,
	}
}
