# Linux 服务器部署（主交付目标）

适用目标：Linux `amd64`（`x86_64`）和 `arm64`（`aarch64`）。推荐原生包 + systemd；Docker 是需要人工选择的替代方案。二者不能同时占用 `127.0.0.1:7863`。没有安装、启动、删除、更新 sysctl 或修改防火墙的自动脚本；下列管理员命令是**人工审核后的示例，不代表已经执行**。

## 1. 安全边界与首次使用

- 网关只监听 `127.0.0.1:7863`，`start.sh` 也固定该回环地址；不支持把模板改成 `0.0.0.0`、`[::]` 或裸公网反向代理。Mihomo 控制端和每账号代理入口也由程序约束在回环。
- 管理界面使用密码 + 会话。**初始密码为 `123456`，第一次登录后必须在设置里修改**，修改后重新登录。不把密码/令牌写入 service、Compose、环境变量或命令行。
- 本地聊天 API **不需要 API key**。管理密码不保护聊天 API，回环也不是多租户隔离：同机用户、host-network 容器和获得隧道权限的人可能消耗额度。只部署在受信任主机，限制 SSH 账号与转发权限。
- 不开放服务器 7863 入站端口；客户端通过 SSH 本地隧道访问（第 5 节），不用 `ssh -g`、公网反向转发或通配地址绑定。
- 密码哈希在 `/var/lib/workbuddy-local/password.json`，不是明文密码文件。配置、账号、订阅、代理凭证、历史、spool 与日志均按敏感文件处理，不放进公开工单或发行包；不用真实账号做冒烟测试。

## 2. 文件布局、权限和绝对路径

| 路径 | 所有者/权限建议 | 用途 |
| --- | --- | --- |
| `/opt/workbuddy-local` | root:root，目录 0755，普通文件 0644 | 只读发行内容、systemd 工作目录 |
| `/opt/workbuddy-local/wb2api` | root:root，0755 | Linux 网关，不是 Windows exe |
| `/opt/workbuddy-local/deployment/linux/start.sh` | root:root，0755，LF | 前台启动器，最终 exec Go 进程 |
| `/opt/workbuddy-local/third_party/meta/bin/linux-ARCH/mihomo` | root:root，0755 | 对应架构的固定版内核 |
| `/etc/workbuddy-local` | 服务用户/组，0700 | 仅此专用配置目录可写，不放开整个 /etc |
| `/etc/workbuddy-local/config.json` | 服务用户/组，0600 | 在线设置写临时文件并重命名，父目录必须可写 |
| `/var/lib/workbuddy-local` | 服务用户/组，0700 | state.json 及同目录派生数据 |
| `/var/lib/workbuddy-local/auths` | 服务用户/组，0700；文件 0600 | 账号凭证 |

示例：`deployment/linux/config.json.example`，关键字段：

```json
{
  "listen": "127.0.0.1:7863",
  "auth_dir": "/var/lib/workbuddy-local/auths",
  "state_file": "/var/lib/workbuddy-local/state.json"
}
```

`state_file` 的父目录决定 password.json、usage.json、conversations.json、模型策略、meta/、spool/ 等位置。不要误配成 `/opt/workbuddy-local/state.json` 或依赖当前目录下 `./data`；service/Compose 也将账号、状态路径固定为这些绝对路径。

内核默认路径仍相对**进程工作目录**：`third_party/meta/bin/linux-ARCH/mihomo`。发行包必须保留目录结构，不能只复制网关。`WorkingDirectory=/opt/workbuddy-local` 与可写数据位置是两回事，不需要让整个应用目录可写。禁止 chmod 777；不需 root 运行、TUN、NET_ADMIN、宿主系统代理或 sysctl 变更。

## 3. 原生包手工准备（不自动执行）

前提：已审核的匹配架构发行包、现有 CA 证书及需要的时区数据。按**本次** SHA256SUMS.txt 核验，不借用历史 Windows 包校验值。以下仅用于全新目录，不是覆盖升级脚本。

### 3.1 用户与目录

先查同名用户/组和目录；存在则核对身份/内容/备份，不重复创建或覆盖：

```sh
getent passwd workbuddy-local
getent group workbuddy-local
ls -ld /opt/workbuddy-local /etc/workbuddy-local /var/lib/workbuddy-local
```

确认全新安装后，管理员手工执行（nologin 路径按发行版确认）：

