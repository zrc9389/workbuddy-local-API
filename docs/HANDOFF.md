# WorkBuddy Local · UI 重构交接文档

> 生成时间：2026-10-22 03:20 (Asia/Shanghai)
> 适用对象：接手本任务的规划者 / 子智能体
> 配套文档：`docs/superpowers/plans/2026-10-21-complete-ui-redesign-plan.md`（2415 行，§0-§35，权威规格）

---

## 0. 三条铁律

1. **主对话只做分发与规划，绝不写代码。** 所有代码改动交给子智能体。
2. **子智能体统一 `DeepSeek-V4.1 flash` + 思考程度 `max`。**
3. **同时运行最多 3 个子智能体。** 用户被 20+ 个并发直接卡退过。

---

## 1. 项目坐标

```text
主仓库   F:\computer\chat gpt\2026-10-20\new-chat\work\agent-source-extract-20261020013527\workbuddy-local
main     7af148b
基线标签 baseline-ui-redesign -> 29bd811
规划文档 docs/superpowers/plans/2026-10-21-complete-ui-redesign-plan.md
```

技术栈：Go 后端 + 原生 ES module 前端。

### 1.1 最容易踩的坑（必读）

前端资源通过 `go:embed` **编译进二进制**（`internal/panel/index.go`）。

```go
//go:embed index.html
//go:embed app.js
//go:embed assets
```

**改前端后不 `go build` 不重启服务，浏览器里永远是旧代码。** 用户已因此三次误以为"代码回退了"。

---

## 2. 系统是什么

本机运行的单用户 API 网关控制台。上游是 AI 账号池，下游给本机客户端提供 OpenAI 兼容接口。

```text
账号池 → 选号 → 绑定代理节点 → 转发请求 → 记积分与错误
```

### 2.1 页面结构

| 类型 | 项 |
|---|---|
| 登录层 | 管理密码（单密码，24h cookie 会话） |
| 启动层 | 全屏启动动画（≥8000ms，可 Esc 跳过） |
| 导航 | 9 个一级入口，无二级菜单 |
| 视图 | 概览 / 账号池 / 账号任务 / 账号出口 / 积分用量 / 积分构成 / 模型查看 / 错误记录 / 系统设置 |
| 弹窗 | 添加账号 / 节点选择 / 订阅详情 / 错误详情 / 任务失败详情 |

> 完整功能清单（不含样式）见附录 A。

---

## 3. 已完成并合入 main

| commit | 内容 | 实测证据 |
|---|---|---|
| `82cc951` | 批次 17：启动动画最小时长 + 登录页时序 + 事件去重 | DOM 停留 8366ms（此前 56ms 被销毁） |
| `7af148b` | 批次 18：液态玻璃根基 + 登录页两栏 | `backdrop-filter: blur(28px) saturate(1.5)`；登录卡 880px，左 504.8 / 右 373.2 |

### 3.1 批次 17 修了什么

根因在 `internal/panel/assets/router.js`：`withinStartupBudget` 用 `Promise.race([work, deadline])`，数据 10ms 内全部 settle 时被判为"已就绪"，走快速路径，56ms 就 `destroy()` 掉动画。

修复：删掉快速路径，统一走 `sleepUntil(deadline=8000)` → 等数据（上限 12000）→ `syncing` → 360ms 退场。新增 `boot-guard.js` 兜底；`body.is-booting` 期间隐藏登录卡。

### 3.2 批次 18 的两个缺陷（合并时已修）

1. **卡片组漏 `backdrop-filter`**：`.account-card/.job-card/.model-card/.package-card` 有 `background: var(--glass-bg)` 但没有 `backdrop-filter`，玻璃是假的。已补。
2. **合并把 `body.is-booting` 弄丢**：批次 17 的 `body.is-booting .veil { display:none }` 规则在冲突解决时被删。已补回。

---

## 4. 正在进行（3 个）

| 批次 | worktree | 分支 | 状态 |
|---|---|---|---|
| 24 出口页 | `F:\computer\chat gpt\wt\b24-egress` | `ui/b24-egress` | **已提交 `da9c091`**，工作区干净，待合并 |
| 25 启动动画 | `F:\computer\chat gpt\wt\b25-startup` | `ui/b25-startup` | 未提交，7 文件改动 + 13 个未跟踪调试脚本（见 4.3） |
| 26 账号池 | `F:\computer\chat gpt\wt\b26-accounts` | `ui/b26-accounts` | **已提交 `deac70e`**，工作区干净，待合并 |

> 状态以 `git log` 为准，不要沿用旧描述。24 号已从「未提交」推进到已提交。

### 4.1 批次 26 已提交内容（`deac70e`）

```text
internal/panel/assets/account-rows.js              +26  -9
internal/panel/assets/account-table.js             +7   -2
internal/panel/assets/accounts.js                  +29  -2
internal/panel/assets/styles.css (05 段)           +13  -7
internal/panel/frontend_accounts_v2_test.mjs       +43  (新建)
internal/panel/frontend_pool_test.mjs              +5   -5
```

越界检查通过：`styles.css` 只碰 05 段（第 407-448 行）。可安全合并。

### 4.2 批次 24 / 25 的 write set

