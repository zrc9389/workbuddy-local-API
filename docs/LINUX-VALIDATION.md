# Linux主交付验收 · 2026-10-20

## 交付目标
Linux amd64（x86_64）与arm64（aarch64），主程序`wb2api`及可选`wb2api-no-logs`均为CGO关闭的Linux ELF64文件，附同架构固定v1.19.32 Mihomo。不是Windows.exe改名，也不是仅交叉编译后宣称运行正常。

## 已完成运行验证

### Linux amd64
- 真实Linux amd64 Docker引擎，Node24 Alpine容器，`--network none`、UID/GID10001、工作区只读挂载、临时数据放容器tmpfs；未使用生产服务或个人凭证。
- 24个含测试的Go包：全套Linux测试二进制运行通过，包含前端27项真实ES模块/DOM测试。
- Mihomo实际Linuxamd64内核：YAML/URI/Base64 provider、A/B路由隔离、长流、GLOBAL不串号、失效更新回滚、管理401/入口407、绑定重启恢复、空闲退出/唤醒/租约保护通过。
- 实际Linux网关HTTP：默认密码登录/管理401、18账号Demo、四维护步骤各15成功、3手动禁用跳过、3模拟节点测速/绑定、主题落盘、3模型、动态日志和Chat响应通过；正常SIGTERM返回0。
- 占用监听端口时网关返回非零，供systemd Restart=on-failure识别；退出先完成defer清理。

### Linux arm64
- 使用Docker Desktop已可用的arm64/QEMU仿真，不是原生ARM服务器性能验收。
- 执行真正arm64 Go测试程序和arm64 Mihomo：metacore全包及同一真实隔离内核E2E通过。
- arm64网关HTTP的同一18账号/四任务/节点/主题/模型/动态日志/Chat及SIGTERM冒烟通过。
- arm64不声称跑过全部24包，完整回归由amd64执行。QEMU耗时不能用于预测目标服务器吞吐。

## 由Linux运行发现并修复
- 原TestModelsEndpoint依赖外网模型目录，改成完整本机目录夹具，断网回归仍保留对模型列表与cn前缀的断言。
- 控制器/version就绪可能早于异步provider初始化；现在启动前最多5秒等待只读节点清单就绪，未就绪明确失败，不清空绑定或换到其他节点。单元红绿及两架构真实重启测试通过。

## 部署文件验证
- deployment/linux/test_artifacts.py：26项离线配置/验证器/launcher/权限/停机/健康检查测试通过。
- 两架构内核官方压缩资产digest、解压ELF64机器类型和SHA256均验证。manifest中Windows与Linux分开，不复用错架构校验值。
- Compose `docker compose config --quiet`通过；系统服务模板使用非root用户、可写的专用配置/数据目录、KillMode=mixed、120秒总停机窗口。
- 镜像构建上下文排除本地QA/运行数据/发布物/Windows内核，避免把凭证和测试二进制带入镜像。

## 打包复核
原生tar设置网关/内核/launcher0755，脚本LF无BOM、相对安全成员路径，普通配置模板不含真实凭证。打包器校验目标ELF架构、内核摘要和归档成员。源码不带二进制，需按本架构安装器补内核。

## 尚未执行
- 未连接或部署到你的实际服务器；完整systemd沙箱/cgroup服务生命周期未在真实systemd主机执行。
- 未构建并启动所提供完整Dockerfile/Compose生产镜像；上面的实际Linux测试容器验证的是原生程序，不混淆两者。
- 没有真实订阅、远程节点、真实账号OAuth/付费模型/1M token及长期多账号负载测试；相关验收仍需明确目标/权限/预算。
- 本机没有适用C工具链，-race未执行；普通Go测试不等同竞态检测。

## 安全访问
仍仅服务器 127.0.0.1 监听，管理密码由首次启动配置。客户端通过 SSH 隧道，不允许直接公网反代免 key 聊天；管理密码不是聊天 API 鉴权。示例命令见 LINUX-DEPLOYMENT.md。

证据：docs/linux-evidence（测试与合成数据，不是真实账号）。

## 最终发布归档实测
两个原生tar均在全新Linux容器tmpfs上解压，以UID/GID10001执行根start.sh。网关、内核和脚本精确0755；即使外部传入0.0.0.0环境值，受审核launcher仍只绑定127.0.0.1。默认密码登录、空账号池、附带同架构内核可用、主题原子保存、SIGTERM返回0通过。两个no_logs二进制即使配置启用日志也保持日志接口404而usage可用。

Linuxamd64另跑合成1/4/8MiB×1/2/4/8发起并发12组合成完整性测试（强制压力spool，本机mock上游）；12组通过。384MiB Go软目标下，/proc进程RSS的427次采样峰值322539520字节（约307.6MiB），耗时6.503秒。包含测试夹具分配，不是生产硬上限、真实1M token或目标服务器性能承诺。ARM/QEMU不作吞吐/内存性能外推。
