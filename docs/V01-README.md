# WorkBuddy Local · 本机多账号池

基于 WorkBuddy2API Panel v1.13.0，迁入 VPS 分支的账号出口、凭证迁移及 Responses 兼容能力。保留上游许可证。本目录是独立整合版，不覆盖原项目。

## Windows 使用

1. 解压发布包到独立目录，双击 `start.cmd`（请保持窗口开启）。
2. 打开 `http://127.0.0.1:7863/panel/`。
3. 初始管理密码 **123456**；在「配置 → 管理密码」修改。
4. 使用「添加账号」完成 OAuth，或在出口页导入本人授权的凭证 JSON。
5. 客户端 Base URL：`http://127.0.0.1:7863/v1`。无需 API key；某些客户端强制要求填写时可用任意占位文本，服务端不读取它作为权限。

首次启动自动生成 config.json、auths/data 目录及密码哈希。默认不包含任何账号、代理或测试凭证。默认端口被占用时修改配置为另一个 **127.0.0.1** 端口，不能配置公网或局域网监听地址。

只有本机聊天接口免密；账号、配置、凭证导出、任务、日志等管理操作必须登录。HTTP Host/Origin 与管理写操作 CSRF 保护独立于端口绑定。同一台机器上的其他程序仍可能调用聊天接口，因此不是本机多用户隔离产品。

## 功能

- 国内/国际账号池、显式 cn:/global: 模型路由、会话粘性、成本分层、临期积分偏好、积分保底、模型级限流与熔断。
- 深色青绿工作台：账号筛选/分页/批量暂停恢复、模型/用量/积分/任务/出口/配置/可选日志。
- HTTP/HTTPS/SOCKS5 单号代理；聊天、刷新、余额和任务共享账号出口；配置代理失败不退回直连。出口矩阵来自手动公共 IP 探测，不是上游账号可用性保证。
- 凭证导入（单对象或数组，单次最多100个/2MiB）与导出。导出含 token 和代理配置，请按密码文件保管。
- Chat Completions 与 Responses function/custom 工具适配；多轮历史可选本地持久化，TTL/LRU/字节预算。
- 成长任务服务独立于面板；保留原任务动作，部分活动属于尝试型/待上游验证，不能保证全部长期有效。部分任务会发送真实聊天、消耗积分。
- 调度、会话、日志队列、请求并发与请求体受限；默认4个聊天在途、16MiB单请求、32MiB请求体总预算，384MiB Go软内存目标（不是进程硬上限）。

## 行为边界

- Responses 目前先聚合 Chat 完整输出，再转换为 SSE 事件，**不是原生逐 token Responses 流式**；不支持远程搜索等托管内置工具。
- 模型目录以实际上游目录为准，可禁用模型与修改展示上下文；展示覆盖不改变上游真实上下文限制。未移植 VPS 的任意自定义模型添加/删除体系。
- 默认模型级积分保底100，保护收费模型调用；不叠加 VPS 的整号低余额迟滞禁用。
- 运行状态/会话绑定、Responses历史与日志彼此分离。历史包含输入和工具结果，明文保存在本机受权限约束的文件中，并非加密保险箱。
- 设置 memory.persistent=false 可禁用新历史的磁盘保存；旧文件不会自动删除。清空记忆请在仍启用持久化时使用页面操作。TTL过期后不再读取，旧磁盘条目在后续保存时清理。
- 账号任务开始后按原流程完成，客户端关闭页面不代表任务已经取消。退出程序前请等活动任务结束，优先使用 Ctrl+C（最多等待HTTP请求30秒）；强制停止可能留下上游已完成但本地未回读的状态。
- 没有多租户、付费售卖、原生 Anthropic API、自动注册、第三方供应商接入。

## 密码重置

先用 Ctrl+C 正常退出正在运行的本项目，在程序目录执行：

```powershell
.\workbuddy-local.exe -reset-password
```

重置为123456后重新启动。自定义配置须加 `-config <配置路径>`。改密会使当前进程旧会话失效；重新启动也需重新登录。密码保存为带随机盐的PBKDF2-SHA256哈希，不存明文密码。

## 配置和持久化

- config.json：在线深合并保存；密码不在此文件。
- auths/：账号凭证，包含敏感信息。
- data/password.json：密码哈希。
- data/state.json：账号池状态；data/bindings.json：粘性绑定（定期/正常退出保存）。
- data/conversations.json：Responses多轮历史，默认128条/32MiB/24小时。
- data/model-policy.json：模型启停与展示覆盖。
- data/usage.json：用量汇总，不依赖日志。
- data/request-logs/：可选请求元数据，不保存完整提示词/正文。

内存/监听/日志总开关等装配期设置需重启；界面会提示。不要跨版本直接复制旧完整配置，应依据新示例迁移。

## 可移除日志

`logging.enabled=false`：关闭日志收集/页面，需重启，保留业务状态和用量汇总。

```powershell
go build -tags no_logs -o dist/workbuddy-local-no-logs.exe ./cmd/server
```

no_logs 构建不依赖 reqlog 归档包，使用 telemetry.Noop；将来移除归档实现只需调整 logservice 适配器，而非修改聊天/任务代码。基础错误返回不依赖日志。

## 开发验证

需要 Go 1.24+，前端无需打包工具；有 Node.js 时执行真实 ES module 的单元与DOM夹具检查。

```powershell
go test ./...
go vet ./...
node --test internal/panel/frontend_modules_test.mjs internal/panel/frontend_pool_test.mjs
go build -trimpath -o dist/workbuddy-local.exe ./cmd/server
```

Go -race 需要本机可用C工具链；未安装时不能将普通测试等同竞态检测。真实上游、真实积分活动与大量账号负载需使用本人授权账号另行验收。

## Linux Docker（可选，未在本机部署验收）

提供的 Compose 使用 **Linux host network**，服务仍仅绑定宿主回环地址；不使用桥接端口映射。Windows建议原生exe。准备配置和数据目录，并赋予运行用户最小必要写权限；不要 chmod 777。使用前检查自己的 Docker 主机网络支持及权限。

## 模块边界

参见 docs/ARCHITECTURE.md；历史上游说明仅存档在 docs/UPSTREAM-README.md，不作为本版操作指南。
