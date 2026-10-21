# Local Pool Implementation Plan

Goal: 交付仅本机开放的模块化多账号池工作台。
Architecture: Go 模块化单体；嵌入原生 ES modules；Panel 底座，VPS 出口/协议能力按边界迁入。

## 工作包与写入边界
- [x] 0 基线测试和构建，记录既有失败。
- [x] 1 主线 internal/localauth：先测试回环、Host/Origin、密码登录改密、CSRF 和 key 不放行；接线 cmd/server + 管理路由。取消 api_key 配置和 UI。
- [x] 2 出口工作包 internal/egress + internal/auth + internal/upstream transport：单号代理/矩阵/凭证迁移，测试失败不直连；不碰主线已有文件。
- [x] 3 前端工作包 internal/panel/assets + index.html/app.js：按页面模块化、VPS 风格；本机 session API 登录；保留原业务入口。独立静态测试和浏览器验收。
- [x] 4 主线 internal/conversation + server responses：容量/字节/TTL/持久化测试；迁入 Responses function/custom 转换；确认说明非 token-native streaming。
- [x] 5 主线 internal/telemetry + reqlog：定义接口/空实现，核心仅依赖接口；关闭日志测试；统计独立。
- [x] 6 任务与 handler 按职责拆分；配置/模型管理迁移；工作包完成后跑集成。
- [x] 7 全套 go test ./...、go vet ./...、Windows build、HTTP 安全验收与浏览器交互，记录未验证的真实上游能力。

不自动提交，不部署，不使用真实凭证。每工作包先写行为测试，针对失败实现，再运行受影响测试；最终统一验证。

交付边界：VPS模型目录控制采用启停/展示覆盖，不接未实现第三方供应商；额度策略选择模型级保底，不叠加整号迟滞禁用。真实上游和race限制见 docs/VALIDATION.md。
