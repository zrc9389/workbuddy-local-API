# PROJECT_STATE

阶段：v0.2本机回归版已打包交付；真实上游1M token与订阅验收未执行。

## 位置/约束
- 当前源码E:/workbuudy fandai/workbuddy-local；v0.1发布包保留。
- 原审阅源码和旧服务未修改，未提交/推送/部署，未使用真实个人账号/订阅。
- 用户批准的v0.2设计/计划在docs/superpowers，明确整号余额保护100、四维护任务手动统一触发。

## v0.2完成
- 空概览、全局去搜索筛选、账号卡片仅启禁/删除/出口、有界分页、陶土橙深浅玻璃、四状态清晰、9路由。
- manual_disabled独立于系统故障/余额/冷却；已知余额低于100整号退出选号；未知余额不误禁；余额恢复不清手动标记。
- maintenance唯一四步骤服务，逐账号结果、重复执行锁、无自动排程；旧scheduler/tasks为兼容保留不自动启动。
- Mihomo固定v1.19.32 Windows amd64、原生订阅、每账号监听/选择组、管理secret仅后端、测速、估算流量、请求租约/空闲退出/唤醒、删除回收入口、错误回滚。
- metacubexd实际趋势helper按需加载，不是完整dashboard；来源/校验/许可证见third_party/meta。
- 历史归档与缓存分离；TTL/LRU仅热缓存，压力可回收已归档缓存；sha256校验、4GiB/100000记录上限，满则明确拒绝；旧格式迁移。
- 严格历史默认开启，不静默删工具历史/换system/指纹清洗；超限明确报错保留档案。
- 原始请求正常走内存；压力/并发不足用64KiB缓冲sync后spool；有界队列、保守8倍工作预算、unknown不自动重放；整包转换仍在，不承诺无限体量。
- -demo隔离18账号/3节点/3模型、本地mock上游、动态日志/用量；显著DEMO标记；主题/阈值后端保存与回读。

## 有效验证
- 最终go test ./...、go vet ./...通过；27项实际前端模块/DOM测试通过。
- 真实本机内核E2E隔离/原生格式/长流/回滚/权限/重启/闲置唤醒通过，测试内核无残留。
- 普通/no_logs Windows构建与依赖分离通过。
- 实际HTTP demo四任务每步15成功3手动跳过；节点测速/绑定/回读、主题阈值、三模型/18积分账号/动态日志用量通过。
- 合成1/4/8MiB×1/2/4/8发起并发12组完整性/压力测试通过；进程工作集采样峰值410914816字节，Go软目标不等于硬限额。
- 浏览器9路由、空概览、无搜索、节点ms、双主题、动态日志、390px宽度无溢出；预览docs/v02-preview。

## 未验证/限制
- 真实1M token需模型/账号权限/tokenizer和消耗预算；实际订阅/远程节点/长期千号负载未验收。
- -race缺C工具链未执行；Linux Meta/Docker未提供此次运行验收。
- Responses仍聚合后转SSE；每response档案仍完整前缀，有磁盘写放大。清空切代，旧档案不自动批量删除。
- 模型绝不失忆不能承诺；只保证网关保存/发送不静默删减，并明确拒绝不支持的条件。
- 账号流量是采样估算；强杀父进程的子进程清理不保证，正常退出先等请求结束。

## 下一步
发布物release/workbuddy-local-v0.2.0-windows-amd64.zip、workbuddy-local-v0.2.0-source.zip。CRC/敏感文件排除/干净源码构建与正常/演示/no_logs首次启动已验收。下一步仅在用户提供真实测试条件后另行1M和真实订阅验收。

## 后台
本任务两位子代理均已关闭；17866/17867/17868临时验收服务交付前停止；未修改或关闭其他原服务。

## 交付目标变更：Linux服务器优先
用户最新明确部署目标Linux。当前Windows包作为历史验收副产物保留，不作为最终主交付。正在实现Linux amd64/arm64 Meta与打包，利用可用本机Docker Linux amd64引擎做运行验收。仍仅回环，SSH隧道访问；未获公网免密或生产部署授权。


## Linux主交付完成（2026-10-20）
主目标Linux服务器，原Windows包仅保留历史。新支持Linuxamd64/arm64网关/no_logs和对应固定校验Mihomo；KernelPath自动选架构。非root/systemd/SSH隧道和可选Docker文件已配套。
Linuxamd64隔离非root断网容器内24个Go测试包+前端27项+真实内核+HTTP演示通过；arm64在QEMU下metacore全包真实内核+HTTP/SIGTERM通过（非原生ARM性能）。外网目录测试已改成本机夹具；启动等待provider就绪最多5秒，避免过早宣布可用。
部署26项离线测试、两架构ELF/digest、Compose解析通过。完整systemd/生产Dockerfile镜像及你的实际服务器未部署验收；真实1M/订阅/长期负载仍需条件和预算。详情docs/LINUX-VALIDATION.md。
两个tar干净解包非root权限/启动/本机绑定/主题保存及no_logs均已通过。发布物release/workbuddy-local-v0.2.0-linux-amd64.tar.gz、linux-arm64.tar.gz及source-linux-ready.tar.gz；最后更新文档与校验，做源码包独立构建。本任务子代理均已关闭、临时--rm测试容器均已退出；原有workbuddy2api/redis容器未改动。