```sh
sudo groupadd --system workbuddy-local
sudo useradd --system --gid workbuddy-local --home-dir /var/lib/workbuddy-local \
  --no-create-home --shell /usr/sbin/nologin workbuddy-local
sudo install -d -m 0755 -o root -g root /opt/workbuddy-local
sudo install -d -m 0700 -o workbuddy-local -g workbuddy-local \
  /etc/workbuddy-local /var/lib/workbuddy-local /var/lib/workbuddy-local/auths
```

systemd 用户 UID 不固定，Docker 固定 `10001:10001`。不要在两种模式间直接共用数据路径，否则须另行审核所有权映射。

### 3.2 发行文件与配置

先查看归档成员，拒绝绝对/`..` 路径、陌生脚本与意外凭证，不把未审核归档以 root 解到 `/`。把已核验内容置于 `/opt/workbuddy-local`，保持 root 所有、服务用户只读。

```sh
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
  *) printf '%s\n' 'Unsupported architecture' >&2; exit 1 ;;
esac
sudo chmod 0755 /opt/workbuddy-local/wb2api \
  /opt/workbuddy-local/deployment/linux/start.sh \
  "/opt/workbuddy-local/third_party/meta/bin/linux-$ARCH/mihomo"
# 仅初次：显式拒绝覆盖现有配置；不要整段用于升级。
sudo test ! -e /etc/workbuddy-local/config.json || { printf '%s\n' 'Config exists; preserve it and stop.' >&2; exit 1; }
sudo install -m 0600 -o workbuddy-local -g workbuddy-local \
  /opt/workbuddy-local/deployment/linux/config.json.example \
  /etc/workbuddy-local/config.json
sudo -u workbuddy-local test -r /etc/workbuddy-local/config.json
sudo -u workbuddy-local test -w /etc/workbuddy-local
sudo -u workbuddy-local test -w /var/lib/workbuddy-local
sudo -u workbuddy-local test -x /opt/workbuddy-local/wb2api
sudo -u workbuddy-local test -x "/opt/workbuddy-local/third_party/meta/bin/linux-$ARCH/mihomo"
```

NTFS/ZIP 可能不保留执行位；Linux 上检查 test -x，打包器需将启动器/二进制/内核设 0755，脚本保持 LF。上述权限检查不等于运行验收。start.sh 拒绝 root、非 Linux、不支持架构、不可写/缺失配置及缺失内核；不自动修权限、生成配置或下载内核。程序还会按代码固定 SHA256 校验内核，不退到其它架构或任意 PATH 程序。

需要前台诊断时，先确认没有 systemd/Docker 实例，再手工执行：

```sh
sudo -u workbuddy-local /opt/workbuddy-local/deployment/linux/start.sh \
  /etc/workbuddy-local/config.json
```

退出优先 Ctrl+C 并等日志结束，不把 kill -9 当正常停机。

## 4. systemd、停机与资源

模板：`deployment/linux/workbuddy-local.service`。审阅后安装/验证，最后再由管理员选择启动：

```sh
sudo install -m 0644 -o root -g root \
  /opt/workbuddy-local/deployment/linux/workbuddy-local.service \
  /etc/systemd/system/workbuddy-local.service
sudo systemd-analyze verify /etc/systemd/system/workbuddy-local.service
sudo systemctl daemon-reload
# 单独的人工启动决定，不是安装命令的自动后续步骤：
sudo systemctl start workbuddy-local.service
# 确实需要开机启动才执行：
# sudo systemctl enable workbuddy-local.service
sudo systemctl status --no-pager workbuddy-local.service
sudo journalctl -u workbuddy-local.service -n 60 --no-pager
```

- `workbuddy-local` 用户/组、`UMask=0077`，不配置 EnvironmentFile 或密码/令牌环境变量。`ProtectSystem=strict` 只放行专用配置/数据目录，另有隔离临时目录；/opt 只读。
- **`KillMode=mixed`、`KillSignal=SIGTERM`**：先只通知网关主进程，停止接收并排空流式请求，保留 Mihomo。不要改回 control-group，否则初始 TERM 同时终止内核，可能提前截断 SSE。
- HTTP 排空最多 30 秒 + 维护关闭最多 30 秒 + Mihomo 关闭最多 10 秒，还要状态写入余量，故 **`TimeoutStopSec=120s`**，不是 40 秒。`SendSIGKILL=yes` 保留最终 cgroup 强杀兜底。mixed 模式下主进程退出时剩余子进程也会被清理，并非允许子进程继续存活满 120 秒。
- `Restart=on-failure`，间隔 5 秒，60 秒内最多 3 次；人工正常 stop 不触发故障重启。能启动不等于账号/订阅/模型 ready。
- `GOMEMLIMIT=384MiB` 是 **Go 软目标**，不包含全部 Mihomo 内存，也不是 RSS/cgroup 硬上限。示例并发 2、请求体上限 16 MiB、热历史预算 32 MiB；另有转换、缓冲、归档开销。
- `TasksMax=512`、`LimitNOFILE=8192` 是保守起步进程/线程/fd 预算，超出仍可能失败；`CPUWeight=100` 是相对权重而非固定配额。**不设 MemoryMax/mem_limit**，不把 OOM 强杀包装成“保证不丢数据”。需为系统、网关、Mihomo 和峰值请求留余量，并监测 RSS/空闲磁盘/并发后再调参。
- SIGKILL、OOM、掉电、磁盘满、30 秒仍未结束的请求或最终强制终止，均可能使调用结果或磁盘 receipt 状态不确定。不要自动重放付费请求，不承诺绝对不丢数据；持久化/校验不替代备份和恢复演练。

