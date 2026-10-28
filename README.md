# WorkBuddy Local v0.2 · Linux服务器多账号池

**仅本机使用，首次启动时设置管理密码，聊天不需要 API key。** 此版是在 v0.1 基础上的改造；原 v0.1 发布包保留。请在新目录解压，不要直接覆盖含凭证的旧目录。

## Linux服务器（主交付）

提供 `linux-amd64`（x86_64）和 `linux-arm64`（aarch64）原生tar.gz包，均附对应架构的已校验Mihomo内核。Linux推荐使用包内 `deployment/linux/workbuddy-local.service`，以专用非root用户运行。详细手工部署步骤见 **docs/LINUX-DEPLOYMENT.md**；架构及运行验收见 **docs/LINUX-VALIDATION.md**。

部署后仍只监听服务器 `127.0.0.1:7863`，不是公网免密服务。从你的电脑通过SSH隧道使用：

```sh
ssh -N -L 127.0.0.1:7863:127.0.0.1:7863 user@your-server
```

然后访问本地 `http://127.0.0.1:7863/panel/`。不要开放服务器 7863 防火墙端口，也不要直接公网反代免 key 聊天。首次启动时设置管理密码。

tar包的主程序名为 `wb2api`；先按手册准备 `/etc/workbuddy-local/config.json` 和 `/var/lib/workbuddy-local` 的服务用户权限，再前台验证：

```sh
sudo -u workbuddy-local /opt/workbuddy-local/deployment/linux/start.sh /etc/workbuddy-local/config.json
```

启动器只做检查和exec，不安装/修改服务，不自动下载内核，不接受root运行。不要用Windows.exe部署Linux。systemd模板先SIGTERM网关等HTTP排空，超时120秒才最终清理进程组；没在你的生产服务器实际安装或启动服务。

## Windows（辅助开发/演示，不是主交付目标）

- `start.cmd`：正常模式；面板 `http://127.0.0.1:7863/panel/`。
- `start-demo.cmd`：独立演示模式；本机模拟上游、18个模拟账号、3个模拟节点、动态用量与日志。醒目标记DEMO，不读取正常账号或订阅。
- `start-no-logs.cmd`：无日志归档构建，统计仍独立工作。
- `start-demo.cmd`与正常模式默认使用同一端口，不可同时启动。需要同时运行时使用环境变量 `WB2A_LISTEN=127.0.0.1:另一个端口`。

保持窗口开启，退出优先 Ctrl+C。首次启动会生成 config.json 与密码哈希；登录后可在「设置」修改密码。忘记密码须先停止程序，再在该模式目录执行 `workbuddy-local.exe -reset-password`；演示模式需加 `-demo`。

## 这一版的页面

- **概览**：第一项，内容刻意留空。
- **账号池**：卡片，仅启用/禁用、删除和出口入口。手动禁用红边、系统冷却/余额保护黄边、健康绿边；保留分页，无搜索/筛选/批量操作。
- **任务**：Token保活、签到、活跃、旅行四项统一「全部执行」，无单项开关或执行按钮。结果来自真实业务调用；自动维护排程不会启动，旧schedule配置仅为兼容数据，不能暗中执行。
- **出口**：三块等宽2:1卡片展示累计流量、实时速率、节点测试；点击账号出口自动开始有限并发测速，逐节点显示ms/超时/错误。
- **用量/积分/模型/日志**：展示真实后端数据，无搜索/筛选；有界分页避免大量DOM。
- **设置**：密码、主题、余额阈值、订阅，默认阈值100。

## 余额与状态

**已确认余额低于100时阻止整个账号选号**，不是v0.1仅限制收费模型。余额未知不会当作0；余额恢复不会清除用户手动禁用。手动启用只撤销手动标记，不会伪造凭证正常或提前解除上游限流。删除活跃账号或正在使用的代理配置可能返回409，请待请求结束再操作。

## Meta出口

Linux两种架构和Windows amd64运行包附固定校验的 Mihomo v1.19.32；Linux路径为 `third_party/meta/bin/linux-ARCH/mihomo`，Windows为 `third_party/meta/bin/windows-amd64/mihomo.exe`。不改系统代理、不启TUN；控制器及每账号入口只监听本机，控制凭据不发前端。