| 批次 | 独占文件 |
|---|---|
| 24 | `egress.js`、`index.html` 的 `view:egress` 段、`styles.css` 06 段（449-492）、`frontend_egress_v2_test.mjs`（新建）、`frontend_egress_picker_test.mjs`（新建） |
| 25 | `startup-animation.js`、`animation-settings.js`、`styles.css` 14 段（718-末尾）、`index.html` 的 `.motion-settings` article、`frontend_startup_test.mjs`、`frontend_animation_settings_test.mjs` |

### 4.3 批次 25 的临时文件

`F:\computer\chat gpt\wt\b25-startup` 里有 13 个未跟踪文件，全部是调试产物，合入前必须删掉，否则会被误提交：

1. 根目录补丁文本：apply.patch.txt、patch.txt、b25-rt.patch.txt、b25-rt2.patch.txt、b25-vt.patch.txt、b25-vt2.patch.txt、b25-vt3.patch.txt
2. 根目录脚本：b25-cdp.mjs、b25-dbg.mjs、b25-probe.mjs、b25-rt.mjs、b25-vt.mjs
3. 资源目录：internal/panel/assets/styles.css.head

清理顺序：先 git clean -n 看清单，确认只有上述文件，再 git clean -fd。

合入前还要确认 styles.css 只动 14 段；这批改了 84 行，跨段必冲突。

## 5. 已暂停（改动已 WIP commit，不会丢）

| 批次 | agent id | 分支 | WIP commit | 内容 |
|---|---|---|---|---|
| 19 概览 | `01a15fac-616f-7861-846f-132969112204` | `ui/b19-overview` | `90edeef` | 圆环左置 + 图例进度条 + 昼夜扩散 |
| 20 模型 | `01a15fac-da03-7992-a7e0-afa5988b8564` | `ui/b20-models` | `7e6ea64` | 卡片精简 + 禁用交互 + 拉取 |
| 21 错误记录 | `01a15fad-836e-72a3-87af-1e2cfb4a616e` | `ui/b21-logs` | `7a1888b` | 只留错误 + 点开弹窗 |

**恢复方式**：`resume_agent` 后发一条「继续，从 XXX 开始写」。**不要重发任务书**，旧上下文还在。

---

## 6. 待开工

| 批次 | 内容 | 前置条件 |
|---|---|---|
| 22 | 全站 `.hint` 清扫 + 1600/1280/390 三档响应式 + 性能预算 | 18/19/20/21/24/26 全部合入 |
| 23 | VM 部署与回滚演练 | 22 完成 |

---

## 7. 合并纪律（血的教训）

### 7.1 禁止 `git merge` 整分支

批次 16/17/18 都从旧基线分出，直接 merge 会把前一批的修复整体回滚。

`7af148b` 之前实测：`git diff --stat main 782eb20` 会删掉 **973 行**，包括：
- 整个规划文档（428 行）
- 批次 16 的 `egress.js` 改动（88 行）
- 批次 17 的 `router.js` 改动（261 行）
- `boot-guard.js`（8 行）
- 两个测试文件（158 行）

**正确流程**：

```powershell
git fetch <worktree> <branch>
git log --oneline main..FETCH_HEAD        # 有几个 commit
git diff --stat main FETCH_HEAD           # 是否越界
# 越界时：只取该批次自己那一段
git diff <commit>^ <commit> -- <只属于它的文件> > patch.diff
git apply --3way patch.diff
```

### 7.2 `styles.css` 按段拼接

当前 14 段行号（`main` = `7af148b` 现状）：

```text
00 tokens              1      05 accounts          407     10 config      551
01 base              113      06 egress            449     11 responsive  565
02 ambient           269      07 packages          493     12 motion      617
03 nav               299      08 models            502     13 fonts       632
04 overview          340      09 logs              538     14 startup     718
```

**段号是唯一权威。** 批次书里写的段号就是它的 write set，其它段一律不许碰。

### 7.3 CRLF 陷阱

PowerShell 的 `Set-Content` / `[System.IO.File]::WriteAllText` 会把 LF 转 CRLF，导致整文件 900 行"全改"。

- 改文件只用 `apply_patch`
- 必须用 PowerShell 写时，写前 `-replace "\r\n","\n"`，用 `UTF8Encoding($false)`（无 BOM）
- 提交前必查 `git diff --numstat`：正常是几十行，不是 900

### 7.4 每批次合并后必跑

```powershell
go build ./...
node --test internal/panel/*_test.mjs   # 当前基线 126/126
```

---
## 8. 用户已定口径（不得再改）

### 8.1 视觉

1. 液态玻璃四层：填充 → 柔光 → 1px 顶缘镜面 → 外阴影。**卡片组也必须有 `backdrop-filter`**。
2. 背景流动用 `transform` / `opacity` 的 CSS 动画，**客户端渲染，服务端零参与**。
3. 字体：无衬线中文（Noto Sans SC）+ Claude 风格英文衬线（Source Serif 4），全部同源 woff2，**不引远程**。
4. 导航选中态**只允许**「文字变色 + 左侧 2px 竖线」。禁止背景块、禁止 outline、禁止整条高亮。
5. **禁止黄色整块提示条。** 用户原话：「又是这种该死的黄色高亮提示 我非常讨厌」。
6. 全站禁止解释性小字。用户原话：「我很讨厌这种小字设计，全页面都是」「不要一棒子打死 主要是很讨厌这种解释设计」。
7. 不要二级菜单。
8. 不要 `confirm()` 原生弹窗（删除账号除外）。
9. 要有留白感和呼吸感，不要做得跟网上中转站一样。