Docker Linux 的 daemon SIGTERM 试验**不代替**真正由 PID 1/systemd 启动后的 cgroup、沙箱、重启策略与顺序验收；目标发行版需要完整 service 验证。

## 5. SSH 本地隧道和无 key API

在客户端（非服务器）运行，替换成已有合法 SSH 账号/主机：

```sh
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:17863:127.0.0.1:7863 operator@server.example
```

保持隧道存活，浏览器打开 `http://127.0.0.1:17863/panel/`，123456 登录后**立即改密**。OpenAI-compatible base URL 为 `http://127.0.0.1:17863/v1`；本地 API 无需 Authorization/API key。客户端如强制要求非空 key，只填本地占位值，它不提供安全保护。不要替换成裸公网地址。

```sh
curl --noproxy '*' --fail --silent --show-error http://127.0.0.1:17863/auth/session
```

未登录的 HTTP 200、`authenticated=false` 是正常情况，不创建登录会话。`/healthz` 属于账号池 readiness，空池 503 **不等于进程死亡**；结合账号/余额/代理状态诊断，不据此不停重启。

## 6. 可选 Docker（Linux 主机，人工选择）

### 6.1 构建输入、架构与来源

BuildKit BUILDPLATFORM/TARGETOS/TARGETARCH：构建阶段本机架构交叉编译 Go，runtime 匹配目标 Alpine。只允许 linux/amd64、linux/arm64。构建上下文必须已有对应固定版内核与来源清单：

```text
third_party/meta/manifest.json
third_party/meta/bin/linux-amd64/mihomo     # amd64 构建必需
third_party/meta/bin/linux-arm64/mihomo     # arm64 构建必需
third_party/meta/MIHOMO-LICENSE
third_party/meta/metacubexd/                # 嵌入资源与许可证
```

内核固定 **v1.19.32**，版本、精确 release asset URL、压缩归档 SHA256/来源和解压后二进制 SHA256，均继承**对应平台** manifest，不借用 Windows 字段。`deployment/linux/verify-mihomo.py` 离线检查 ELF64/目标机器类型/大小/二进制 SHA256，缺记录、错架构、缺来源、摘要不符即失败。它不联网复核归档，不把“本地二进制 hash”冒充“GitHub 归档 digest”，不重新生成待信任的 pin。

缺内核时先审阅固定版本的 `scripts/meta-install-linux.sh`，或由维护者按 manifest 的官方固定资产地址手工准备；不 curl latest，不改 manifest 让任意二进制通过。Dockerfile **不下载内核**。

正常构建可能联网获取 BuildKit `docker/dockerfile:1.7` 前端、拉取 `golang:1.26-alpine`、`alpine:3.23`，通过 apk 安装构建用 python3、运行用 CA 证书/时区/curl，通过 go.mod/go.sum 获取 Go 依赖；没有自动下载最新版内核。基础镜像为明确版本系列 tag，**不是不可变 digest pin**；完全复现需发布者另行固定已审核镜像 digest/包版本/环境，不能据此声称离线或位级可复现。Dockerfile 只复制显式源码/嵌入资源，不把运行数据、QA、演示和 release 目录复制入构建层。

