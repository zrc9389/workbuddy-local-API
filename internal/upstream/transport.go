// transport.go 出站基础 Transport 与超时参数的单一事实来源：
// 默认 tls_profile=chrome_auto 经 utls_transport 与代理链路协商 HTTP/2；
// 仅在 go_h1 回退路径及此处基础 *http.Transport 上通过空 TLSNextProto 显式禁用 h2，
// 并统一管理 TLS 握手超时、TCP keepalive 探测与响应头超时参数。
package upstream

import (
	"crypto/tls"
	"net"
	"net/http"
	"strings"
	"time"
)

// TLSProfile 出站代理传输层的 TLS 指纹与 HTTP 协议协商策略常量。
const (
	// TLSProfileChromeAuto 默认拟态档位：经账号代理使用 uTLS HelloChrome_Auto + ALPN 自动协商 HTTP/2 或 HTTP/1.1。
	TLSProfileChromeAuto = "chrome_auto"
	// TLSProfileGoH1 回退档位：使用 Go 标准库 http.Transport + HTTP/1.1。
	TLSProfileGoH1 = "go_h1"
)

// NormalizeTLSProfile 规范化 TLSProfile 配置值：空串或 "chrome_auto" 归为 chrome_auto，
// "go_h1" 归为 go_h1，其他未知值安全回落为 chrome_auto。
func NormalizeTLSProfile(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", TLSProfileChromeAuto:
		return TLSProfileChromeAuto
	case TLSProfileGoH1:
		return TLSProfileGoH1
	default:
		return TLSProfileChromeAuto
	}
}

// 连接层参数集中定义（与 server/backoff.go 同风格：一处定义，测试可回读断言）。
const (
	// dialTimeout TCP 连接建立上限。半死连接的第一道闸：连不上就快速失败
	// 轮转换号，不再干等系统 TCP 重传窗口（kongjianguan 实测半开 TCP 单次
	// TTFB 卡 936s——默认 Dialer 无超时上限）。
	dialTimeout = 10 * time.Second
	// dialKeepAlive TCP keepalive 探测周期。默认 Dialer 2h 才发首个探测——
	// NAT 黑洞里 2h 足够连接半死且被复用。15s 周期让死连接在 15~30s 内被
	// 内核掐掉（RST/ETIMEDOUT），复用侧立即感知而非卡到重传窗口。
	dialKeepAlive = 15 * time.Second
	// tlsHandshakeTimeout TLS 握手上限。现役此前完全缺失——握手挂起时无任何
	// 层兜底（ResponseHeaderTimeout 只在请求写完后才计时），只能干等到
	// HTTP.Client.Timeout(120s)。
	tlsHandshakeTimeout = 10 * time.Second
	// idleConnTimeout 空闲连接池保留时长。从 90s 收到 30s：WAF 风暴后上游
	// NGI 常态性掐闲置连接，90s 池里的连接多半已死（kongjianguan 同款取值）；
	// 复用侧仍有 15s keepalive 兜底识别。
	idleConnTimeout = 30 * time.Second
	// responseHeaderTimeout 聊天 SSE 首字节前（响应头）硬上限。从 120s 收到
	// 60s：kongjianguan 笔记实录成功请求 TTFB 曾到 16s（慢模型冷启动），
	// 60s ≈ 3.75× 观测最坏健康首包，留足慢冷启动余量；同时把半死连接场景的
	// 单请求卡死从 2 分钟压到 1 分钟（MaxRotate 默认 3 次的最坏轮转从 6 分钟
	// 压到 3 分钟）。不取 kongjianguan 的 20s：其 20s 是 DisableKeepAlives+
	// timedConn 20s 写超时组合的取值，我们保留连接复用，须按自身慢冷启动
	// 观测留余量。语义核对（任务书设计纪律）：ResponseHeaderTimeout 只计响应
	// 头到达前的时长，头到达后 SSE 长流不受影响（流中空闲由 IdleTimeout 监控，
	// 见 idle.go），不误杀长流——transport_test.go 有显式回归。
	//
	// 注意：本常量只是 newTransport 的构造默认，main.go 会按 config
	// upstream.header_timeout_seconds 无条件覆盖。因此生产生效值 = config
	// 解析值（未配置时 normalize 回落 timeout_seconds，默认 120），本 60s 仅作
	// 「Config 未接线/测试裸用」时的安全网；生产环境由 config.json（config.example.json
	// 及 normalize 默认 header_timeout_seconds 均为 120）在启动时统一覆盖。
	responseHeaderTimeout = 60 * time.Second
	// h2ReadIdleTimeout HTTP/2 空闲读健康探测间隔（发送 PING 帧识别半死连接）。
	h2ReadIdleTimeout = 15 * time.Second
	// h2PingTimeout HTTP/2 PING 探测等待 PONG 的超时上限。
	h2PingTimeout = 10 * time.Second
)

