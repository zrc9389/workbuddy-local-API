# Mihomo Linux 原生内核支持

本文件仅覆盖 `internal/metacore` 平台选择、固定内核、校验安装与隔离测试。非 root 应用安装、systemd unit、Docker 发布由独立部署文档负责；本次没有安装系统服务、打开 TUN、更改系统代理、导入真实订阅或使用生产凭据。

## 固定版本及兼容边界

- 所有平台使用同一官方版本 `v1.19.32`，不使用 latest、镜像源、滚动版本或自行重编译内核。
- 原 Windows amd64 compatible 二进制、SHA-256、PowerShell 安装脚本及现有发布包均保留。
- 新增 Linux amd64 compatible 与 Linux arm64。其他系统/架构不回退到不匹配内核。
- `Factory` / `Options` 接口不变；`Options.Binary` 仍可指定绝对路径，但必须通过当前平台的固定 SHA-256 才会被运行。
- 没有改动 manager 业务逻辑或进程管理文件。Linux 沿用普通子进程与现有 Stop/Wait；没有设置 `Pdeathsig`。若由 systemd 管理，依赖其默认 control-group 杀进程策略回收子进程；本次未创建、修改或验收服务单元。

## 可移植路径 API

新增文件 `internal/metacore/platforms.go`：

```go
func KernelPath(goos, goarch string) (string, bool)
```

返回相对于仓库/应用根目录的路径，使用当前 Go 主机的路径分隔符；不支持的平台返回 `"", false`。例如：

```go
relative, ok := metacore.KernelPath(runtime.GOOS, runtime.GOARCH)
if !ok {
    return errors.New("unsupported pinned kernel platform")
}
// root 必须是明确的仓库/应用根目录，而不是任意当前目录。
binary := filepath.Join(root, relative)
```

| GOOS/GOARCH | 仓库相对路径 |
| --- | --- |
| windows/amd64 | `third_party/meta/bin/windows-amd64/mihomo.exe` |
| linux/amd64 | `third_party/meta/bin/linux-amd64/mihomo` |
| linux/arm64 | `third_party/meta/bin/linux-arm64/mihomo` |

`newNative` 默认路径使用同一个 helper。调用方不在仓库根目录启动时应继续显式传入 `Options.Binary`，或将工作目录设为应用根目录。真实 E2E 位于 `internal/metacore/native_test.go`，也使用此 helper，不再写死 `.exe`。

## 官方来源与双重 SHA-256

来源为 GitHub 官方主仓库 `MetaCubeX/mihomo` 的标签发行资产，不是第三方镜像：

```text
release API: https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/v1.19.32
release ID: 400265188
published: 2026-09-30T17:09:36Z
archive base: https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/
```

当前所有资产元数据、大小、下载地址、源码/许可证指针、Linux 安装器源码 SHA-256 记录在 `third_party/meta/manifest.json`。原顶层 `mihomo` 的 Windows 字段为兼容保留；`mihomo.platforms` 为三平台完整表，测试要求它与 Go 内置 pins、安装脚本一致。

### Linux amd64

```text
asset ID:       601415773
archive:        mihomo-linux-amd64-compatible-v1.19.32.gz
archive bytes:  22877876
archive sha256: ba3ce607747a07f948fc35780e108a4a7c7f552a38b9bd4d115f313ebcb89c20
binary bytes:   62054526
binary sha256:  7a0d59da2e678d56c899a3db996a2ad8963286c4f3634b0451435db248f13fa1
ELF:            64-bit little-endian; e_machine=62; no PT_INTERP
binary mode:    0755
```

### Linux arm64

```text
asset ID:       601415736
archive:        mihomo-linux-arm64-v1.19.32.gz
archive bytes:  20809592
archive sha256: 9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0
binary bytes:   57409662
binary sha256:  c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754
ELF:            64-bit little-endian; e_machine=183; no PT_INTERP
binary mode:    0755
```

这些 archive SHA 来自本次直接读取官方 release API 的 `assets[].digest`；随后对下载文件独立计算 SHA-256，仅在 digest 与字节数均匹配后解压，再对实际二进制计算 SHA-256 并检查 ELF 架构。不是只信任文件名或解压成功。该证明基于官方资产 digest，不等同于可复现构建或独立签名证明。

### Windows 保持不变

```text
archive:        mihomo-windows-amd64-compatible-v1.19.32.zip
archive sha256: 974a4d7ad69aed27aa2e8f91d61113573c14dadb14562c63e58effabf59816f0
binary sha256:  04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314
```

## Linux 安装器

在仓库根目录运行；不需要 root，不安装服务，不修改网络配置：

```sh
# 自动识别 x86_64 / aarch64，目标为仓库 third_party/meta/bin/linux-ARCH/mihomo
sh scripts/meta-install-linux.sh

# 预置另一架构，安装器仅校验，不执行目标内核
sh scripts/meta-install-linux.sh --arch arm64

# 显式安装目录；--destination 指目录，不是 mihomo 文件名
sh scripts/meta-install-linux.sh --arch amd64 --destination "/path/with spaces/linux-amd64"

# 离线使用同一官方 .gz；仍做同样 archive + binary 双重校验
sh scripts/meta-install-linux.sh --arch amd64 \
  --archive "/path/mihomo-linux-amd64-compatible-v1.19.32.gz" \
  --destination "/path/linux-amd64"
```

