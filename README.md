# WorkBuddy Local API · 3.0.1 正式版

WorkBuddy 的本地 API 和管理面板。

- 账号授权、账号池与额度管理
- 订阅节点与账号出口配置
- OpenAI 兼容接口、模型查看与缓存
- 账号任务、用量与错误记录
- 音频、文案与界面个性化

## 更新与升级
默认更新源已预置为 `zrc9389/workbuddy-local-API`。可在 `config.json` 的 `update` 段修改 `github_owner` / `github_repo`，或将两者置空以禁用面板检查和下载更新。面板只接受通过校验的同平台发行二进制。

`3.0.1 预览版 / 测试版` 老用户需要手动下载 `3.0.1 正式版` 的二进制或发行包覆盖升级；升级到 `3.0.1 正式版` 后，后续版本（如 `3.0.2`）即可直接通过面板检查并下载更新。Linux systemd 最小权限部署下 `/opt/workbuddy-local` 默认只读，升级方式与权限放开步骤见 `docs/LINUX-DEPLOYMENT.md` 的升级说明。

## 运行
安装 Go 后，参考 `config.example.json` 配置，运行 `go run ./cmd/server`。网关默认只监听 `127.0.0.1`，公网部署前请自行配置访问控制与 HTTPS。

## 发行内容
发行包不包含账号凭证、订阅或个人音频；配置、账号、状态和日志均需在部署后由使用者自行生成并妥善保护。