### 8.2 功能

10. 概览：圆环在左、图例在右，图例每行要有**可见的**进度条。
11. 昼夜切换：从月亮缺口位置向外**圆形扩散**渐变，不是简单 opacity 翻转。参考 `https://uiverse.io/Pradeepsaranbishnoi/strong-treefrog-90`。
12. 出口页：节点是**小方框**，名称后直接跟延迟；**点击即绑定**，不要"绑定节点"按钮。
13. 订阅支持 3-4 条；URL 明文只在弹窗里看。
14. 节点延迟用缓存（48h），**手动刷新**才重新测速。
15. 到期分布最长只显示 30 天（上游存在 2928 天的包，已用 `MAX_EXPIRY_DAYS = 30` 屏蔽）。
16. 错误记录只留错误，不要运行记录，不要汇总统计。
17. 账号卡：删掉 `请求` / `Token` / `延迟 · 速率` 三项，高度压到 90-110px。
18. `出口` 按钮只有两个字，排在 `禁用` 左边。
19. 模型卡：只保留 模型信息 / 上下文 / 推理档位 / 输出 token；档位顺序 `off → low → medium → high → xhigh → max → ultra`。
20. 模型禁用：点开关立即生效，无确认，失败回滚，禁用后沉到列表末尾。
21. 启动动画：总时长 **≥ 8000ms**，数据秒回也不提前销毁；全部英文；Esc 可跳过。

### 8.3 硬约束

22. **内核（Meta / 反代）不允许改动。** 用户原话：「这个项目的内核，也就是最开始是由别人创作的，包括 Meta 内核，和反代内核，我不太敢去动 我也不建议你去动它」。
23. 前端改动必须 `go build` + 重启才生效。

---

## 9. 环境事实

### 9.1 端口

| 端口 | 用途 |
|---|---|
| `17863` | 主 demo，密码 `123456`，16 账号 / 3 节点 / 700 条 429 |
| `17864` | 批次 18 遗留实例 |
| `17865` | 批次 26 自建实例 |
| `7863` | portproxy 到 VM `192.168.189.128:7863`，VM 端未监听 |

### 9.2 浏览器验证

不要用内嵌浏览器 cua_repl，它的 DOM 被 mock：el.click 不可用、document.createElement 不可用。

用 headless Chrome 加 CDP，由 Node 原生 WebSocket 驱动。

步骤：
1. 前台启动 chrome，参数含 --headless=new --disable-gpu --remote-debugging-port=9502
2. 取 http 127.0.0.1:9502 的 json list 拿 webSocketDebuggerUrl
3. Page.addScriptToEvaluateOnNewDocument 注入打点，注完必须 Page.reload
4. Runtime.evaluate 配 returnByValue 与 awaitPromise
5. Emulation.setDeviceMetricsOverride 设视口
6. Page.captureScreenshot 截图

Chrome 必须前台启动，Start-Process 会被策略拦截。

### 9.3 沙箱限制

go test 里依赖本地 socket 或临时文件重命名的用例会失败，报 not a socket 或 Access is denied。

这是环境限制，不要改测试、不要加 skip。在回报里标注失败用例名与报错原文即可。