每账号独立本机入口/选择组；选A的节点不改变B。后台请求（刷新、任务、余额）与聊天同样取得账号代理租约；请求结束才释放。无活跃连接/租约时闲置退出，下一请求自动唤醒并恢复绑定。连接失败不退回直连。

在设置导入HTTPS订阅，使用内核原生YAML/URI/Base64 provider解析，不接受远端完整配置接管本机监听。内网地址和重定向等受限，不将订阅中的密码展示在页面。账号流量来自采样，标记为估算；节点延迟不等于带宽。

**metacubexd只复用固定版本的实际延迟趋势模块，不是完整dashboard。** 来源/许可证/校验见 `third_party/meta/manifest.json` 与 `docs/META.md`。支持固定校验的Linux amd64/arm64及Windows amd64内核，不回退到任意PATH程序。

## 记忆、内存和磁盘缓冲

- Chat请求由客户端携带历史；Responses续接使用本地历史档案。粘性绑定不等同消息记忆。
- TTL/LRU仅淘汰热缓存，不删除持久档案；容量上限4GiB/100000条，满时拒绝新增并保留已有历史。
- 上下文档案有校验信息；正常请求走内存，内存/并发预算不足时才用64KiB缓冲暂存磁盘，完整sync后排队。
- 队列最多32项/1GiB，最多等待60秒；已发出但结果不确定的请求标为unknown，不自动重放。失败记录留在data/spool，需人工核对，不擅自重复扣费。
- 执行仍有JSON整包转换，采用保守工作预算准入；太大的历史/请求明确拒绝，不静默删除前缀。384MiB是Go软目标，不是进程硬内存上限。
- 默认严格上下文模式拒绝孤立工具结果/缺失工具结果，不用兼容清理把内容悄悄删掉；不替换客户端system，不自动指纹清洗或拦截后改写提示词。上游拒绝时如实报错。
- 归档目前每response仍保存完整前缀，有磁盘写放大。清空记忆只切换活动代次，旧文件不自动批量删除；敏感数据清理需明确手动处理。
- Responses仍是完整Chat输出聚合后转SSE，不是原生逐token流。

**不能承诺任意上游模型在任何情况下都不失忆**。本版保证网关不以“自动摘要/截断”假装成功；上游真实窗口、token计算和模型回忆能力必须另验。

## 测试边界

完整回归与真实本机内核测试见 `docs/V02-VALIDATION.md`。已做合成1/4/8MiB、1/2/4并发完整性/压力排队测试；不把字符数当token数。真实1M上下文需提供模型、tokenizer、账号权限及消耗预算后执行，未验收。

## 配置和开发

源码需Go1.24+；前端是独立原生ES modules，无Node运行依赖。Node只用于测试。

```powershell
go test ./...
go vet ./...
node --test internal/panel/frontend_modules_test.mjs internal/panel/frontend_pool_test.mjs internal/panel/frontend_preview_test.mjs internal/panel/frontend_v02_test.mjs
go build -o dist/workbuddy-local.exe ./cmd/server
go build -tags no_logs -o dist/workbuddy-local-no-logs.exe ./cmd/server
$env:META_REAL_TEST='1'
go test ./internal/metacore -run TestRealCore -v -count=1
```

源码包不带大型内核文件。Linux源码构建前用 `sh scripts/meta-install-linux.sh` 获取本架构固定校验版本；Windows可用 `scripts/meta-install.ps1`。运行包已附内核。安装脚本不会覆盖已有EXE。不读取他人的订阅或凭证。

Dockerfile/Compose已适配Linux双架构、非root和host-network，仅作手动可选方案。实际Linux运行测试是在隔离容器中测试原生程序，不等同已在你的服务器部署，也不等同此Dockerfile完整镜像构建已验收。

后端模块和HTTP契约见docs/ARCHITECTURE.md、docs/META.md、docs/V02-STATUS.md。日志关闭不影响usage/历史/任务；demo-data与data/auths严格隔离。仅应管理自己拥有或授权的账号。