先做不构建、不启动的检查：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 deployment/linux/test_artifacts.py
python3 deployment/linux/verify-mihomo.py --arch amd64
python3 deployment/linux/verify-mihomo.py --arch arm64
sh -n deployment/linux/start.sh
sh -n deployment/linux/healthcheck.sh
sh -n deployment/linux/package-start.sh
docker compose config --quiet
```

明确需要 Docker 时，操作者匹配服务器架构选择一条构建命令：

```sh
docker buildx build --platform linux/amd64 --load -t workbuddy-local:linux-amd64 .
# ARM64 对应构建：
# docker buildx build --platform linux/arm64 --load -t workbuddy-local:linux-arm64 .
```

交叉编译不等于目标运行。runtime 阶段会执行目标架构 apk/RUN，跨架构需**已有可用** QEMU/binfmt 或目标原生 builder；缺少时换原生机器，不自动装/启模拟器。未有原生 ARM/QEMU 实测证据时，不称 ARM64 已运行验收。

### 6.2 非 root 与可写目录

固定 UID/GID `10001:10001`、代码只读、CA/时区可读。Compose 只挂载两个**目录**；宿主目录缺失时 `create_host_path: false` 报错，不默默创建 root 所有路径：

| 宿主（Compose 目录下） | 容器 |
| --- | --- |
| ./runtime/config，0700、10001:10001 | /etc/workbuddy-local |
| ./runtime/data，0700、10001:10001 | /var/lib/workbuddy-local |

```sh
# 人工审核后仅用于全新目录。已有 runtime/配置时先审查，不能覆盖。
sudo install -d -m 0755 ./runtime
sudo install -d -m 0700 -o 10001 -g 10001 \
  ./runtime/config ./runtime/data ./runtime/data/auths
sudo test ! -e ./runtime/config/config.json || { printf '%s\n' 'Config exists; preserve it and stop.' >&2; exit 1; }
sudo install -m 0600 -o 10001 -g 10001 \
  deployment/linux/config.json.example ./runtime/config/config.json
```

不要只绑定单个 config.json 或设置其父目录只读：在线设置需临时文件加原子替换。单文件绑定可能报 EBUSY，即使有降级写入，也不依赖非原子保存。rootless/userns-remap/SELinux 的映射与标签须按宿主实际环境单独审查，不用 chmod 777 或关闭安全机制代替诊断。

Compose `network_mode: host` **仅面向原生 Linux 服务器**，让网关与 Mihomo 的 127.0.0.1 保持同一宿主网络命名空间；没有 ports/公网发布/自动 sysctl。host network 不提供网络命名空间隔离，不是多租户方案。Docker Desktop/桥接可访问性不在此方案承诺内，不改 0.0.0.0 迁就桥接。HEALTHCHECK 用精确 HTTP 200 的 `/auth/session`，不以空池 readiness 判死。

```sh
# 人工决定启用 Docker 后执行，不与 systemd 同时启动。
docker compose up --build -d
docker compose ps
# 正常退出给 120 秒，先保留 Mihomo 供网关排空。
docker compose stop -t 120
```

STOPSIGNAL SIGTERM + exec 让主进程直接收信号，无提前给所有进程发 TERM 的 init wrapper。Compose 超时仍会强杀；日志轮转 10 MiB × 3、私有 /tmp 为 64 MiB tmpfs、512 pids/8192 fds，都不是持久化安全承诺。Docker daemon 被杀/重启也不等于应用正常停机。

## 7. 完整源码构建与发布包契约

主编译/打包流程提供匹配平台 wb2api/归档，本部署目录不触发编译/服务操作。源码不是 Windows-only，但**可交叉编译、实际 Linux 编译、实际 Linux 运行、ARM 运行、完整 systemd 验收是不同证据**，必须分别记录命令/平台/结果。

完整源码包至少保留：

- go.mod、go.sum、cmd/**、internal/**（包括 panel HTML/JS/assets、model.json、prompt 等 go:embed 输入及测试）；
- third_party/meta/assets.go、metacubexd/**、固定平台内核、完整 manifest 与许可证；
- deployment/**、scripts/meta-install-linux.sh、Dockerfile、docker-compose.yml、.dockerignore、本说明、根 LICENSE。

剔除真实 config.json、账号、状态、订阅、密码哈希、spool、请求日志、生成的演示数据、QA、旧 release、.git；不能为了“完整”附带凭证。Python **3.9+** 用于验证器；Go 按 go.mod 最低版本及发布工具链；前端已嵌入，无需 npm 构建，Node 仅前端测试需要。已有对应工具时，在解出的干净源码目录运行：

```sh
# 可能按 go.mod/go.sum 获取依赖，不是当前已经执行的编译承诺。
go test ./...
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o wb2api ./cmd/server
# 在独立 ARM64 目标目录/副本构建，避免覆盖上面的 amd64：
# CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o wb2api ./cmd/server
# 可选裁掉请求日志：
# CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags no_logs -trimpath -o wb2api ./cmd/server
```

发行包根目录的便利 `start.sh` 使用 `deployment/linux/package-start.sh` 模板，由主打包流程复制到包根并设为 0755；它只 exec `deployment/linux/start.sh`，原样转交可选绝对配置路径，不创建 /etc 目录或配置。以服务用户运行 `/opt/workbuddy-local/start.sh /etc/workbuddy-local/config.json`；源码目录直接用嵌套启动器，不直接运行包根模板。systemd 仍使用嵌套启动器，工作目录保持 /opt/workbuddy-local。

每个原生包保留 wb2api、对应 third_party/meta/bin/linux-ARCH/mihomo、manifest/许可证、deployment/linux/ 与部署文档；保留 metacubexd/LICENSE。辅助 CLI 只有已编译/打包才称随附，不复制旧 Windows exe 冒充 Linux。tar 内 `.sh`、wb2api、内核需明确 **0755**；配置模板不含密码/令牌。发布后重新解包，核验 ELF/执行位/摘要，主流程对解包件做 Linux 冒烟/优雅退出验证，更新当次 SHA256SUMS。

## 8. 运维、备份与验收边界

- 正常停机使用 `sudo systemctl stop workbuddy-local.service` 或 `docker compose stop -t 120`；确认日志结束、端口释放、内核无残留后备份**整个**专用配置和数据目录，不能只备份 state.json 而漏掉账号/密码/历史/Mihomo/spool。
- 备份含敏感信息，使用管理员指定的访问受限目录；优先离线一致性备份，恢复先在隔离目录验证。没有自动覆盖/清空/递归删除步骤，升级保留旧发行与备份供人工回滚。
- 忘记密码先正常停掉**同数据目录实例**，用相同服务用户/配置离线重置，再启动并立即改密。不删除 password.json、不改到新数据目录假装修复：

```sh
# 明确需要重置才人工运行；已停机，此命令重置为 123456 并退出。
sudo -u workbuddy-local sh -c \
  'umask 077; cd /opt/workbuddy-local && exec ./wb2api -config /etc/workbuddy-local/config.json -reset-password'