依赖 POSIX `sh` 及 `sha256sum`、`wc`、`chmod`；全新安装还需要 `mktemp`、`head`、`gzip`、`timeout`、`ln -T`。联网安装需要 `curl`，离线/已有二进制路径不需要 curl。兼容目标为常见 GNU 工具或 Alpine BusyBox。在线下载仅允许 HTTPS、最多 5 次重定向、连接超时 15 秒、总下载 120 秒、零重试、压缩包最大 32 MiB；解压有 30 秒时限与 128 MiB 输出上限。下载文件和解压文件大小、哈希必须精确匹配固定值。

- 若目标已存在且 SHA 正确：只校验并显式 `chmod 0755`，可用于修复 Windows/ZIP 传输后丢失执行位。
- 若目标未知、是符号链接或哈希错误：拒绝覆盖，也不对未验证文件 chmod。
- 全新安装先写同目录 staging，校验后设 `0755`，最后用 no-clobber 硬链接发布；不会覆盖并发出现的目标。
- 不做删除或自动清理；stage 和官方压缩包保留供审计，失败时日志打印 stage 位置。
- Windows NTFS 的 `chmod` 不能作为 Linux `0755` 验收。Linux 启动前检查实际模式；只读容器挂载如没有执行位，应在独立可写工作副本上安装/修复，不能对只读挂载强行 chmod。
- 原生 `Available` 只检查支持平台、普通文件、非空、最大 128 MiB，以及 Linux 的执行位；`Validate` 和 `Start` 还会验证当前平台二进制 SHA。未知内核绝不执行。

安装器源文件以 LF 保存。可以使用 manifest 的 `mihomo.installers.linux.sha256` 与实际 `sha256sum scripts/meta-install-linux.sh` 比较；测试会防止源码与该 checksum 漂移。

## 测试入口与有效结果

新增 `internal/metacore/platforms_test.go` 覆盖三平台路径、未知架构、默认/显式路径、缺失/空/过大/非可执行文件、拒绝非固定哈希文件、平台清单与源码一致性、现有 PE/ELF 架构及 SHA、Linux 安装器拒绝坏 archive/保护已有文件/只在核验后修复 0755。

```sh
# 无真实内核进程启动；仅文件检查、fake core 与本地测试 fixture
# Linux shell 安装器测试也不联网
go test ./internal/metacore -count=1
go vet ./internal/metacore

# 显式选择才启动真实平台内核；只有隔离 loopback provider/route fixtures
META_REAL_TEST=1 go test ./internal/metacore \
  -run '^TestRealCoreIsolationAndNativeProviders$' -count=1 -v
```

没有显式 `META_REAL_TEST=1` 时真实 E2E 必须跳过；不存在的可选内核只使静态 bundle 文件检查跳过。开启真实 E2E 后缺失、错误架构、错误版本或不可执行内核均为失败，不静默跳过。

本次 Windows 主机实测（2026-10-20 Asia/Shanghai）：

```text
go test ./internal/metacore -count=1
ok github.com/linguo2625469/workbuddy2api-panel/internal/metacore

go vet ./internal/metacore
[exit 0; no diagnostics]

Git Bash: bash -n scripts/meta-install-linux.sh
[exit 0; syntax valid; NOT Linux runtime proof]

META_REAL_TEST=1 go test ./internal/metacore -run '^TestRealCoreIsolationAndNativeProviders$' -count=1 -v
=== RUN   TestRealCoreIsolationAndNativeProviders
native_test.go:87: real kernel: windows/amd64 v1.19.32 sha256=04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314 path=E:\workbuudy fandai\workbuddy-local\third_party\meta\bin\windows-amd64\mihomo.exe
--- PASS: TestRealCoreIsolationAndNativeProviders (1.44s)
PASS
ok github.com/linguo2625469/workbuddy2api-panel/internal/metacore 2.512s
```

真实 E2E 使用同一套原生 YAML / URI / Base64 provider、多账号认证监听与路由隔离、GLOBAL 防串路、运行中切换/长流、恶意顶层字段忽略、坏 provider 回滚、控制器鉴权、持久化恢复、租约及闲置唤醒断言；没有真实订阅或生产外网请求。

Linux amd64 Docker 静态测试二进制及真实 ELF fixture 运行由主执行者负责，本文件当前不将准备/交叉编译等同于 Linux 实际通过。arm64 ELF 已完成来源/格式/哈希检查；arm64 本机/仿真运行未在本工作包执行。没有启动独立 Docker suite，也没有更改 Docker 全局设置。

## 交付限制

`third_party/meta/bin/` 仍由既有 `.gitignore` 忽略；二进制实际存在于共享工作区，但普通源码 Git checkout 不自动携带它们。本次不修改 ignore、归档或现有发布包；新源码使用者需运行固定校验安装器。Linux 打包者须在发布的各架构包中显式携带对应 `mihomo` 且保留 `0755`，并保留 `MIHOMO-LICENSE` 与对应源码来源。未执行提交、删除、生产部署或发布。

## 主流程追加运行验收
2026-10-20：Linuxamd64全包/真实内核/HTTP通过，Linuxarm64在Docker/QEMU下真实内核/HTTP通过；不是原生ARM性能基准。异步provider就绪竞态已修复。以docs/LINUX-VALIDATION.md为集成结论，早期“主流程待验收”记录仅代表该工作包当时边界。