go build 和 node --test internal/panel/*_test.mjs 一定能跑。

---

## 10. 子智能体失败模式（已踩）

| 现象 | 原因 | 对策 |
|---|---|---|
| 回一句"我没卡住、下一步是…"就停 | 把状态检查当成任务终点 | 派任务必须写「现在就开始写第一行代码，不要再回报状态」 |
| 退出码 1 且无输出 | here-string 加 Set-Content 中转 patch | 直接调 apply_patch，参数写 Begin Patch 原文 |
| 整文件 900 行全改 | PowerShell CRLF 化 | 见第 7.3 节 |
| 报告说做了、实际没落盘 | 只跑 git status 就回报 | 主助手必须自己跑 git diff --numstat 核实 |
| 文件边界写错 | 任务书里的路径是猜的 | 派任务前先 Select-String 确认符号真实位置 |

### 10.1 真实的文件结构（别猜）

| 职责 | 真实文件 |
|---|---|
| 账号卡渲染 | account-rows.js |
| 账号表格与分页外层 | account-table.js |
| 出口与禁用按钮事件 | account-actions.js |
| 账号页入口与 overview 反射 | accounts.js |
| 节点弹窗渲染 | egress.js 里的 renderNodes / openNodeModal / bindAccountNode |
| 节点弹窗 CSS | styles.css 第 06 段 |

---

## 11. 下一步动作（明确顺序）

顺序执行，不要并行合并（styles.css 会撞车）。

1. 合并 ui/b26-accounts（deac70e，只动 05 段，无越界）。门禁：go build ./... 加 node --test。腾出 1 个槽位。
2. 合并 ui/b24-egress（da9c091，工作区干净）。门禁同上。重点回归：多订阅导入、节点小卡点击即绑、48h 缓存、手动刷新。
3. 催批次 25 收尾：先清 4.3 的 13 个临时文件，再确认 styles.css 只动 14 段，提交后合并。门禁加 frontend_startup_test.mjs 全绿。
4. 依次恢复 19 / 20 / 21（resume_agent，不要新建）。每次恢复前先 rebase 到最新 main，冲突按第 7.2 节按段拼接。
5. 全部合入后开批次 22：.hint 清扫、1600/1280/390 三档响应式、性能预算。
6. 最后批次 23：VM 部署与回滚演练（192.168.189.128:7863 若未监听，先查 systemd unit）。

任何一步门禁不过就停在那里修，不要带着红灯往下推。

---

## 12. 验收口径

### 12.1 每批次门禁

```text
go build ./...                        -> exit 0
node --test internal/panel/*_test.mjs -> 126/126
```

### 12.2 最终验收（headless Chrome 逐项）

| 项 | 判据 |
|---|---|
| 启动动画 | DOM 停留 >= 8000ms |
| 玻璃 | getComputedStyle(card).backdropFilter 含 blur |
| 导航 | .nav a.on 无 background、outline 为 none、有 2px 左侧竖线 |
| 提示条 | 演示横幅背景色为全透明 |
| 响应式 | 1600 / 1280 / 390 三档 scrollWidth 等于 clientWidth |
| 出口缓存 | 加载后 3 秒内无订阅 URL 请求 |
| 小字 | 全站 hint 类不承载说明文字 |

---

## 13. 智能体清单

下表是本文档写作时刻的快照，仅供参考；实际槽位以环境里的子智能体列表为准，不要照本表判断。

| agent id | 代号 | 承担批次 | 最后已知状态 |
|---|---|---|---|
| 01a1553b-1671-7ca2-b19e-cee1858c958c | Helmholtz | 25 启动动画 | 运行中，改动未提交 |
| 01a15f56-0e26-7513-8194-332dee56173a | Beauvoir | 24 出口页 | 已提交 da9c091 |
| 01a15fd3-978e-7651-91da-025f715e5655 | Erdos | 26 账号池 | 已提交 deac70e |
| 01a15f8c-8230-7c21-b50e-543e0daf6860 | Pascal | 18 液态玻璃 | 已完成并合入 |
| 01a15fac-616f-7861-846f-132969112204 | Ohm | 19 概览 | 已关闭，WIP 90edeef |
| 01a15fac-da03-7992-a7e0-afa5988b8564 | Rawls | 20 模型 | 已关闭，WIP 7e6ea64 |
| 01a15fad-836e-72a3-87af-1e2cfb4a616e | Kepler | 21 错误记录 | 已关闭，WIP 7a1888b |

纪律：

1. **不要关智能体。** 模型已换好，关掉重开会重新计费。
2. 恢复已关闭的智能体用 resume_agent，不要新建。
3. 并发上限 3。用户被 20+ 并发直接卡退过，这是硬约束。

---

## 附录 A：前端功能完整清单（不含样式）

### A.1 全局

| 元素 | 功能 |
|---|---|
| 启动动画层 | 登录前全屏遮罩，至少 8 秒，展示进度后淡出 |
| 登录页 | 单个管理密码输入加提交；24 小时 cookie 会话 |
| 侧边导航 | 9 个一级入口，无二级菜单 |
| 顶栏 | 页面标题、退出、刷新、添加账号（后两者按页面显隐） |
| 全局通知 | toast，成功与失败两种 |
| 提示横幅 | 演示模式横幅、初始密码未修改警告 |

顶栏显隐规则：添加账号只在账号池；刷新只在账号池和概览。

### A.2 概览

- 圆环：账号总数居中，环身按 总数/可用/冷却/禁用 分 4 段
- 图例：4 行，每行是 名称 加 进度条 加 数值
- 数据源 GET /panel/api/overview，全量聚合，不按分页
- 右侧：昼夜切换按钮、本机 API 信息（Base URL 加 接口类型）
- 无搜索、无筛选、无任务列表

### A.3 账号池

统计条：账号总数 / 可用 / 冷却 / 凭据或手动禁用

账号卡包含：昵称、短 ID（井号加末 6 位）、状态标签（健康 / 暂不可用 / 手动禁用）、状态原因（悬停）、可用积分（如 850 / 2000）、当前出口节点名、出口按钮、禁用或启用按钮、删除按钮。

分页：上一页 / 页码 / 下一页

刷新语义：POST balance_all，重拉所有账号余额，不刷节点延迟。

### A.4 添加账号弹窗

| Tab | 流程 |
|---|---|
| 浏览器授权 | 选区域（国内 / 国际）→ login/start → 显示 URL 加 复制 加 打开 → 轮询 login/poll |
| 导入 Cockpit | 选 json 文件 → POST import/cockpit |

### A.5 账号任务

4 个固定任务：令牌保活 token / 每日签到 checkin / 活跃上报 activity / 旅行巡检 travel

每张卡：序号加标题加状态标签（等待 / 执行中 / 已完成 / 失败 / 已取消 / 已跳过）、上次执行时间与结果、进度条、完成 N 除以总数、失败 N、跳过 N（可选）、查看 N 项失败按钮。

页头：上次执行摘要 加 全部执行按钮（运行中禁用，文字不变）。

接口：GET maintenance/status、POST maintenance/run

### A.6 账号出口

| 区块 | 内容 |
|---|---|
| 订阅概览条 | 汇总文字 加 导入订阅 / 订阅详情 / 刷新节点 |
| 导入表单 | 订阅地址（必填）、名称（可选，最多 64 字符）、导入或取消、状态提示 |
| 筛选条 | 订阅下拉（全部 / 各订阅带节点数）、节点计数 |
| 账号绑定条 | 从账号池的出口按钮进入时显示账号下拉 |
| 节点网格 | 节点名、延迟徽章、订阅来源、已绑定勾选；每页 60 |
| 节点测试 | 状态行 加 触发按钮；后端受限并发异步测速，前端轮询 meta/tests |
| 详情区 | 左栏订阅来源；右栏当前节点（名称 / 订阅 / 协议 / 延迟 / 测速时间） |
| 流量速率（折叠） | 下载总量 / 上传总量 / 下载速率 / 上传速率 / 活动连接 / 采样时间 |
| 账号绑定管理（折叠） | 每账号一张路由卡，可改绑 |
| 订阅详情弹窗 | 名称加完整 URL（默认隐藏）、节点数、启用状态、上次刷新、查看地址或刷新或删除 |
| 节点选择弹窗 | 订阅筛选 加 节点卡列表，点击即绑定、测试延迟、分页 |

缓存语义：48 小时；登录时自动刷新一次（4 秒超时）；之后只读缓存；手动刷新节点才重拉并测速。

### A.7 积分用量

4 个统计卡：请求数 / Token 合计 / 积分观测 / 缓存命中率

Token 时间线：柱状图每列拆 prompt（下）加 completion（上）；tooltip；首屏 12 点，展开全部按钮切换；展开后分页。

5 个维度明细（各自独立分页，每页 15 行）：

| key | 标题 |
|---|---|
| by_account | 按账号 |
| by_model | 按模型 |
| by_realm | 按区域 |
| credit_by_account | 账号积分观测 |
| credit_by_model | 模型积分观测 |

明细行字段：
- 普通维度：请求数 / 失败数 / Prompt 与 Completion / 合计 Token / 平均延迟与速率 / 缓存命中率
- 积分维度：请求数 / 积分 / 倍率 / 积分每 1M Token / 积分样本数

缓存：60 秒内重复进入不重复请求。

### A.8 积分构成

3 个统计卡：已读取账号 M 除以 N、已知剩余积分、未取得余额数

未取得余额指的是请求失败或字段缺失，与余额 0 严格区分，不按 0 计算。

到期分布：按剩余天数聚合的横条图，每天一行（N 天内 加 横条 加 积分总额）；上限 30 天；分页 20 行。

账号积分包列表（分页 12 账号）：昵称 加 uid 加 积分徽章（1537 积分 或 未读取）加 每个积分包（名称 / 剩余与总量与已用 / 到期 / 发放）；每账号积分包分页 5 条。

### A.9 模型查看

页头：缓存状态标签（缓存 12 分钟前 / 缓存已过期 / 刚刚更新 / 缓存状态未知）加 刷新按钮 加 冷却倒计时。

刷新：POST models/refresh，成功后 300 秒冷却。

模型卡（分页 20）：名称、模型 ID（等宽）、启用开关（role 为 switch，右上角，唯一禁用入口）、推理档位（off / low / medium / high / xhigh / max / ultra，未声明追加末尾）、上下文长度（可被策略覆盖）、生效倍率（优先 promo_credits 加 promo_label）、输出 Token（上游声称 / 实测至少 / 实测上限 / 未测出 加 时间戳 加 是否超 30 天旧）、能力标签（视觉 / 工具 / 推理）。

禁用行为：点开关立即生效无确认；失败回滚；禁用后 300 毫秒沉到列表末尾；从对外列表移除。

### A.10 错误记录

只记录错误，不含成功请求，不含运行日志。

列表行：时间（MM-DD HH:mm）/ HTTP 状态 / 模型名 / 错误类别 / 展开箭头

错误分类：

| 状态码 | 类别 |
|---|---|
| 429 或 402 | 额度或限流 |
| 408 或 504 或 outcome 为 interrupted | 超时或冲突 |
| 409 | 超时或冲突 |
| 401 或 403 | 鉴权或权限 |
| 大于等于 500 或 outcome 为 stream_error | 上游或服务错误 |
| 其他 | 请求错误 |

详情弹窗（点击行后单独 GET request_logs?id=）：时间 / HTTP 状态 / 结果 / 请求路径 / 账号 / 延迟与首字节 / 尝试次数 / Token 拆分 / 积分 / 缓存命中率 / 来源 IP / User Agent / 请求 ID。

保留期：24 小时，磁盘归档。分页每页 20。

### A.11 系统设置

当前设置页只剩两块内容（其余全部移出）：

| 区块 | 现状 |
|---|---|
| 管理密码 | 当前密码 / 新密码 / 确认新密码，minlength 8；保存成功后所有管理会话强制退出 |
| 启动动画 | 下拉四选一（names / orbital / scan / minimal）+ 预览按钮；改动即写 preferences |

已从设置页移出的内容（不要加回来）：

1. 主题切换 —— 移到概览右侧的昼夜组件（ovTheme）。
2. 积分保护阈值 —— 移出 UI，后端默认 100，由 preferences 的 credit_guard_low 承载。
3. 本机 API 端点（Base URL / Chat / Responses）—— 归概览的「本机 API」卡片。
4. 订阅管理与出口绑定 —— 归账号出口页。

### A.12 启动动画

实现文件：internal/panel/assets/startup-animation.js（导出 startStartupAnimation 与常量）+ router.js 的 driveStartup。

时间常量（现行值）：

| 常量 | 值 | 含义 |
|---|---|---|
| TARGET_MS | 8000 | 动画最短停留，数据秒回也不提前结束 |
| HARD_LIMIT_MS | 12000 | 总硬上限，到点强制进入 |
| PREVIEW_MS | 3200 | 设置页预览时长 |
| PREVIEW_HARD_LIMIT_MS | 4200 | 预览硬上限 |
| WORD_INTERVAL_MS | 1000 | 名称轮播切词间隔 |
| WORD_MOVE_MS | 360 | 单个名称进出位移时长 |
| EXIT_MS | 360 | 退场淡出 |
| FRAME_MS | 60 | 计数器帧间隔 |

**三段结构**（PHASE_STEPS）：

1. 0% —— STAGE 01 // ACCOUNT SYNC
2. 42% —— STAGE 02 // MODELS
3. 78% —— STAGE 03 // FINALIZING

syncing 相位会强制把文案改成 STAGE 03 // FINALIZING，并给 names 风格加 is-gate 类（双门合拢）。

**文字四件套**（全部英文，硬性要求）：

| 位置 | 内容 |
|---|---|
| 顶部左 | INITIALIZING ENVIRONMENT + 呼吸圆点 |
| 顶部右 | 相位标签 STAGE 0x // ... |
| 中部 | W· 标记 + 名称轮播（AI_NAMES） |
| 中部下 | 标语 WORKSPACE ONLINE |

**名称轮播名单**（AI_NAMES，按此顺序）：GPT → Claude → Gemini → Grok → DeepSeek → Qwen → Kimi → Llama。

**四种风格**：

| 值 | 名称 | 视觉要点 |
|---|---|---|
| names | 名称轮播 | 逐字切换 AI 名，底部走 1px 非线性进度条 |
| orbital | 轨道聚合 | 同心环收束 + 粒子聚合，词条挂到弧槽 |
| scan | 扫描唤醒 | 水平光带扫过并点亮标语 |
| minimal | 极简淡入 | 只留 W· 标记，隐藏进度条、计数器、词轮播 |

**跳过**：键盘 Escape 或点击遮罩任意位置，立即进入工作台；遮罩退场仍走 360ms，后台任务保留自己的硬上限不被截断。

**登录门控链路（现状，批次 25 的改动目标）**：

1. 首屏 body 带 is-booting，登录卡片由动画自身决定何时可显。
2. 同一时刻并行发起 5 件事（Promise.allSettled）：
   - loadCapabilities()
   - bootstrapAccounts(hardDeadline)
   - getPreferences()
   - 取 animation_style
   - refreshSubscriptionsOnce({timeoutMs:4000}) —— 只对已启用订阅串行 POST，绝不碰 meta/tests
3. 数据在 8 秒内齐了就提前把进度推到 100%，但仍等满 TARGET_MS 才进 syncing。
4. 12 秒到点无论数据是否齐，强制进 syncing 并淡出，绝不弹「某项失败」。
5. 动画卸载时 AbortController 统一中止残余请求，防止迟到的 POST 越界。

**prefers-reduced-motion**：直接不挂遮罩（root 为空），不进 8 秒门控，立即 go(hash)。这是无障碍通道，不得删。

---

### A.13 横切能力

| 能力 | 现状 | 约束 |
|---|---|---|
| 会话 | Cookie wb_local_session，HttpOnly + SameSite=Strict + Secure(仅 TLS)，MaxAge 24h | 24 小时内免登录，换设备需重登 |
| CSRF | 登录响应下发 csrf_token 仅存内存；写请求带 X-CSRF-Token 头，不匹配即 403 | 不得放宽为 GET 写，不得落 localStorage |
| 轮询 | 可见页 5s 一次 refreshVisible；节点测试 1.5s；登录轮询 3s；模型冷却 1s | 页面隐藏即停，不得用裸 setInterval |
| 页面切换 | 切页只读内存快照，不触发网络请求 | 刷新按钮才回源 |
| 缓存 TTL | 订阅快照 48h；恰 48h 仍算新鲜，>48h 标「缓存已过期」 | 不做后台自动轮询 |
| 分页 | 账号、积分包、请求日志均分页；通用 paginate 默认 25，积分图表 20，日志 20 | 不得一次性渲染全量 |
| 折叠 | 账号卡片、模型卡片可折叠详情 | 折叠不丢状态 |
| 确认弹窗 | 生产页面无二次确认弹窗 | 禁用/删除直接执行，靠可恢复设计兜底 |

---

### A.14 明确没有的功能

不要因为「看起来应该有」而加进来，以下均为用户明确否决或从未要求：

1. 站内搜索 / 过滤框（全局无搜索）。
2. 任何二级菜单（导航必须单层平铺）。
3. 多用户 / 角色权限（单管理密码）。
4. 独立的 API Key 管理页（本机无需 key）。
5. SSE / WebSocket 实时推送（一律轮询 + 缓存）。
6. 图表库（无 ECharts / Chart.js / D3，全部手写 SVG 或 CSS）。
7. 移动端独立页面（只做响应式收敛，不做 m 站）。
8. 订阅节点自动测速常驻（登录不测延迟，只有手动刷新）。
9. 运行日志页（只保留错误记录）。
10. 设置页的主题、阈值、API 端点三个区块。

---

## 附录 B：API 端点清单

全部挂在 /panel/api 下，均需会话 Cookie 与 X-CSRF-Token 头（登录三端点除外）。以下 58 条直接取自 panel.go 的路由注册（另 4 条为静态资源），不要凭记忆增删。

### B.1 会话与登录

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /panel/api/login/start | 发起上游设备码登录 |
| GET | /panel/api/login/poll | 轮询登录结果 |
| GET | /panel/api/login/regions | 可选 realm 列表 |
| POST | /panel/api/session/bootstrap | 触发一次账号同步 |
| GET | /panel/api/session/bootstrap/status | 同步进度 |

### B.2 账号

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /panel/api/accounts/export | 导出账号 |
| POST | /panel/api/accounts/import | 导入账号 |
| POST | /panel/api/accounts/{uid}/balance | 单账号刷新余额 |
| POST | /panel/api/accounts/{uid}/checkin | 签到 |
| POST | /panel/api/accounts/{uid}/disable | 标记禁用 |
| POST | /panel/api/accounts/{uid}/revive | 恢复 |
| POST | /panel/api/accounts/{uid}/pause | 暂停调度 |
| POST | /panel/api/accounts/{uid}/resume | 恢复调度 |
| POST | /panel/api/accounts/{uid}/remove | 删除 |
| POST | /panel/api/accounts/{uid}/toggle_disabled | 启停开关 |
| POST | /panel/api/accounts/{uid}/proxy | 设置内核代理 |
| POST | /panel/api/accounts/{uid}/egress | 绑定出口节点 |

### B.3 账号任务

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /panel/api/accounts/{uid}/tasks | 单账号任务列表 |
| POST | /panel/api/accounts/{uid}/tasks/claim | 领取 |
| POST | /panel/api/accounts/{uid}/tasks/accept | 接受 |
| POST | /panel/api/accounts/{uid}/tasks/accept_all | 全部接受 |
| POST | /panel/api/accounts/{uid}/tasks/auto | 自动任务 |
| POST | /panel/api/accounts/{uid}/tasks/auto_all | 全部自动 |
| POST | /panel/api/tasks/scan_all | 全量扫描 |
| POST | /panel/api/tasks/run_queue | 跑队列 |
| GET | /panel/api/tasks/queue | 队列状态 |
| GET | /panel/api/school/vouchers | 校园券 |

### B.4 批量任务与维护

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /panel/api/checkin_all | 全量签到 |
| POST | /panel/api/travel_all | 全量出行 |
| POST | /panel/api/activity_all | 全量活动 |
| POST | /panel/api/keepalive_all | 全量保活 |
| POST | /panel/api/balance_all | 全量刷余额 |
| GET | /panel/api/maintenance/status | 维护任务状态 |
| POST | /panel/api/maintenance/run | 立即执行维护 |
| POST | /panel/api/import/cockpit | 控制台导入 |

### B.5 出口、订阅与内核

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /panel/api/egress | 出口矩阵 |
| GET | /panel/api/meta/status | 内核状态 |
| GET | /panel/api/meta/nodes | 节点列表 |
| GET | /panel/api/meta/stats | 内核流量统计 |
| GET | /panel/api/meta/tests | 上次测速结果 |
| POST | /panel/api/meta/tests | 启动测速，body 带 cancel 为取消 |
| GET | /panel/api/meta/subscriptions | 订阅列表；带 id 且 reveal=1 才回明文 URL |
| POST | /panel/api/meta/subscriptions | action 为空=导入，另有 toggle / rename / refresh / delete |
| POST | /panel/api/meta/accounts/{uid}/bind | 绑定节点 |

### B.6 用量、积分与模型

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /panel/api/overview | 概览聚合 |
| GET | /panel/api/usage | 用量曲线 |
| POST | /panel/api/usage/save | 落盘用量 |
| GET | /panel/api/packages | 积分包与到期分布 |
| GET | /panel/api/models | 模型声明 |
| POST | /panel/api/models/refresh | 拉取上游模型，带冷却 |
| GET | /panel/api/model_probes | 模型实测 |
| GET | /panel/api/logs | 运行日志事件流 |
| GET | /panel/api/request_metrics | 请求指标汇总 |
| GET | /panel/api/request_logs | 错误归档，分页 20 |

### B.7 配置与偏好

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /panel/api/config | 读配置文件 |
| POST | /panel/api/config | 保存配置（上限 1 MiB，校验失败不落盘） |
| GET | /panel/api/preferences | 主题 / credit_guard_low / animation_style |
| POST | /panel/api/preferences | 部分字段更新，未带字段保持原值 |

### B.8 静态资源

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /panel/ | 单页入口 |
| GET | /panel/app.js | 引导脚本 |
| GET | /panel/assets/ | JS / CSS / PNG |
| GET | /panel/vendor/latency-trend.js | 延迟趋势脚本 |

---

## 附录 C：测试文件清单

全部位于 internal/panel/，由 frontend_test.go 统一用 node --test 拉起。

### C.1 基线 12 个

| 文件 | 覆盖 |
|---|---|
| frontend_animation_settings_test.mjs | 动画风格读写与预览 |
| frontend_egress_filter_batch_e_test.mjs | 出口页订阅筛选与节点绑定 |
| frontend_helpers_test.mjs | api / format / paginate 工具 |
| frontend_lifecycle_batch_e_test.mjs | 可见性轮询与清理 |
| frontend_logs_errors_test.mjs | 错误记录页 |
| frontend_modules_test.mjs | 模块加载与配置页 |
| frontend_overview_test.mjs | 概览聚合与圆环 |
| frontend_pool_test.mjs | 账号池卡片与分页 |
| frontend_preview_test.mjs | 预览态渲染 |
| frontend_startup_test.mjs | 启动动画时序与跳过 |
| frontend_subscriptions_test.mjs | 订阅 CRUD |
| frontend_v02_test.mjs | 整体冒烟 |

### C.2 批次新增 3 个

| 文件 | 来源批次 | 覆盖 |
|---|---|---|
| frontend_accounts_v2_test.mjs | 26（已提交 deac70e） | 紧凑账号卡：metrics 收敛、按钮顺序 |
| frontend_egress_v2_test.mjs | 24（未提交） | 出口页重构：多订阅、节点小卡、明文 URL |
| frontend_egress_picker_test.mjs | 24（未提交） | 节点选择器：缓存延迟直出、单击即绑 |

跑法：

步骤 1. go test ./internal/panel/ -run TestFrontend
步骤 2. node --test internal/panel/frontend_startup_test.mjs（单文件调试）

---

## 附录 D：设计参考与资产

### D.1 动画参考

源文件：F:\下载\新建 文本文档.html（只读，不得修改）。

它是启动动画的视觉母本。要求：

1. 全英文，字体与原文一致，逐字依次展现。
2. 可轻微改造，但字体气质与节奏必须保留。
3. 若与现有 startup-animation.js 冲突，以参考文件的视觉为准，改代码去适配。

### D.2 昼夜组件

参考：https://uiverse.io/Pradeepsaranbishnoi/strong-treefrog-90

要求切换时从月亮缺口 / 太阳位置扩散渐变，而不是整体淡入淡出。

### D.3 字体

| 用途 | 方案 | 许可 |
|---|---|---|
| 中文正文 | 无衬线中文（系统栈优先，如思源黑体 / 苹方 / 微软雅黑） | 系统或 OFL |
| 英文正文 | 类 Claude 的过渡衬线，候选：Newsreader、Source Serif 4、Lora | OFL |
| 数字与标签 | 同上英文衬线，或等宽变体做计数 | OFL |

现状（已合入，与目标有差距，这是批次 22 要收口的）：

1. 字体文件已内嵌在 internal/panel/assets/fonts/，由 fonts_test.go 守住 10 个 woff2 必须可服务。
2. --display 已是 Source Serif 4 + Noto Serif SC（衬线），用于 h1/h2/h3、统计数字、计数器。
3. --font 仍是 Source Sans 3 + Noto Sans SC（无衬线），正文、导航、按钮走这条。
4. --mono 仍是 JetBrains Mono / Cascadia / Consolas，但仓库未内嵌该字体，实际回落到系统等宽。

差距：用户要的是「英文正文也用 Claude 风格衬线」。当前只有标题与数字是衬线。改法是让 --font 的英文首选切到 Source Serif 4，中文仍用 Noto Sans SC，形成「英文衬线 + 中文黑体」的混排。

硬性约束：

1. 不得使用需要商业授权的字体。
2. 字体必须随二进制内嵌（go:embed），不得依赖外网 CDN。
3. 用户要求「直接能看到字体效果」，禁止要求本地额外安装。
4. 中文字体文件各约 600 KB，改动前先算 go build 后的二进制体积。

### D.4 视觉母题

1. 液态玻璃：高光、折射、边缘锐化，全部客户端 CSS/SVG 渲染，服务端零成本。
2. 底层流动：背景做缓慢流动的渐变噪声，同样纯客户端。
3. 悬浮导航：贴边吸附，不占布局宽度。
4. 留白与呼吸感：宁可少显示一列数据，不要把卡片塞满。

---

## 附录 E：文档维护约定

1. 本文档是唯一事实源；任何子智能体开工前必须先读第 8 节与附录 A。
2. 每批次合入后，同步更新第 3 / 4 / 5 / 6 节的状态，不要留在旧状态。
3. 新发现的坑写进第 10 节，不要只留在对话里。
4. 文档改动单独提交，不要和代码批次混在一起。
5. 提交前检查 CRLF：文件必须为 LF 结尾。