// maxIdleConns / maxIdleConnsPerHost 连接池容量：
// 针对本地私有网关场景进行收拢优化（最大 16，单 Host 2 条空闲连接），避免闲置时霸占系统缓冲区。
const (
	maxIdleConns        = 16
	maxIdleConnsPerHost = 2
)

// newDialer 构造出站拨号器（DialContext 的 Timeout/KeepAlive 参数集中于此，
// 供测试回读断言）。
func newDialer() *net.Dialer {
	return &net.Dialer{
		Timeout:   dialTimeout,
		KeepAlive: dialKeepAlive,
	}
}

// newTransport 构造基础共享出站 *http.Transport（供直连测试与 go_h1 回退复用；
// 默认 chrome_auto 代理路径走 utls_transport 协商 HTTP/2）。
// 分两层防半死连接：
//   - TLS 层：空 TLSNextProto（非 nil）在该基础 HTTP/1.1 Transport 上显式禁用 h2，避免标准库隐式回落未受控 h2 池。
//   - TCP 层：DialContext 10s 建连上限 + 15s keepalive 探测，半开连接在建立期
//     和复用期都能被快速识别（见 dialTimeout/dialKeepAlive 注释）。
func newTransport() *http.Transport {
	dialer := newDialer()
	return &http.Transport{
		DialContext: dialer.DialContext,
		// 空 TLSNextProto（非 nil）在基础 Transport 与 go_h1 回退路径上显式禁用 h2
		// （默认 chrome_auto 路径由 utls_transport 接管 ALPN 与 HTTP/2 协商）。
		TLSNextProto:          make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
		TLSHandshakeTimeout:   tlsHandshakeTimeout,
		MaxIdleConns:          maxIdleConns,
		MaxIdleConnsPerHost:   maxIdleConnsPerHost,
		IdleConnTimeout:       idleConnTimeout,
		ResponseHeaderTimeout: responseHeaderTimeout,
		DisableCompression:    true, // 工业级低延迟：禁用透明传输压缩，消除 gzip 块积压引发的流式抖动与出字延迟
	}
}

// closeIdler 实现该接口的 RoundTripper 支持清空空闲连接池（*http.Transport、
// http2.Transport 等均满足；测试注入的自定义 RoundTripper 可选择性实现）。
type closeIdler interface {
	CloseIdleConnections()
}

// roundTripCloseIdle 在传输层请求失败后清掉 rt 所属 Transport 的空闲连接池
// （kongjianguan 第 4 件：失败连接可能仍留在空闲池里，等 IdleConnTimeout 才
// 过期，下一个请求会继续捡到它）。
//
// 挂载点（任务书「评估挂载点：错误分类处理处」的结论）：错误分类（Classify）
// 只见业务信封——传输层失败根本没有 body 可分类（见 doJSON/ChatStreamContext
// 对 read body 失败的处理：不进 Classify、不罚号）。这类失败的正确处理正是
// 连接层的池清理，故挂在与 Do 并列的传输层出口（ChatStreamContext 的 Do 错误
// 分支），而非 applyErrorPolicy。
//
// 关闭是 best-effort：rt 为 nil 或未实现 closeIdler（如测试注入的 rtFunc）时
// 静默跳过。CloseIdleConnections 只关空闲连接，不影响在途请求；瞬时代价是
// 下个请求多一次 TCP+TLS 握手，与半死连接被复用卡 60s 的风险完全不成比例。
func roundTripCloseIdle(rt http.RoundTripper) {
	if rt == nil {
		return
	}
	if ci, ok := rt.(closeIdler); ok {
		ci.CloseIdleConnections()
	}
}
