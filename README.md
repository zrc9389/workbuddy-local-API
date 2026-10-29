# WorkBuddy Local API · 3.0.1 预览版

WorkBuddy 的本地 API 和管理面板。

- 账号授权、账号池与额度管理
- 订阅节点与账号出口配置
- OpenAI 兼容接口、模型查看与缓存
- 账号任务、用量与错误记录
- 音频、文案与界面个性化

这是预览版。自动更新源尚未配置，公网部署前请自行配置访问控制和 HTTPS。项目不包含账号凭证、订阅或个人音频。

安装 Go 后，参考 config.example.json 配置，运行 go run ./cmd/server。