```

- 业务另验：登录/改密，设置保存/回读，空池状态，合成账号导入导出，真实内核/绑定，SIGTERM 请求与维护排空，重启持久化，错误权限/校验失败拒绝。真实账号/上游须另有授权，不以部署测试名义消费额度。
- 此部署工作包已做：26 项本地离线验证器/模板/无网络 shell 行为测试、Git Bash shell 语法、提供的 amd64/arm64 内核 ELF64 机器类型与 manifest SHA256 比对；不执行内核，不启动 Docker/服务，不代表整包 Linux 运行验收。
- 主流程回报（2026-10-20，非本部署工作包复跑）：Docker Linux amd64 的全套 24 个 Go 测试二进制、真实 Mihomo、18 账号 HTTP demo 和 SIGTERM 已通过。此证据不等同于本 Dockerfile 已构建/运行；**可选 Docker 镜像尚未构建**，完整 systemd/cgroup 沙箱尚未验收。最终源码/原生归档须由主打包流程另做解包验证。
- 主流程回报（2026-10-20）：ARM64 的真实内核与 demo HTTP E2E 已在 Docker/QEMU 下通过；provider 异步就绪采用最多 5 秒的 inventory 等待，新增红绿回归后完成重跑。此为 **QEMU 模拟 ARM64 运行**，不是原生 ARM 服务器全量验收，不把交叉编译、/version 200 或 QEMU 存在本身当运行通过。具体平台与结果以主流程随发行归档的验收记录为准。

官方语义参考，部署前按目标版本核对：

```text
https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html
https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html
https://docs.docker.com/reference/dockerfile/
https://docs.docker.com/engine/network/drivers/host/
https://docs.docker.com/reference/compose-file/services/
```


## 9. Linux隔离演示（非生产账号）

使用普通用户可写的新目录运行绝对路径程序，不在只读/opt下生成演示数据，也不指向生产config/auths。下面只作人工示例；7864仅本机且不会与生产7863冲突：

```sh
mkdir -p "$HOME/workbuddy-local-demo"
cd "$HOME/workbuddy-local-demo"
WB2A_LISTEN=127.0.0.1:7864 /opt/workbuddy-local/wb2api -demo
```

页面醒目标记DEMO；所有账号、节点、模型与动态日志是模拟数据。演示mode不读取正常账号/订阅，Ctrl+C正常退出。通过另一个本地SSH隧道访问服务器127.0.0.1:7864，不公开暴露。

Dockerfile/Compose仅随源码包提供，从源码构建；原生运行tar不包含完整Go构建树，不能当Docker build上下文。
