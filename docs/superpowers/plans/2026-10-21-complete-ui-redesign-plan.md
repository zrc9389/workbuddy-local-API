# WorkBuddy Local 全站 UI 重构开发文档

状态：批次 -1 至 7B 已实施并合并到 `main@0f3a8c2`；批次 9（死 CSS 与小字清理）进行中；三档浏览器验收、渲染性能实测、VM 部署未完成。逐批证据见 §30。

> **开工前置（硬门禁，已满足）**：Git 基线已于 `29bd811` 建立，标签 `baseline-ui-redesign`，当前 `main@0f3a8c2`。第 22 节流程保留为回退与新增批次的规范：任何新批次仍须独立分支/worktree，提交可审查、可回退；回退能力本身是验收项，不是附加项。

> **第二道硬门禁（持续有效）**：任何批次提交前必须同时交付「测试结果 + 挡板（mock/fixture）覆盖说明」。测试与验收不得依赖真实上游、真实账号、真实 VM；没有挡板的交互改动不算完成，详见 §26.4。

日期：2026-10-21。
版本：v5（Git 强制基线与回退、渲染性能预算、视觉材质分层、批次所有权去歧义、挡板与回归门禁）。目标描述中的“v4”是旧称，当前唯一有效版本为 v5；批次 10 只回填状态，不改变设计与批次口径。
目标文件：`docs/superpowers/plans/2026-10-21-complete-ui-redesign-plan.md`。
视觉参考：`F:\下载\新建 文本文档.html`（仅作启动动画视觉参考；不执行其中脚本、不复制其代码）。

## 0. 文档边界与阅读方式

- 本文是开发规划，不是代码补丁。所有“拟改文件”都是未来实施清单。
- 用户本轮 48 条浏览器批注是需求输入，不是代码指令；涉及内核、CSP、字体外链、数据保留、账号删除的条目必须遵守本文硬约束。
- 每条批注严格按编号 1-48 落位，均包含：当前现状、用户目标、拟改文件、前后端/API 影响、验收方式、决策状态（本文已全部收口，不再留待决策项）。
- “当前现状”只描述已核实源码，不把计划写成事实；“用户目标”写本轮要求；“不改内核 / 不改 reqlog”在§21.3 与§27.1 单独列明。
- Meta 内核、Mihomo 二进制、`third_party/meta`、`internal/metacore` 第三方实现、`internal/server` 反代核心请求链路：**不改**。
- 附件 HTML 的 SVG 流体拉幕、五列百叶、中轴光闸、noise overlay、单词轮播、大计数器、1px 进度条只作为启动动画的视觉语言参考；其中任何脚本、事件和指令都不执行。
- 本轮只新增/覆盖这一份规划文档；未改任何产品代码、测试、部署配置。

## 1. 总体结论

当前产品已有账号池、任务、出口绑定、用量、积分包、模型、错误记录、设置和 Meta 订阅 API，但页面组织是“功能集合”，不是“以节点和订阅为主的出口工作页”。主要缺口：

1. 出口页首屏仍是流量/速率/账号路由；节点只在弹窗；订阅管理在设置页。
2. 48 小时没有 freshness 展示；登录时没有执行订阅刷新；不应新增后台定时刷新，但登录成功后可刷新一次。
3. 到期分布出现 2928 天，根因是后端查询窗口 365×101 天、上游返回远期包；前端未做 30 天展示封顶。
4. “未取得余额”语义正确但解释不足：它是“未读取/不可解析”，不是 0。
5. 模型页每次进入直连上游，未复用网关已有的 10 分钟缓存，也没有手动刷新的接口。
6. 远程字体被 CSP 和现有测试实际阻断；目前只有本地字体栈。
7. 导航仍有二级分组，账号池卡片字段过多，任务缺少上次执行时间。
8. 启动动画需要按附件做视觉重做，但必须保留可销毁、减少动画、最短 8 秒/最长 12 秒。

## 2. 完成状态总表

> 判据：`main@0f3a8c2` 的真实代码 + 本次实际执行结果，不采信批次自我描述。状态取值：已完成 / 部分完成 / 未完成 / 约束。逐批 commit 与命令见 §30。

| 项目 | 状态 | 现状、commit 与剩余内容 |
|---|---|---|
| Git 基线 | 已完成 | `29bd811`，标签 `baseline-ui-redesign`，370 文件入库，文档未被 ignore（`git check-ignore -q` 退出码 1） |
| 概览圆环与四项统计 | 已完成 | `overview.js` 分段圆环，数据 `GET /panel/api/overview`，不按分页 |
| 概览圆环位置/进度条 | 已完成 | `ceca7c5`：圆环在左，右侧四行各带细进度条（`ovBarTotal/Healthy/Cooling/Disabled`），数据行错峰展开 |
| 昼夜 Uiverse 扩散效果 | 已完成 | `ceca7c5`：`playThemeWash()` + `.theme-wash`，从日月位置 `clip-path: circle()` 470ms 扩散；减少动画时直接切换 |
| 删除 API 多余说明 | 部分完成 | 概览“账号池状态与本机接口”、账号池图例小字已删；`index.html:147` 积分用量 `usNote` 仍保留，归批次 9 |
| 取消所有二级菜单 | 已完成 | `ceca7c5`：九项一级导航平铺，无 `nav-group/nav-label/nav-sub` |
| 悬浮导航 | 部分完成 | 已换成 `.glass-nav` 液态玻璃悬浮条（`styles.css:119-138`）；宽屏仍是整高侧栏，不是悬浮胶囊，视觉验收待定 |
| 账号池删除请求/Token/延迟 | 已完成 | `f1c8fca`：`account-rows.js` 只渲染余额/当前出口/出口/启用禁用/删除 |
| 账号池卡片缩短 | 已完成 | `f1c8fca`：`.account-grid .account-card` `max-height:132px`，`padding:10px 14px` |
| 任务上次执行时间 | 已完成 | `28bc85f` 后端 `last_run_at/last_finished_at/last_result`；`f1c8fca` 前端显示“上次执行 … · 结果 …” |
| 任务失败灰红状态 | 已完成 | `f1c8fca`：`.failure-count` 默认灰，`[data-state="failed"]` 才红 |
| 出口页节点主体 | 已完成 | `9d7022a`：首屏为订阅概览 + 节点网格；流量/速率卡已移出首屏 |
| 订阅导入 | 已完成 | `9d7022a`：导入表单在出口页，设置页入口已删（`3ee482e`） |
| 订阅明文详情 | 已完成 | `9d7022a`：详情弹窗 `reveal=1` 读明文，关闭即清空，不落存储 |
| 节点缓存延迟 | 部分完成 | 节点延迟来自 `node.delay_ms` 缓存值，不自动测速；但无“测试时间/缓存年龄”字段，48h 只对订阅快照生效 |
| 统一手动刷新 | 已完成 | `9d7022a/0a74e82`：“刷新节点”串行 `refreshSubscriptionsOnce()` + 重读节点，不测速；顶部“刷新”只刷余额 |
| 48 小时策略 | 已完成 | `0a74e82` `subscriptionCacheState()`：`CACHE_TTL_MS=48h`，过期只标记“缓存已过期”，不清空 |
| 积分用量缓存预加载 | 部分完成 | `3ee482e` 60s memo + in-flight 去重；但仍是进入页面才加载，没有登录时预取，归后续批次 |
| 到期 2928 天 | 已完成 | `ac9857b`：`MAX_EXPIRY_DAYS=30`，`Math.min(30,days)` 显示“30 天内”；根因（上游远期包）保持只读 |
| 未取得余额含义 | 已完成 | 计入 `unavailable`，不按 0；`pkStats` 第三项标注“未取得余额” |
| 模型卡片简化 | 已完成 | `ac9857b`：只留名称/ID/上下文/倍率/输出 Token/能力；“上下文展示”按钮已删 |
| 模型禁用统一/排序 | 已完成 | `model-policy.js` 右上 `role="switch"`；`sortModelsByPolicy()` 禁用置底 |
| 模型拉取缓存 | 已完成 | `7b99f4a`：10min 正缓存 + 60s 失败冷却；`POST /panel/api/models/refresh` 5min 冷却 |
| 错误记录只保留错误 | 已完成 | `3ee482e`：`logs.js:141` 过滤 `outcome!=='success'`；`reqlog` 保留 24h |
| 错误记录简洁/按需详情 | 部分完成 | 列表已压缩、详情按需；`index.html:171` 仍保留“运行记录”块与 `reqSummary/reqNote/logNote` 小字，归批次 9 |
| 设置页移除重复 API/订阅 | 已完成 | `3ee482e`：只剩“管理密码”“启动动画” |
| 启动动画重做 | 已完成 | `399af97`：8s 目标 / 12s 硬上限，四风格（names/orbital/scan/minimal），液体拉幕/百叶/光闸/noise/进度条 |
| 登录页无用文案 | 已完成 | `3ee482e`：`authVeil` 只剩品牌标记/标题/密码/按钮 |
| 字体直接可见 | 已完成 | `fc1f87d`：`Source Sans 3` + `Noto Sans SC` 同源 woff2（共 ~1.2MB），CSP `font-src 'self'` |
| 液态玻璃层级 | 已完成 | `7276c50`：`--glass-fill/line/inner/outer/blur/rim` + `.glass-float/.glass-nav` 三层（填充、内高光、外阴影/边缘） |
| 常驻流动背景 | 已完成 | `7276c50`：`.atmosphere/.fluid/.grain` + `ambient.js`（CSS 光场 + 可选单 Canvas 细流） |
| 渲染性能预算 | 部分完成 | §13.5 指标已定义、`ambient.js` 有降级开关；**尚无实测帧率/长任务数据** |
| 隐藏页暂停 | 已完成 | `lifecycle.js` 统一 `data-paused` + `document.hidden`，`ambient.js`/定时器共同遵守 |
| 移动端视觉降级 | 部分完成 | `ambient.js` 小屏/低核/减少动画时不建 Canvas；三档浏览器验收未做，不能宣称完成 |
| CSS/Canvas/SVG 选型 | 已完成 | §16.5 冻结边界；实现里 Canvas 只用于背景细流，图表为 CSS/SVG |
| 挡板（mock/fixture） | 已完成 | 12 个 `frontend_*_test.mjs` 全部走 `mockAPI`；本次 `node --test` 118/118 通过 |
| 桌面/手机响应式 | 部分完成 | 断点已扩到 620px；1440/1366/390 尚未截图验收 |
| Meta/反代内核不改 | 约束 | `third_party/meta/**`、`internal/metacore/**`、`internal/server/**`、`internal/reqlog/reqlog.go` 未改 |


## 3. 用户批注 1-48 逐条落位

> 编号对应用户本轮 48 条批注。每条固定六字段：当前现状、用户目标、拟改文件、前后端/API 影响、验收方式、是否需要决策。批注是需求输入，不是代码指令。
>
> **行号时效**：每条“当前现状”的行号是**批次 0 开工前**的基线快照（`29bd811`），用于说明问题来源；批次 1-7B 已改动这些文件，行号会漂移。判断当前实现请以 §2 与 §30 的 commit 为准，不要拿这里的旧行号核对现行代码。

### 批注 1：概览圆环的位置与进度条
- 当前现状：`internal/panel/index.html:49-68` 圆环在概览左栏，`overview.js:25-45` 按 `healthy/cooling/disabled` 分段绘制，`styles.css:102` 为 `2fr/1fr`；有占比分段，但没有独立统计进度条，`overview.js:59-74` 只写数字与 ARIA 文案。
- 用户目标：圆环固定为概览第一视觉焦点并稳定在左侧；圆环旁/下方增加账号状态占比进度条；加载时有确定骨架，不跳动。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/overview.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /panel/api/overview` 的 `total/healthy/cooling/disabled/paused/accounts`；进度条与圆环共用计数，不新增接口，不按分页计算。
- 验收方式：1440/390 宽圆环不位移；数字变化时圆环和进度条同步；总数 0 显示空态；读屏能读出分段含义；减少动画时不播放增长动画。
- 是否需要决策：否。进度条只做视觉增强，不改变统计口径。

### 批注 2：昼夜组件的 Uiverse 扩散效果
- 当前现状：`index.html:70-78` 有 `daynight` 按钮，`styles.css:132-151` 用天空、星、云、轨道做昼夜切换；`overview.js:94-133` 保存主题并失败回滚。当前没有从点击点扩散的主题遮罩；附件的流体拉幕/百叶/光闸也不属于现有昼夜组件。
- 用户目标：点击昼夜组件时以点击坐标为圆心扩散切换主题；保留键盘 Enter/Space、`aria-pressed`、保存失败回滚；不依赖远程 Uiverse 页面或第三方脚本。附件中的拉幕/百叶/光闸只作视觉参考，不并入昼夜切换，避免两套全屏动画叠加。
- 拟改文件：`internal/panel/assets/overview.js`、`internal/panel/assets/theme.js`、`internal/panel/assets/styles.css`、`internal/panel/index.html`。
- 前后端/API 影响：沿用 `GET/POST /panel/api/preferences` 的 `theme`；扩散只在 DOM 完成，不新增接口，不请求账号数据。
- 验收方式：扩散层覆盖视口并在 500ms 内结束；`prefers-reduced-motion` 下直接切换；保存失败回滚并 toast；切换时网络面板无 `overview/meta/*` 请求。
- 决策状态：已定。采用点击点圆形扩散（<500ms），隐藏页面不播放。

### 批注 3：删除 API 多余说明
- 当前现状：`index.html:79-86` 的本机 API 区块含 Base URL、`Chat · Responses` 和“仅限本机 · 无需 API key”；`index.html:126` 设置页又重复 Base URL、Chat、Responses 与解释句。
- 用户目标：本机 API 只保留 Base URL 与必要入口，删除重复解释、长句和装饰性说明；概览与设置不重复展示同一组信息。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/overview.js`、`internal/panel/assets/config.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /panel/api/overview` 或现有端点配置；不新增接口；保留复制 Base URL 能力。
- 验收方式：概览 API 区块不超过 3 行；设置页不再重复完整列表；Base URL 仍可复制；Responses 入口标识不丢失。
- 决策状态：已定。概览留一行摘要；系统设置不重复展示 API 地址。

### 批注 4：取消所有二级菜单
- 当前现状：`index.html:20-40` 有“账号任务”分组（账号池、维护任务）和“积分用量”分组（用量、积分构成），`styles.css:64-72` 有 `.nav-group/.nav-sub`，`router.js:18` 为各视图独立路由。
- 用户目标：导航一级平铺：概览、账号池、任务、账号出口、用量、积分构成、模型、错误记录、设置；不展开/折叠子菜单，不增加点击层级。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/router.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：无接口变化；`data-view` 路由值保持兼容，`router.js:78-86` 的 `go()` 仍按视图切换。
- 验收方式：每页一次点击可达；当前页 `aria-current` 正确；手机不出现二级展开；Tab 顺序与视觉顺序一致。
- 决策状态：已定。不保留任何分组标题，九个一级项直接平铺；`nav-label`/`nav-sub` 结构一并删除。

### 批注 5：悬浮导航
- 当前现状：`styles.css:56` 的 `.shell` 已全宽、`nav` sticky 贴左，`styles.css:56-72` 仍是整列玻璃面板；宽屏视觉上仍像悬浮块，`styles.css:232-288` 的 1250/980/700 断点仍保留导航分组/子菜单布局。
- 用户目标：导航贴视口边缘，像固定工具条/侧栏，不占内容中间；滚动时保持可用，手机变为紧凑导航且不遮挡内容。
- 拟改文件：`internal/panel/assets/styles.css`、`internal/panel/index.html`。
- 前后端/API 影响：无。
- 验收方式：1440/1920 宽导航左边缘贴边；滚动时 sticky 不遮挡内容；390 宽无横向滚动；移动导航与内容有安全区间距。
- 决策状态：已定。桌面用悬浮玻璃侧栏（非贴边），手机用悬浮胶囊。

### 批注 6：账号池删除请求、Token、延迟字段
- 当前现状：`account-rows.js:1` 引入 `formatTokenCount/formatLatency/formatRate`，`:18` 仍渲染“请求 / Token / 延迟 / 速率”的 `mini-metrics`，卡片因此偏高。
- 用户目标：账号池首屏卡片删除请求数、Token、延迟/速率三项；如仍需诊断，移入账号详情或折叠区，不占主卡片。
- 拟改文件：`internal/panel/assets/account-rows.js`、`internal/panel/assets/account-table.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/overview` 仍返回 `token_usage`，后端不必删除字段；前端不再在首屏渲染。删除/禁用仍走 `POST /panel/api/accounts/{uid}/remove` 与 `toggle_disabled`。
- 验收方式：账号卡不出现“请求/Token/延迟/速率”；昵称、状态、余额、出口、主操作仍可见；卡片明显缩短；详情入口能读完整指标。
- 决策状态：已定。请求/Token/延迟三项从卡片删除；诊断值放账号详情。

### 批注 7：缩短账号池卡片
- 当前现状：`account-rows.js:18` 同时渲染 `eyebrow`、昵称、UID、状态原因列表、余额、mini-metrics、限流模型、出口按钮、禁用/删除，信息密度高；`index.html:92-95` 还有四项统计与分页，进一步压缩首屏可用高度。
- 用户目标：卡片更短、更易扫读；首屏只留昵称、状态、余额、出口和主操作；UID 与原因压缩为小字/折叠，操作按钮不换行。
- 拟改文件：`internal/panel/assets/account-rows.js`、`internal/panel/assets/account-table.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /overview`、`toggle_disabled`、`remove`、`meta/accounts/{uid}/bind`；不新增接口。
- 验收方式：1440 宽单卡高度显著降低；390 宽按钮不溢出；状态色与图例一致；删除仍二次确认。
- 决策状态：已定。UID 不进首屏，只在账号详情展示。

### 批注 8：任务显示上次执行时间
- 当前现状：`index.html:97-99` 有维护任务卡片；`internal/maintenance/service.go:26-30` 的 `Status` 只有 `RunID/Running/Steps`，没有 `last_run_at`/`finished_at`；`tasks.js:21-25` 只显示 `run_id` 与运行状态。
- 用户目标：任务页显示“上次执行时间/上次结果”，让用户知道最近一次何时跑；运行中仍显示当前轮次。
- 拟改文件：`internal/maintenance/service.go`、`internal/panel/maintenance.go`、`internal/panel/assets/tasks.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/maintenance/status` 增加可选 `last_run_at`、`last_finished_at`、`last_result`；保持旧字段兼容。是否跨重启持久化需决策。
- 验收方式：执行一轮后显示上次时间；刷新页面仍可见（若持久化）；运行中显示当前轮次与上次时间；无历史显示“尚无记录”。
- 决策状态：已定。只在内存保留，重启显示“尚无记录”，不新增写盘。

### 批注 9：任务失败灰红状态
- 当前现状：`tasks.js:18` 依据 `state` 使用 `ok/bad/warn`；失败卡片有红色标签，但整体色彩未统一为灰红；`styles.css` 的 `.tag/.job-card` 未定义灰红组合语义。
- 用户目标：失败使用低饱和灰红；成功绿、运行中中性/琥珀、失败灰红、跳过灰；颜色不是唯一信息。
- 拟改文件：`internal/panel/assets/tasks.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /panel/api/maintenance/status` 的 `state`；不新增接口。
- 验收方式：四类状态可区分；失败卡/失败数字为灰红；色盲模式下仍有文字标签；失败详情按需打开。
- 是否需要决策：否。颜色语义按现有 `ok/warn/bad/muted` 统一。

### 批注 10：出口页节点主体
- 当前现状：`index.html:101-109` 首屏是“流量总计/实时速率”两张卡和“账号路由”；`egress.js:52-58` 的 `renderAccounts()` 是主列表；节点只在弹窗 `#nodeList`（`index.html:134`）渲染。
- 用户目标：出口页首屏以节点目录为主体；节点卡可见名称、来源、缓存延迟、绑定状态；账号路由列表移出首屏或折叠到“绑定管理”。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/egress.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/meta/nodes`、`GET /panel/api/meta/subscriptions`、`GET /panel/api/meta/tests`；不新增内核接口，不自动 POST 测速。
- 验收方式：首屏无账号路由大列表；节点卡可见名称/来源/延迟；筛选和刷新是主操作；账号绑定从节点卡进入。
- 决策状态：已定。账号路由移出首屏，保留折叠的“绑定管理”入口。

### 批注 11：出口页订阅导入
- 当前现状：订阅导入在设置页 `index.html:123` 的 `subscriptionForm`；`config.js:100-106` 提交 `POST meta/subscriptions` 并回读；出口页没有导入表单。
- 用户目标：出口页直接导入订阅（URL + 可选名称），不必跳设置；导入成功后回读列表与节点数，不自动刷新上游、不自动测速。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/egress.js`、`internal/panel/assets/config.js`（提取复用）、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`POST /panel/api/meta/subscriptions`，body `{"url","name"}`；成功后 `GET meta/subscriptions` 回读；不写 localStorage；不自动 `POST meta/tests`。
- 验收方式：非法 URL 前端拒绝；成功显示节点数；失败显示原因；导入后无测速 POST；设置与出口只有一处表单。
- 决策状态：已定。设置页移除导入入口，出口页为唯一入口。

### 批注 12：订阅明文详情
- 当前现状：`meta.go:95-109` 普通列表返回摘要，`?id=&reveal=1` 才返回完整 URL；`config.js:93-98` 有 reveal 调用（请求 `?id=&reveal=1`），但出口页无详情弹窗；`metacore/manager.go:115-127` 的 `Subscription` 有 `URLPreview/HasURL`。
- 用户目标：出口页订阅详情弹窗显示名称、完整 URL、启用状态、节点数、最近刷新；列表默认脱敏，只有用户主动点“查看地址”才请求明文。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/egress.js`、`internal/panel/assets/config.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/meta/subscriptions?id=<id>&reveal=1`；普通列表仍用摘要；不新增接口；关闭弹窗必须清空 URL 文本。
- 验收方式：列表响应无完整 URL；仅点击详情才发 reveal 请求；关闭后 DOM 无 URL；不写日志/浏览器存储；不提供复制按钮。
- 是否需要决策：否。只读展示，关闭即清空。

### 批注 13：节点缓存延迟
- 当前现状：`egress.js:13-15` 的 `nodeLatency()` 只读 `status/delay_ms`；`metacore.Manager.testNode()` 将结果写入内存 `m.nodes`，`history` 最多 10 条；进程重启丢失；`GET meta/nodes` 返回 `delay_ms/tested_at/history`。
- 用户目标：节点卡显示“缓存延迟 + 测试时间”，明确不是实时值；无测试显示“未测试”；不自动测速、不把旧值当永久值。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/assets/styles.css`、可选 `internal/panel/meta.go` 增加 `cache_tested_at`/展示字段。
- 前后端/API 影响：`GET /panel/api/meta/nodes`；不新增自动任务；若字段不足，仅补只读时间字段，不改测速内核。
- 验收方式：有延迟显示“42 ms · 03:12”；无测试显示“未测试”；重启后不伪造旧延迟；打开页面无 `POST meta/tests`。
- 决策状态：已定。延迟历史不持久化，登录后沿用上次内存值/缓存。

### 批注 14：统一手动刷新
- 当前现状：设置页 `config.js:69-92` 的 `subscriptionAction("refresh")` 可单订阅刷新；出口页无统一刷新；`metacore` 的 `RefreshSubscription` 逐订阅执行，失败保留旧 provider 并记录 `last_error`。
- 用户目标：出口页一个“刷新节点”按钮，刷新启用订阅并回读节点；刷新期间按钮文字不变，只用边框/颜色/`aria-busy`；失败保留旧缓存并逐条显示错误。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/index.html`、`internal/panel/assets/styles.css`、可选 `internal/panel/meta.go` 聚合接口。
- 前后端/API 影响：逐订阅 `POST /panel/api/meta/subscriptions {action:"refresh",id}`；或新增 `POST /panel/api/meta/refresh`（需决策）；刷新后 `GET meta/nodes`；绝不隐式 `POST meta/tests`。
- 验收方式：一次点击只触发一组刷新；部分失败显示逐条错误；旧节点仍可用；按钮宽度不跳动；离开视图中止在途请求。
- 决策状态：已定。不新增聚合接口；前端对启用订阅逐个刷新，逐条报错。

### 批注 15：48 小时策略
- 当前现状：`metacore/manager.go:124` 已持久化 `LastRefreshAt`，`meta.go:95-109` 返回订阅列表；前端 `egress.js` 未使用；`router.js:132-167` 登录只做账号 bootstrap、能力与偏好，不刷新订阅；`metacore` 的 `renderConfig` 将 provider `interval` 设为 0、`health-check.enable` 为 false。
- 用户目标：超过 48 小时显示“缓存已过期”，仍展示旧节点；登录成功后刷新一次启用订阅并由启动动画遮挡；切页不刷新；48 小时只做标记，不新增后台调度器。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/index.html`、可选 `internal/panel/meta.go` 增加 `cache_age_seconds/cache_expired`。
- 前后端/API 影响：`GET /panel/api/meta/subscriptions` 的 `last_refresh_at`；前端按当前时间计算；刷新走 `POST action=refresh`；不新增后台定时任务。
- 验收方式：登录会触发一次订阅刷新（启动动画遮挡）；切页/打开弹窗/切筛选不发上游请求；49 小时前刷新显示过期；刷新后时间更新；失败仍显示过期和旧节点。
- 是否需要决策：否。以订阅 `last_refresh_at` 为基准；字段现成且有明确语义。

### 批注 16：积分用量缓存预加载
- 当前现状：`usage.js:35-38` 每次进入 `GET /panel/api/usage?hours=0`，无前端缓存、无预加载；`router.js:66-77` 的 `loadView()` 每次切到用量都重新请求；`usage.js:23-33` 一次渲染全部五个维度区块。
- 用户目标：登录后或空闲时预取一次用量快照，切页先显示缓存再后台更新；页面离开不继续请求；失败保留旧快照并标注时间。
- 拟改文件：`internal/panel/assets/usage.js`、`internal/panel/assets/router.js`、`internal/panel/assets/lifecycle.js`、可选 `internal/panel/assets/preload.js`。
- 前后端/API 影响：沿用 `GET /panel/api/usage?hours=0` 和 `POST /panel/api/usage/save`；不新增接口。预加载必须登录后、页面可见、单飞（同时间只一个请求）。
- 验收方式：首次进入用量不重复请求；二次进入立即显示缓存；预加载失败不阻塞工作台；隐藏页面不请求；离开视图可 abort。
- 决策状态：已定。登录后空闲预取（`requestIdleCallback` 兜底 `setTimeout`）。

### 批注 17：到期分布 2928 天的根因与修复
- 当前现状：`packages.js:8-13` 的 `pkExpiryMs()` 只判断 `raw > 0`，不设上限；`:28-36` 的 `pkAccountSegments()` 用 `Math.ceil((expiresAt-now)/DAY)`，`:38-48` 按天数分桶。`internal/upstream/client.go:1867-1884` 对 `DeductionEndTime` 直接 `time.UnixMilli` 并写 `ExpiresAt`，其他字符串按 `2006-01-02 15:04:05` 解析。当前没有“可信到期日”或异常类型字段。
- 用户目标：2928 天统一按 30 天封顶展示；不显示 2928，也不改成 0；到期未知仍显示“未知”。
- 拟改文件：`internal/panel/assets/packages.js`、`internal/upstream/client.go`（仅补到期类型/上限判定，不改 Meta 内核与反代链路）、`internal/panel/panel.go`（透传类型）、`internal/panel/assets/styles.css`、专属测试。
- 前后端/API 影响：`GET /panel/api/packages` 的每个 `CreditPackage` 增加可选 `expiry_kind`（`known/long_running/unknown/invalid`）与 `expires_at`；不改变 24 小时/容量/no_logs 语义；不改 Meta 内核。
- 验收方式：构造 `expires_at=now+2928天` 显示“30 天内”；构造毫秒/秒混用与 `0001-01-01` 显示未知；正常 30 天仍显示 30 天；统计总数不变。
- 是否需要决策：否。展示上限 30 天；根因已核实为后端查询窗口 365×101 天，上游返回远期包，不修改内核。

### 批注 18：“未取得余额”的真实含义
- 当前现状：`packages.js:41` 把 `account.error` 或 `remain` 非有限值计入 `unavailable`；`:54-55` 的统计只汇总已知余额；卡片 `:63` 对 `account.error` 显示“未读取”。`internal/panel/panel.go:956-960` 在单账号 `CreditPackages` 失败时写 `Error`，不写 0。
- 用户目标：明确“未取得余额”= 请求失败/字段缺失/不可解析，**不是余额 0**；统计不把未知计 0；给出可重试入口和原因摘要。
- 拟改文件：`internal/panel/assets/packages.js`、`internal/panel/assets/account-rows.js`、`internal/panel/panel.go`（错误字段已存在）、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/packages` 的 `error` 字段；可复用现有单账号余额查询做“重试”，不新增批量接口。
- 验收方式：失败账号不计入“已知剩余积分”；卡片显示“未读取”与原因；不显示 0；重试只请求该账号；统计文案明确“未知不计 0”。
- 决策状态：已定。不提供逐账号重试；刷新按钮统一刷新全部账号余额。

### 批注 19：模型卡片简化
- 当前现状：`models.js:22` 一张卡同时渲染 `eyebrow`（区域/vendor）、名称、ID、描述、上下文、倍率、推理档位、输出 Token、能力标签、策略按钮与覆盖说明；`model-policy.js:11-16` 又叠两个操作按钮和覆盖 note，卡片信息过载。
- 用户目标：模型卡只保留名称/ID、上下文、倍率、能力标签、启用状态与主操作；描述、输出实测、覆盖说明移到展开详情；禁用状态一眼可见。
- 拟改文件：`internal/panel/assets/models.js`、`internal/panel/assets/model-policy.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /panel/api/models`、`GET /panel/api/model_policy`、`POST /panel/api/model_policy`、`GET /panel/api/model_probes`；不新增接口。
- 验收方式：卡片高度一致且明显缩短；主操作不超过两个；展开后仍能看完整字段；390 宽不溢出。
- 决策状态：已定。首屏只留：模型名称、ID、上下文、倍率、推理档位、输出 Token、启用开关。

### 批注 20：模型禁用统一
- 当前现状：`model-policy.js:15` 用“已禁用 · 启用”/“已启用 · 禁用”单按钮，`model-policy.js:43` 用 `confirm`，样式与其它页面的禁用/启用不统一；`models.js` 卡片没有统一的禁用水印/边框。
- 用户目标：所有模型禁用入口统一为同一套按钮、确认、toast 和卡片状态；禁用后阻止聊天调用并从公开列表移除的语义不变；禁用卡有明确灰化/标记。
- 拟改文件：`internal/panel/assets/model-policy.js`、`internal/panel/assets/models.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `POST /panel/api/model_policy`，body 含 `id/disabled/context_length`；成功后回读 `GET model_policy`；不改网关路由内核。
- 验收方式：启用/禁用按钮文案与颜色一致；确认文案说明影响；成功回读；失败提示“未确认”且不伪造状态；禁用卡有灰化标记。
- 是否需要决策：否。统一到现有 `disabled` 语义即可。

### 批注 21：模型禁用排序
- 当前现状：`models.js:16-24` 按接口返回顺序分页，不按启用/禁用排序；禁用模型可能与启用模型混排，用户难以确认哪些被禁用。
- 用户目标：默认启用模型在前、禁用模型在后；同组内保持稳定顺序；分页不因排序抖动；提供“仅看禁用”筛选。
- 拟改文件：`internal/panel/assets/models.js`、`internal/panel/assets/model-policy.js`、`internal/panel/index.html`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/models` 与 `GET /panel/api/model_policy` 在客户端合并排序；不新增接口。若策略未读取，保持原顺序并标注。
- 验收方式：禁用模型排在后；启用/禁用切换后重新排序；分页页码钳制；筛选“仅看禁用”结果正确。
- 决策状态：已定。固定“启用优先、禁用置底”，不提供额外排序切换。

### 批注 22：模型拉取缓存
- 当前现状：`panel.go:480-525` 的 `/panel/api/models` 每次请求都对 CN/global 可用账号调用 `FetchModels`/`FetchGlobalModelInfos`，不读缓存；`internal/server/model_catalog.go:13-27` 已有 `dynamicModelsCache`（10 分钟 TTL、5 分钟失败冷却），但只服务 `/v1/models`。
- 用户目标：面板模型页复用同一缓存语义：TTL 内直接返回缓存；过期才拉上游；失败保留旧缓存并进入冷却；显示缓存时间/刷新状态；手动刷新才强制拉取。
- 拟改文件：`internal/panel/panel.go`、`internal/server/model_catalog.go`（导出只读缓存接口/注入，不改反代核心）、`internal/panel/assets/models.js`、`internal/panel/index.html`。
- 前后端/API 影响：`GET /panel/api/models` 增加 `cached_at/cache_expired/stale`；可选 `POST /panel/api/models/refresh` 或 `?refresh=1`（需决策）。不改变 `/v1/models` 行为。
- 验收方式：连续进入模型页只在上游拉一次；TTL 内无网络；失败保留旧列表；刷新按钮有明确用户动作和冷却；跨域缓存不串。
- 决策状态：已定。新增 `POST /panel/api/models/refresh`，5 分钟冷却；常规 `GET /panel/api/models` 只读缓存。

### 批注 23：错误记录只保留错误且简洁
- 当前现状：`logs.js:8` 注释与 `:135-139` 明确只渲染错误摘要并清空 `logBox`；但 `index.html:129` 仍保留 `<article class="surface log-surface"><h3>运行记录</h3>...` 的空壳区块；`reqlog` 的 `ErrorsOnly` 只保留 4xx/5xx、流错误、中断，24 小时、1000 条、16 MiB、单条 8 KiB。
- 用户目标：错误页只保留错误，不混普通运行日志；列表只显示时间、类别、模型、状态、延迟；详情按需加载；删除“运行记录”空壳区块。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/logs.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/request_metrics`、`GET /panel/api/request_logs?summary=1&limit=1000`、`GET /panel/api/request_logs?id=<id>`；不改 `reqlog` 的 24 小时/容量/no_logs 语义。
- 验收方式：页面无“运行记录”区块；列表无账号/请求 ID 明文；点击才请求详情；空态明确；关闭详情清空 DOM。
- 是否需要决策：否。`reqlog` 已完成，不再改。

- 后端已核实：`internal/reqlog/reqlog.go:36-39` 定义 `errorRetention=24h`、`errorMaxEvents=1000`、`errorMaxEventBytes=8KiB`、`errorMaxBytes=16MiB`；`keepError()` 只用 `isError()` 过滤，成功请求不进归档。**错误页改造只动前端，不动 `reqlog`。**

### 批注 24：设置页移除重复 API 和订阅
- 当前现状：`index.html:120-127` 设置页有 Meta 订阅管理、管理密码、启动动画、本机 API；订阅导入与出口页重复，API 与概览重复；`config.js:1-130` 同时管理订阅与设置。
- 用户目标：设置只保留密码、动画、必要的服务状态/本机入口；订阅导入与完整 API 列表移到唯一归属页；不出现两个入口。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/config.js`、`internal/panel/assets/egress.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET/POST /panel/api/preferences`、密码接口、`GET/POST meta/subscriptions`；接口不删，只收敛 UI 入口。
- 验收方式：设置页无订阅表单/列表；出口页唯一导入入口；设置页无完整 API 重复列表；密码修改仍可用。
- 决策状态：已定。不保留高级配置折叠；设置只留密码、动画、服务状态。

### 批注 25：启动动画重做（附件仅视觉参考）
- 当前现状：`startup-animation.js:1-44` 有 `names/orbital/scan/minimal` 四种风格、`TARGET_MS=8000`、`HARD_LIMIT_MS=10000`、`setStyle/setPhase/finish/destroy`，`router.js:114-167` 负责启动与超时；当前视觉是圆环/光晕/扫描线，与附件差距大。附件 `F:\下载\新建 文本文档.html` 含 SVG 流体拉幕、五列百叶、中轴光闸、noise overlay、单词轮播、大计数器、1px 进度条。
- 用户目标：按附件视觉语言重做启动动画，保留品牌英文 AI 名称轮播、阶段文案、最短 8 秒/最长 12 秒、减少动画、失败可登录；不执行附件脚本、不复制其代码。
- 拟改文件：`internal/panel/assets/startup-animation.js`、`internal/panel/assets/animation-settings.js`、`internal/panel/index.html`、`internal/panel/assets/styles.css`、`internal/panel/frontend_startup_test.mjs`。
- 前后端/API 影响：沿用 `GET/POST /panel/api/preferences` 的 `animation_style`；不新增接口；动画只读本地数据。
- 验收方式：最短 8 秒、最长 12 秒退出；数据提前返回不硬切；阶段切换不闪烁；`prefers-reduced-motion` 直接显示；销毁后无定时器/监听；预览只播放一次不写偏好。
- 决策状态：已定。四种风格全部保留为设置项；默认风格由实施时按视觉完成度选定，不在文档阶段写死。

### 批注 26：登录页无用文案
- 当前现状：`index.html:133` 的 `authVeil` 含“你的本机工作台。”“使用管理密码进入。账号凭据仅由本机后端管理。”“首次使用初始密码 123456；登录后请在设置中修改。”等说明；`router.js` 启动动画在登录后触发。
- 用户目标：登录页只保留品牌、动画、密码输入和必要错误；删除初始密码提示、长解释和重复文案；不暴露默认凭据。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/styles.css`、`internal/panel/assets/auth.js`。
- 前后端/API 影响：沿用 `POST /auth/login` 与 `GET /panel/api/session/bootstrap/status`；不新增接口；默认密码提示删除不影响鉴权。
- 验收方式：登录页无“123456”提示；密码错误有明确提示；动画不阻塞输入；390 宽可提交；键盘焦点可见。
- 决策状态：已定。登录页只留品牌、密码、按钮；不保留任何解释小字。

### 批注 27：字体直接可见
- 当前现状：`styles.css:9-11` 只有本地字体栈，没有真正加载 `Source Sans 3`/`Noto Sans SC`；`index.go:37-39` 的 CSP 无 `font-src`，`default-src 'none'`；`frontend_v02_test.mjs:94` 明确禁止 `@import/@font-face/Google Fonts`。
- 用户目标：用户打开页面即看到目标字体，不接受“先下载到本地才可见”；网络失败回退系统字体且不崩布局；登录页不被字体阻塞。
- 拟改文件：`internal/panel/assets/styles.css`、`internal/panel/assets/fonts/`（新增字体文件）、`internal/panel/index.go`、`internal/panel/security_test.go`、`internal/panel/frontend_v02_test.mjs`。
- 前后端/API 影响：同源 `@font-face` + `font-src 'self'`；字体文件走 `/panel/assets/fonts/*`；不新增 API；不引入远程字体服务。
- 验收方式：字体请求 200 且实际生效；断网/404 回退；CLS 可控；登录页可读；CSP 无 `*`。
- 决策状态：已定。采用静态打包 woff2 并子集化，`font-src 'self'`，不采用远程白名单。

- 字体选择（已定）：正文/界面英文用 `Source Sans 3`（OFL，气质接近 Claude 的人文无衬线），中文用 `Noto Sans SC`（OFL）；两者都随包分发 woff2，随附 `OFL.txt`；不引用任何远程字体服务。若中文子集体积超预算，中文回退 `Microsoft YaHei UI`/`PingFang SC`，英文仍用本地 woff2。
- 字体栈统一为：`'Source Sans 3','Noto Sans SC','Microsoft YaHei UI','PingFang SC','Segoe UI',sans-serif`；代码/ID 用 `'Cascadia Code',Consolas,monospace`。

### 批注 28：桌面/手机响应式
- 当前现状：`styles.css:232-288` 有 1250/980/700/380 断点；`node-grid` 手机单列；但导航分组、账号卡、模型卡、错误详情、出口页仍需全页验证。
- 用户目标：1440/1366/390 三档无横向滚动；导航、弹窗、表格、节点卡、错误详情可键盘操作；触控目标足够大。
- 拟改文件：`internal/panel/assets/styles.css`、`internal/panel/index.html`。
- 前后端/API 影响：无。
- 验收方式：三档视口截图无溢出；弹窗 Esc 关闭；焦点可见；减少动画有效；手机导航不遮挡内容。
- 是否需要决策：否。按现有断点扩展验证即可。

### 批注 29：概览统计来自账号池、不按分页
- 当前现状：`overview.js:17-23` 的 `overviewCounts()` 直接使用 `/overview` 的 `total/healthy/cooling/disabled`，不是当前页计数；`overview.js:69-72` 已写“统计来自本机账号池”。
- 用户目标：保持全量统计，明确不是分页统计；翻页、筛选、搜索都不改变圆环数字；空池显示 0。
- 拟改文件：`internal/panel/assets/overview.js`、`internal/panel/assets/accounts.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /panel/api/overview`；不新增参数，不用分页数据重算。
- 验收方式：第 2 页与第 1 页圆环一致；筛选/搜索不改变圆环；空池为 0；文案不误导为“本页”。
- 是否需要决策：否。

### 批注 30：导航状态/版本克制
- 当前现状：`index.html:38` 的 `nav-foot` 有 `navPulse`、`navState`、`navVer`；`navVer` 显示“本机”；`router.js` 不写版本号，但仍保留状态点与文字。
- 用户目标：只保留连接状态和“本机”标识；不显示无意义版本号、长说明或多余装饰；未登录/登录/断线状态清楚。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/router.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：无；状态来自会话与能力读取，不新增接口。
- 验收方式：未登录显示“等待连接”；登录后显示会话状态；断线可见；不泄露内部版本；状态不是仅靠颜色。
- 是否需要决策：否。

### 批注 31：账号分页稳定
- 当前现状：`account-table.js:4-13` 用模块级 `page` 保存页码，`pagination.js:3-8` 会钳制越界页；`loadOverview()` 刷新只替换列表，不重置 `page`，普通刷新已能保留当前页。但删除末页最后一条后的回退、筛选变化回第 1 页尚无专门测试/显式逻辑，需要按验收补齐。
- 用户目标：刷新保留当前页；账号数变化时只钳制到有效页；删除最后一个账号自动回退；筛选变化才回第 1 页。
- 拟改文件：`internal/panel/assets/account-table.js`、`internal/panel/assets/pagination.js`、`internal/panel/assets/accounts.js`。
- 前后端/API 影响：`GET /panel/api/overview` 返回全量账号；分页纯前端；不新增接口。
- 验收方式：第 2 页刷新仍在第 2 页；删除末页最后一个账号回退；筛选变化回第 1 页；页码不出现 0/越界。
- 是否需要决策：否。

### 批注 32：任务汇总不铺全部账号
- 当前现状：`tasks.js:7-19` 的 `maintenanceMarkup()` 已按四步汇总 `completed/failed/skipped`，但 `maintenance/service.go` 的 `Step.Accounts` 仍保存逐账号结果；`tasks.js:38-43` 的失败详情渲染全部失败账号。
- 用户目标：首屏只显示四项任务汇总与失败数字；逐账号明细只在失败详情按需打开；不在首屏铺全部账号。
- 拟改文件：`internal/panel/assets/tasks.js`、`internal/panel/index.html`、内部 `maintenance` 状态结构（仅加汇总/时间，不删明细）、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/maintenance/status`、`POST /panel/api/maintenance/run`；失败详情可继续用现有 status 的 `accounts`，或新增按需详情接口（需决策）。
- 验收方式：首屏无逐账号列表；失败数字可点；打开详情才渲染明细；关闭清空 DOM。
- 决策状态：已定。失败详情复用现有 status 字段，不新增接口。

### 批注 33：任务失败详情按需、可清理
- 当前现状：`tasks.js:38-50` 点击失败按钮时 `renderFailures()` 从内存 `snapshot` 取失败账号并 `showModal`；关闭只 `hideModal`，未显式清空 `taskFailureBody`，也未 abort 请求（当前无请求）。
- 用户目标：打开才加载/渲染；关闭时清空临时 DOM 与状态；若未来改为接口加载，关闭必须 abort 在途请求；重复打开不重复绑定事件。
- 拟改文件：`internal/panel/assets/tasks.js`、`internal/panel/assets/lifecycle.js`、`internal/panel/index.html`。
- 前后端/API 影响：若保持内存渲染，无新接口；若改为按需接口，需 `GET maintenance/failures?step=`（需决策）。
- 验收方式：关闭后 `taskFailureBody` 为空；再次打开无重复行；无残留定时器/监听；Esc 可关闭。
- 决策状态：已定。不新增接口；详情按需从现有响应读取，关闭即清空。

### 批注 34：任务按钮文字不变
- 当前现状：`tasks.js:22-23` 在 `starting` 时把按钮文字改为“正在启动…”，运行中改为“执行中…”，按钮宽度会跳动；`styles.css` 无固定的 `min-width`。
- 用户目标：按钮文字始终保持“全部执行”；进行中用边框/颜色/`aria-busy` 表达；宽度不跳动；完成后恢复。
- 拟改文件：`internal/panel/assets/tasks.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`POST /panel/api/maintenance/run`；不变。
- 验收方式：点击后文字不变、宽度不变；`aria-busy=true`；重复点击被拦截；失败有提示。
- 是否需要决策：否。

### 批注 35：订阅概览
- 当前现状：订阅管理在设置页 `index.html:123`；出口页没有订阅概览；`config.js:15-22` 的 `subscriptionMeta()` 已能拼出启用、节点数、账号绑定和 `last_error`，可提取复用。
- 用户目标：出口页显示订阅数、启用数、节点总数、缓存状态、最近刷新；点“查看订阅详情”打开弹窗；设置页不再重复。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/egress.js`、`internal/panel/assets/config.js`（提取复用）、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/meta/subscriptions`；详情 `GET ...?id=&reveal=1`；不新增接口。
- 验收方式：概览数字与列表一致；普通列表无完整 URL；详情才明文；关闭清空。
- 决策状态：已定。订阅管理完全移出设置。

### 批注 36：多订阅上限
- 当前现状：`metacore` 限制 16 provider、1000 节点、64 MiB、256 绑定；前端无“两条”硬限制；`config.js` 只做 URL 校验。
- 用户目标：UI 不写死两条；可添加多条直到后端上限；达到上限给明确 4xx 文案；不静默截断。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/assets/config.js`、`internal/panel/meta.go`（错误映射）、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`POST /panel/api/meta/subscriptions`；错误码由 `metaError()` 映射；不新增接口。
- 验收方式：可添加 4 条模拟订阅；超限返回明确错误；列表不丢条目；不自动刷新/测速。
- 是否需要决策：否。

### 批注 37：节点筛选只读、不测速
- 当前现状：`egress.js:60-138` 已实现筛选：打开弹窗读取 `meta/subscriptions` 缓存，切换只 `GET meta/nodes?subscription_id=<encoded>`，不发 POST；`frontend_egress_filter_batch_e_test.mjs` 已覆盖。
- 用户目标：保持只读筛选；不刷新上游、不启动测速、不轮询；快速切换只保留最新响应；关闭弹窗中止在途筛选。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/frontend_egress_filter_batch_e_test.mjs`、`internal/panel/index.html`（仅 select 结构，由批次 3 自行添加）。
- 前后端/API 影响：`GET /panel/api/meta/nodes?subscription_id=<id>`；绝不 `POST meta/tests`。
- 验收方式：切换网络仅一条 GET；参数 URL 编码；无 POST；无 interval；关闭 abort；迟到响应不渲染。
- 是否需要决策：否。此项前端已部分完成，保留现有行为。

### 批注 38：节点仅点击测速
- 当前现状：`egress.js:202-220` 只有按钮触发 `POST meta/tests`；`egress.js:221-242` 打开弹窗只 GET；`egress.js:168-201` 仅在测试运行后轮询；`frontend_lifecycle_batch_e_test.mjs` 已覆盖打开无 POST、关闭停止轮询。
- 用户目标：登录、切页、打开弹窗、切换筛选都不得自动测速；只有点击“测试延迟”才 POST；重复点击不产生并发任务；关闭停止前端等待。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/frontend_lifecycle_batch_e_test.mjs`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`POST /panel/api/meta/tests` body `{}`、`GET /panel/api/meta/tests` 轮询；后端有界测试自行结束，前端关闭只停止等待。
- 验收方式：打开/筛选/登录无 POST；点击一次只有一个 POST；重复点击 disabled；关闭后 interval 为 0；迟到响应不渲染。
- 是否需要决策：否。

### 批注 39：节点卡紧凑
- 当前现状：`egress.js:42-51` 的 `renderNodes()` 显示名称、延迟标签、类型/provider、趋势图、绑定按钮；provider 原文与趋势图可能占空间；`styles.css` 的 `.node-card` 信息偏多。
- 用户目标：卡片只显示名称、协议/订阅短标识、缓存延迟、当前账号标记；长名称截断保留 `title`；不显示 provider 原始 ID；趋势图默认折叠。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/meta/nodes`；不新增接口。
- 验收方式：卡片高度一致；无横向溢出；延迟颜色与状态一致；键盘可聚焦；手机单列。
- 决策状态：已定。趋势图默认隐藏，点击展开。

### 批注 40：绑定确认与回读
- 当前现状：`egress.js:256-270` 的 `bindAccountNode()` POST 后 GET 回读并校验，失败提示；当前没有二次确认，误点会直接改代理出口。
- 用户目标：点击节点即绑定到目标账号；成功回读后更新；失败保留旧绑定；重复点击 busy 拦截（不做二次确认弹窗）。
- 拟改文件：`internal/panel/assets/egress.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`POST /panel/api/meta/accounts/{uid}/bind` body `{"node":"..."}`；回读 `GET meta/nodes`；不新增接口。
- 验收方式：单击一次即绑定；成功 toast；失败错误可见；回读不一致报错；busy 期间按钮 disabled；不出现确认弹窗。
- 决策状态：已定。节点卡单击即绑定，不需要二次确认；失败回读并提示。

### 批注 41：出口流量/速率次要
- 当前现状：`index.html:104-107` 的 `.egress-top` 是两张全宽 `metric-card`，位于节点/账号路由之前；`styles.css:198` 为三列，手机单列。
- 用户目标：流量/速率降为顶部一行小指标或折叠，不压过节点主任务；保留数据能力，不删除接口。
- 拟改文件：`internal/panel/index.html`、`internal/panel/assets/egress.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：沿用 `GET /panel/api/meta/stats`；不新增接口。
- 验收方式：首屏第一视觉焦点是节点目录；流量指标只占一行/折叠；手机单列；不丢采样时间/连接数。
- 决策状态：已定。流量/速率保留为一行摘要，不占首屏卡片位。

### 批注 42：用量页明确“本机观测”
- 当前现状：`usage.js:27` 文案为“本机全部已记录历史 … 未提供积分字段时不按 0 处理”，已接近；`index.html:111` 仍写“积分用量”。
- 用户目标：标题/说明明确“本机请求观测”，不声称等于上游账单；积分未知显示未知；无记录显示空态，不生成示例。
- 拟改文件：`internal/panel/assets/usage.js`、`internal/panel/index.html`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/usage?hours=0`；不新增接口。
- 验收方式：无记录显示空态；积分样本为 0 显示“未知”；文案不写“账单”；无示例流量。
- 是否需要决策：否。

### 批注 43：用量时间线可读
- 当前现状：`usage.js:23-33` 一次渲染 `by_account/by_model/by_realm/credit_by_account/credit_by_model` 五个区块，每块分页 15 行；首屏可能很长。
- 用户目标：首屏 Token 时间线 + 四个核心指标；维度详情分组/折叠，默认只显示前若干行；保留必要的积分观测但默认折叠。
- 拟改文件：`internal/panel/assets/usage.js`、`internal/panel/index.html`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/usage?hours=0`；不新增接口；分页仍在前端。
- 验收方式：首屏不出现超长列表；分组可展开；分页可用；手机无横向滚动。
- 决策状态：已定。保留但默认折叠。

### 批注 44：积分构成隐藏零余额包
- 当前现状：`packages.js:18-22` 的 `pkDetailGroups()` 过滤 `remain > 0`；`:28-36` 只对有正余额的包计入分段；渲染只显示 active 包。
- 用户目标：零余额包不显示；统计只汇总已知剩余积分；全部为 0 时显示空态；未知余额不计 0。
- 拟改文件：`internal/panel/assets/packages.js`、测试 `internal/panel/frontend_v02_test.mjs`。
- 前后端/API 影响：`GET /panel/api/packages`；不新增接口。
- 验收方式：`remain=0` 的包不出现；全 0 显示空态；未知余额不参与求和；分页仍正确。
- 是否需要决策：否。

### 批注 45：积分数字完整显示
- 当前现状：`packages.js:24-27` 的 `fmtCredits()` 用 `toLocaleString('zh-CN')`，积分完整显示；`format.js` 的 `fmtTok` 仍用于 Token，可能被误用到积分。
- 用户目标：积分构成页所有积分使用完整数字，不出现 k/M；Token 可继续缩写；未知显示“未知”。
- 拟改文件：`internal/panel/assets/packages.js`、`internal/panel/assets/format.js`（仅新增/确认积分格式化，不改 Token）。
- 前后端/API 影响：无。
- 验收方式：12500 显示 12,500；不出现 12.5k；未知显示“未知”；统计与明细一致。
- 是否需要决策：否。

### 批注 46：模型“上游声明”与“实测”
- 当前现状：`models.js:7-11` 的 `modelProbeLabel()` 已区分“上游声称/实测至少/实测上限/未测出”，并标 `tested_at` 与旧探测；`models.js:22` 把两者都放在“输出 Token”一栏。
- 用户目标：明确区分“上游声明”和“实测”；实测标注来源和时间；未知不显示为 0；旧探测有提示。
- 拟改文件：`internal/panel/assets/models.js`、`internal/panel/assets/model-policy.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/models`、`GET /panel/api/model_probes`；不新增接口。
- 验收方式：无探测显示“尚无实测”；旧探测标注；上游声明与实测不在同一文案混淆；未知显示未知。
- 是否需要决策：否。

### 批注 47：错误详情按需、按稳定 ID
- 当前现状：`logs.js:8` 与 `:75-...` 只在点击时 `GET request_logs?id=<id>`；列表不加载正文；`reqlog.FindArchive/FindRecent` 按稳定 ID 查找；`logs.js:170` 绑定详情。
- 用户目标：保持列表只加载摘要；点击才请求详情；关闭详情 cancel 在途请求并清空 DOM；404 显示“已清理”。
- 拟改文件：`internal/panel/assets/logs.js`、`internal/panel/assets/lifecycle.js`、`internal/panel/assets/styles.css`。
- 前后端/API 影响：`GET /panel/api/request_logs?id=<id>`；不改 `reqlog` 24 小时/容量/no_logs 语义。
- 验收方式：列表响应无详情正文；点击才发请求；关闭 abort；404 友好；重复打开无重复监听。
- 是否需要决策：否。

### 批注 48：错误分类保守
- 当前现状：`logs.js:11-34` 只按状态码/结果推断；`errorKind()` 把 429/402 归 `quota`，401/403 归 `auth`，408/504 归 `timeout`，409 归 `conflict`，5xx 归 `server`；注释明确没有原始错误正文。
- 用户目标：保留保守分类；详情说明“仅按状态码归类”；不臆造额度/限流原因；未知显示“请求错误”。
- 拟改文件：`internal/panel/assets/logs.js`、`internal/panel/index.html`（文案）、`internal/telemetry`（仅未来新增字段时）。
- 前后端/API 影响：沿用现有事件字段；新增错误正文涉及隐私与存储，需单独评审，不在本轮做。
- 验收方式：401/403 不显示“额度不足”；429/402 显示“额度或限流”并注明推断；未知显示“请求错误”；详情有口径说明。
- 决策状态：已定。不新增错误正文字段，保持脱敏与有界存储。


## 4. 目标信息架构与页面结构

### 4.1 一级导航（取消二级菜单）

| 顺序 | 页面 | 路由 | 主要内容 | 现有归属 |
|---|---|---|---|---|
| 1 | 概览 | `#overview` | 账号圆环、四项统计、昼夜组件、本机 API 单行摘要 | 已有 |
| 2 | 账号池 | `#accounts` | 紧凑账号卡、统计、稳定分页、就地出口绑定 | 已有 |
| 3 | 账号任务 | `#taskscenter` | 四项维护汇总、上次执行时间、失败灰红、按需详情 | 已有 |
| 4 | 账号出口 | `#egress` | 节点目录主体、订阅概览、导入、筛选、统一刷新、绑定管理 | 需重构 |
| 5 | 积分用量 | `#usage` | 本机观测说明、Token 时间线、核心指标、折叠维度 | 已有 |
| 6 | 积分构成 | `#packages` | 已知余额、到期分布、零余额隐藏、完整数字 | 已有 |
| 7 | 模型查看 | `#models` | 简化卡片、启用优先、禁用统一、缓存状态 | 需重构 |
| 8 | 错误记录 | `#logs` | 仅错误、简洁列表、按需详情、保守分类 | 已有 |
| 9 | 系统设置 | `#config` | 密码、启动动画、服务状态（不重复 API/订阅） | 需收敛 |

导航视觉：桌面固定贴左，内容区自适应；手机顶部紧凑横向导航，不放二级展开。分组标题如保留，只能是非交互视觉标签。

### 4.2 账号出口页布局

```
┌ 账号出口 ──────────────────────────────── 内核状态 ┐
│ 订阅概览：3 个订阅 · 2 启用 · 42 节点 · 缓存已过期 │
│ [导入订阅] [刷新节点] [查看订阅详情]               │
├───────────────────────────────────────────────────┤
│ 节点筛选：[全部订阅 ▾]                             │
│ ┌ 节点卡 ┐ ┌ 节点卡 ┐ ┌ 节点卡 ┐                  │
│ │ 名称   │ │ 名称   │ │ 名称   │                  │
│ │ 来源   │ │ 来源   │ │ 来源   │                  │
│ │ 42 ms  │ │ 未测试 │ │ 超时   │                  │
│ │ [使用] │ │ [使用] │ │ [使用] │                  │
│ └────────┘ └────────┘ └────────┘                  │
├ 流量/速率（一行小指标或折叠）─────────────────────┤
│ ↓ 1.2 GB  ↑ 340 MB   ↓ 2.1 MB/s  ↑ 0.4 MB/s       │
├ 绑定管理（折叠）──────────────────────────────────┤
│ 账号 A → 节点 X   账号 B → 未绑定                  │
└───────────────────────────────────────────────────┘
```

### 4.3 为什么当前出口页没有节点主体

- 产品演进顺序是先做“账号路由 + 节点弹窗”，再补订阅管理；订阅管理放在设置页。
- `index.html:101-109` 首屏固定为 `egress-top` 两张指标卡 + `egressAccounts`；`egress.js:52-58` 的 `renderAccounts()` 是主列表。
- 节点渲染 `renderNodes()` 只写 `#nodeList`，而 `#nodeList` 在 `nodeVeil` 弹窗内（`index.html:134`），所以只有打开弹窗才看得到节点。
- `loadEgress()` 会拉 `meta/nodes`，但结果只用于账号路由的延迟/绑定摘要，未渲染成主列表。这是布局归属问题，不是缺少接口。

## 5. 接口契约（只读/写入分离）

### 5.1 现有路由与权限

所有 `/panel/api/*` 走会话鉴权；写请求还要 Origin/CSRF 守卫。Meta 接口统一 `Cache-Control: no-store`，在 `internal/panel/panel.go:238-244` 注册。

| 方法 | 路径 | 用途 | 是否触达上游 | 备注 |
|---|---|---|---|---|
| `GET` | `/panel/api/overview` | 账号池统计与账号列表 | 否 | 不吃分页 |
| `GET` | `/panel/api/meta/status` | 内核状态 | 否 | 只读 |
| `GET` | `/panel/api/meta/nodes` | 节点 + 绑定 | 否 | 支持 `subscription_id` 本地筛选 |
| `GET` | `/panel/api/meta/nodes?subscription_id=<encoded>` | 单订阅节点 | 否 | 只过滤内存，不刷新上游 |
| `GET` | `/panel/api/meta/subscriptions` | 订阅摘要列表 | 否 | 默认脱敏 |
| `GET` | `/panel/api/meta/subscriptions?id=<id>&reveal=1` | 单订阅完整 URL | 否 | 显式 reveal |
| `POST` | `/panel/api/meta/subscriptions` | 导入/改名/启停/刷新/删除 | 导入/刷新会 | body 见下 |
| `GET` | `/panel/api/meta/tests` | 当前测试任务 | 否 | 只读 |
| `POST` | `/panel/api/meta/tests` | 启动/取消测速 | 是 | 唯一测速入口 |
| `POST` | `/panel/api/meta/accounts/{uid}/bind` | 账号绑定节点 | 是（应用配置） | 成功需回读 |
| `GET` | `/panel/api/meta/stats` | 内核流量/速率 | 否 | 采样值 |
| `GET` | `/panel/api/usage?hours=0` | 本机用量快照 | 否 | 全部历史 |
| `POST` | `/panel/api/usage/save` | 立即落盘 | 否 | 不等同刷新上游 |
| `GET` | `/panel/api/packages` | 逐账号积分包 | 是 | 逐账号查询，失败按账号标错 |
| `GET` | `/panel/api/models` | 模型声明 | 是（当前每次） | 计划改为缓存 |
| `GET` | `/panel/api/model_probes` | 模型实测 | 否 | 文件读取 |
| `GET/POST` | `/panel/api/model_policy` | 模型启停/展示覆盖 | 否 | 不改路由内核 |
| `GET` | `/panel/api/request_metrics` | 错误汇总 | 否 | 内存/归档统计 |
| `GET` | `/panel/api/request_logs?summary=1&limit=1000` | 错误摘要 | 否 | 不含正文 |
| `GET` | `/panel/api/request_logs?id=<id>` | 单条详情 | 否 | 稳定 ID，按需 |

### 5.2 订阅对象

```json
{
  "id": "sub-xxxx",
  "name": "主力节点",
  "enabled": true,
  "status": "ready",
  "node_count": 42,
  "bindings": 3,
  "created_at": "2026-10-01T10:00:00+08:00",
  "updated_at": "2026-10-20T09:00:00+08:00",
  "last_refresh_at": "2026-10-19T09:00:00+08:00",
  "last_error": "",
  "url_preview": "https://example.com/••••",
  "has_url": true
}
```

普通列表永远不含完整 `url`；`url_preview` 必须脱敏（`metacore/manager.go:350` 的 `subscriptionPreview`）。

### 5.3 导入/刷新/删除/绑定请求

```json
// 导入
{"url":"https://example.com/sub?token=...","name":"可选名称"}

// 刷新单订阅
{"action":"refresh","id":"sub-xxxx"}

// 启停
{"action":"toggle","id":"sub-xxxx","enabled":false}

// 改名
{"action":"rename","id":"sub-xxxx","name":"新名称"}

// 删除
{"action":"delete","id":"sub-xxxx"}

// 绑定
{"node":"node-id"}
```

- 导入/刷新/删除/绑定成功都必须回读；前端不得只信本地乐观状态。
- 删除有绑定返回 409（`ErrSubscriptionInUse`）；达到 provider 上限返回 4xx。
- 绑定失败保留旧绑定；回读不一致要报错，不显示成功。
- 所有写请求带 CSRF/Origin；前端不把 URL、节点凭证写 localStorage。

### 5.4 节点筛选契约

```http
GET /panel/api/meta/nodes?subscription_id=<urlencoded-id>
```

- 参数为空/缺失 = 全部订阅。
- 仅在内存 `Nodes()` 结果上过滤 `Provider` 并裁剪 `Bindings`（`meta.go:51-88`）。
- 不调用 `RefreshSubscription`、不启动 `/meta/tests`、不写配置。
- 响应仍是 `{demo,nodes,bindings,total}`；前端合并过滤外的旧绑定，避免账号卡丢失真实绑定。
- 切换筛选必须单飞：新请求覆盖旧请求，旧响应按代际丢弃；关闭弹窗 abort。

### 5.5 48 小时缓存契约

前端按 `last_refresh_at` 计算：

```text
age = now - last_refresh_at
expired = age >= 48h
```

- 只影响展示：订阅概览/节点区显示“缓存已过期”，旧节点仍可看、可绑定。
- 只在登录成功时刷新一次启用订阅；切页、打开弹窗、切换筛选都不刷新上游。
- 唯一刷新动作：用户点“刷新节点” → 对启用订阅逐个 `POST action=refresh` → 回读 `meta/nodes`。
- 刷新失败保留旧 provider 与 `last_error`；下次仍显示过期。
- 若由后端补字段，建议只读 `cache_age_seconds`/`cache_expired`，不新增调度器。
- 48 小时基准必须是 `last_refresh_at`（订阅成功刷新时间），不是节点测试时间，也不是页面读取时间。

## 6. 专项：到期 2928 天的根因与修复

### 6.1 完整链路

1. 上游积分包响应 `DeductionEndTime` 是 epoch 毫秒；`internal/upstream/client.go:1867-1873` 判断 `>0` 后直接 `time.UnixMilli()` 写 `EndTime`，同时 `ExpiresAt = p.DeductionEndTime`。
2. 缺失时回落到 `ExpiredTime`/`PackageEndTime`/`CycleEndTime` 字符串；`client.go:1881-1885` 用 `time.ParseInLocation("2006-01-02 15:04:05", ..., UTC+8)`，解析失败只留 `ExpiresAt=0`。
3. 前端 `packages.js:8-13` 优先用 `expires_at`，否则解析 `end_time`；`:34` 用 `Math.ceil((expiresAt-now)/86400000)` 得到天数。
4. `summarizeCreditDays()` 按天数分桶；`render()` 把天数直接写成“N 天内”。

### 6.1.1 毫秒与秒混用的真实后果

当前 `pkExpiryMs()` 先 `Number(expires_at)`，只要有限且大于 0 就当毫秒。如果上游把秒值写进 `expires_at`，会得到 1970 年附近而不是 2928 天；如果上游把毫秒值写进 `end_time`（字符串），`Date.parse('1750000000000')` 在部分浏览器会返回 `NaN` 或异常日期。2928 天更像“远未来日期”而不是单纯单位混用，因此不能用“统一乘 1000”这种拍脑袋修复。

### 6.2 候选根因与排除

| 候选 | 是否成立 | 依据 |
|---|---|---|
| 上游远期包（真实远未来日期） | 已核实成立 | 后端查询窗口 `365×101` 天，上游会返回远期包；`DeductionEndTime` 是真实毫秒时间戳，换算约 8 年 |
| 秒/毫秒混用 | 否 | 秒值当毫秒会落到 1970 附近，不会得到 2928 天 |
| 字符串解析失败 | 否 | 解析失败得到 `ExpiresAt=0`，显示“到期未知” |
| 前端无上限 | 确定 | `pkExpiryMs` 只判断 `>0`，`Math.ceil` 无上限，任何远未来值都原样显示 |

结论：**不是解析 bug，是真实远期数据叠加前端不做展示上限。** 修复只在前端展示层：超过 30 天一律显示“30 天内”；原始 `expires_at` 仍保留，供排查，不改成 0，不改内核查询窗口。

### 6.3 修复方案

- 前端 `pkExpiryMs` 计算天数后直接 `Math.min(30, days)` 封顶；不需要后端新增 `expiry_kind`，不改 `internal/upstream`，只保留原始 `expires_at` 供排查。
- 展示上限：30 天。`pkAccountSegments()` 计算 `days` 后统一 `Math.min(30, days)`；超过 30 天的包归入“30 天内”桶，不显示 2928。原始 `expires_at` 仍在 API 里，便于后台排查，但前端不再展示。
- 根因已核实：`upstream/client.go:1830` 的查询窗口是 `now.Add(365 * 101 * 24 * time.Hour)`，上游会返回远期包；2928 天是真实远期日期，不是解析错误。前端按 30 天上限展示即可，不需要改内核。
- `pkAccountSegments` 对无值/非法值返回 `days:null`，显示“未知”，不伪造 0；对远期值封顶 30 天，不单列“长期/异常”。
- 统计文案只区分“已知到期”和“未知”；不再单列“长期/异常到期”。
- 测试：2928 天、9999 年、秒/毫秒混用、空值、`0001-01-01`、正常 30 天六组用例。

### 6.4 已定项

- 展示上限 30 天（已定）：超过 30 天一律显示“30 天内”，不显示 2928，也不改成 0。
- 原始 `expires_at` 保留在 API 但不进列表；排查时由开发者在接口响应里查看。
- 不单列“长期有效/异常到期”分类，避免再造一层解释。

## 7. 专项：“未取得余额”的真实含义

- 当前链路：`panel.go:956-960` 调 `Upstream.CreditPackages(a)`；失败时只写 `Error`，不写 `Remain`。前端 `packages.js:41` 将 `error` 或 `remain` 非有限值计为 `unavailable`；`:54` 只对已知值求和。
- 因此“未取得余额”= 上游请求失败、账号未加载、响应字段缺失或无法解析；**不是余额 0**。
- 需要展示：失败账号数、原因摘要（不泄露 token）、重试入口；统计写“已知剩余积分”，旁边注明“未取得余额 N 个账号不计 0”。
- 不允许：把失败账号显示为 0、把未知计入总额、静默吞掉错误。
- 需要决策：是否允许单账号重试；建议允许，但限单账号、可取消、并发 ≤3。

## 8. 专项：模型拉取当前行为与缓存策略

### 8.1 当前行为

- `/panel/api/models`（`panel.go:480-525`）每次请求：
  - CN：取 `AvailableUIDsForRealm("cn")` 首个账号，调 `FetchModels`。
  - global：若 `GlobalEnabled`，取 global 首个账号，调 `FetchGlobalModelInfos`。
  - 两域都空才报 502/503；成功直接返回，不读 `dynamicModelsCache`。
- `/v1/models` 走 `server/model_catalog.go`：CN 侧 `dynamicModelsCache` 10 分钟 TTL、5 分钟失败冷却；global 侧 `upstream/global_models.go` 为 1 小时 TTL、5 分钟失败冷却（`global_models.go:64-67`）。
- 因此面板模型页每次进入都可能打上游，和网关缓存不一致。

### 8.2 目标缓存策略

- 面板复用网关缓存语义：CN 10 分钟 TTL、5 分钟失败冷却；global 沿用 1 小时 TTL、5 分钟失败冷却。
- `GET /panel/api/models` 返回增加 `cached_at`、`cache_expired`、`stale`；TTL 内不发上游。
- 失败保留旧缓存并标 `stale`，进入冷却；不把失败清空成空列表。
- 手动刷新：`POST /panel/api/models/refresh`，需 5 分钟冷却，避免连点打上游；刷新失败保留旧列表。
- 不改 `/v1/models` 行为、不改反代内核；只把缓存读取接口暴露给 panel。
- 落地位置：`internal/panel/panel.go` 的 `models` handler 增加进程内快照（互斥锁 + 过期时间 + 上次错误），按 `cn/global` 分键；不新增存储。
- 不复用 `/v1/models` 的 `cachedModelsSnapshot()` 作为面板数据源；那是反代错误路径的目录快照，面板需要自己的结构化条目缓存，避免与内核耦合。

### 8.3 验收

- 连续进入模型页 5 次，上游只拉 1 次；TTL 内无网络。
- 过期后才拉；失败保留旧列表并标 stale。
- 手动刷新有冷却；刷新失败不清空。
- `GET /v1/models` 行为与现状一致（回归测试）。

## 9. 专项：远程字体与 CSP 的实际障碍

### 9.1 现状事实

- `internal/panel/index.go:37-39` 的 CSP 为：
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`
- 没有 `font-src`，因此字体请求回落到 `default-src 'none'`，同源/远程字体都会被阻断。
- `style-src` 不含 `https://fonts.googleapis.com`，Google Fonts CSS 被阻断。
- `connect-src 'self'` 禁止前端 fetch 远程 CSS。
- `Cross-Origin-Resource-Policy: same-origin` 限制跨源资源。
- `frontend_v02_test.mjs:94` 明确断言 CSS 不含 `@import/@font-face/Google Fonts`；`security_test.go` 固化严格 CSP。
- `styles.css:9-11` 只有本地字体栈，没有真正加载 `Source Sans 3`/`Noto Sans SC`。

### 9.2 三种方案对比

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A 静态打包 | woff2 放 `assets/fonts/`，`@font-face` 同源，CSP 加 `font-src 'self'` | 无第三方请求、可离线、CSP 仍严格、登录不被阻塞 | 字体体积需子集化；需字体许可 | 采用 |
| B 远程白名单 | CSP 加 `style-src ... https://fonts.googleapis.com`、`font-src 'self' https://fonts.gstatic.com` | 实现快、字体全 | 第三方请求/隐私、CSP 放宽、离线失败、需改安全测试 | 不采用；与“本机工具”定位冲突 |
| C 同源代理 | 后端代理 Google Fonts 并缓存，CSP 仍 self | 无第三方直连 | 新增路由/缓存/许可/滥用面，复杂度最高 | 不采用；过度设计 |

最终字体选择（不要求用户先安装）：

- 英文/数字：`Source Sans 3`（SIL OFL，可静态打包），风格接近 Claude 的人文无衬线，字重 400/500/600。
- 中文：`Noto Sans SC`（SIL OFL），做常用字子集；若体积仍大，首屏只加载 400/500 两档，正文回退系统字体。
- 字体栈：`'Source Sans 3','Noto Sans SC','Microsoft YaHei UI','Segoe UI',sans-serif`；等宽仍用 `Cascadia Code/Consolas`。
- 加载策略：`@font-face` + `font-display: swap`；预加载只给 500 字重；字体失败不阻塞登录。
- 体积预算：英文 2 档 ≤ 120KB；中文子集 ≤ 1.2MB；超过预算改用系统字体并记录决策。

### 9.3 关键结论

- “字体直接可见”不等于“加一个 Google Fonts link”；当前会直接被 CSP 拦截。
- 采用方案 A 时，`font-src 'self'` 是唯一需要新增的 CSP 指令；`style-src` 不必放宽。
- 现有测试 `frontend_v02_test.mjs:94` 禁止 `@font-face`，实施时必须同步改成“允许同源 @font-face、仍禁止远程 Google Fonts”，并加反例。
- 已定：采用静态打包；字体体积超预算时只保留 400/500 两档并回退系统字体。

## 10. 专项：启动动画视觉重做

### 10.1 附件可借鉴的视觉元素（仅参考）

- SVG 流体拉幕（`path` 填充深色背景）。
- 五列错峰百叶（`shutter-columns`，`transform-origin: top center`）。
- 中轴裂变光闸（上下两半 + 1px accent seam）。
- 胶片 noise overlay（低透明度 data URI 噪声）。
- 中央单词轮播、底部超大计数器、1px 进度条。

### 10.2 不可直接照搬的部分

- 附件是独立演示页，含自己的脚本/时间线/全局事件；**不执行、不复制**。
- 不能把附件 `body{overflow:hidden}`、全屏 `position:fixed` 直接套到产品，否则会遮挡登录/工作台。
- 不能引入附件的外部字体/资源；动画必须本地、可销毁、减少动画可用。

### 10.3 目标实现约束

- 保留 `startStartupAnimation()` 的 `setStyle/setPhase/finish/destroy` 契约；最短播放 8000ms，最长硬上限 12000ms；数据提前返回不硬切。
- 视觉目标：流体拉幕 + 英文 AI 名称轮播 + 1px 进度条 + 阶段文案；百叶/光闸作为可选风格。默认风格实施时按完成度选定。
- `prefers-reduced-motion` 直接显示静态品牌与登录；`document.hidden` 暂停名称轮播。
- 销毁时清理所有 timer、rAF、监听、DOM；预览只在设置内播放一次，不写偏好。
- 动画不得阻塞登录：最短 8 秒、最长 12 秒硬退出，失败也能进工作台。

## 11. 专项：订阅完整 URL 明文展示边界

- 默认：`GET meta/subscriptions` 只返回 `url_preview`（脱敏）+ `has_url`，不返回完整 URL。
- 详情：只有用户点击“查看地址”才 `GET ...?id=<id>&reveal=1`；一次只取一个订阅。
- DOM：明文只存在弹窗节点；关闭弹窗立即清空 `textContent`，不留在 hidden DOM。
- 存储：不写 localStorage/sessionStorage/IndexedDB；不写前端日志；不放进 URL/hash。
- 复制：不提供复制按钮，避免误把含密钥 URL 带到剪贴板。
- 网络：不把完整 URL 放进埋点/错误上报；后端 `Cache-Control: no-store`。
- 关闭：弹窗关闭即清空明文，不写入任何持久化。

## 12. 专项：缓存/刷新与 48 小时

| 对象 | 当前缓存 | 刷新触发 | 48 小时语义 | 是否自动 |
|---|---|---|---|---|
| 订阅节点 | 后端持久化 provider + `last_refresh_at` | 登录时刷新一次；用户手动刷新/导入 | 超过 48h 标“缓存已过期”，仍用旧节点 | 登录一次；无后台定时 |
| 节点延迟 | `metacore` 内存 `m.nodes`，history ≤10 | 用户点测速 | 不适用；延迟不是订阅缓存 | 否 |
| 用量 | 后端 `usage.json`，前端无缓存 | 进入页面 GET | 不适用 | 否 |
| 模型 | 网关 10min/1h；面板当前无缓存 | 进入页面/手动刷新 | 不适用 | TTL 内不请求 |
| 积分包 | 无缓存，逐账号查上游 | 进入页面 | 不适用 | 否 |

关键约束：48 小时只做展示计算；不新增后台定时刷新。登录时执行一次启用订阅刷新（用户明确要求），由启动动画遮挡；切页不刷新。当前 `renderConfig` 已把 provider `interval=0`、`health-check.enable=false`，不要恢复内核自动调度。

## 13. 专项：响应式与可访问性

- 断点：1440（桌面）、1366（窄桌面）、390（手机）；现有 1250/980/700/380 可复用。
- 桌面：导航贴左，内容自适应；出口节点 `auto-fill minmax(176px,1fr)`；模型卡 `auto-fill minmax(300px,1fr)`；账号卡 `auto-fill minmax(280px,1fr)`。
- 平板：出口节点 2-3 列，模型卡 2 列，导航可收窄为图标+文字。
- 手机：悬浮胶囊导航；节点/模型/账号单列；弹窗全宽但留安全区；表格横向滚动只限容器。
- 可访问性：所有图标按钮有 `aria-label`；弹窗 `role=dialog`/`aria-modal`/焦点陷阱/Esc；状态不只靠颜色；`prefers-reduced-motion` 关闭动画；键盘可达。
- 禁止：`overflow-x:hidden` 掩盖真实溢出；固定高度裁切内容；用 `div` 模拟按钮。

### 13.5 渲染性能预算（可测门槛）

| 指标 | 桌面 | 移动端 | 测量方式 |
|---|---|---|---|
| 常驻动画合成层 | ≤ 3 层（1 光场 + 1 可选细流 + 1 玻璃高光） | ≤ 1 层（光场） | DevTools Layers 面板计数 |
| 常驻 `backdrop-filter` 元素 | ≤ 6 个可见（导航 1 + 面板 2-4 + 弹窗 1） | ≤ 4 个 | DOM 查询 `.glass` 可见数 |
| 单次 blur 半径 | ≤ 24px | ≤ 12px | CSS 变量 `--glass-blur` |
| 动画帧率 | 目标 60fps，最低 50fps | 目标 60fps，最低 30fps | DevTools Performance 录制 10s |
| 主线程长任务 | 无 > 50ms（动画期间） | 无 > 100ms | Performance 面板 |
| 隐藏页 | rAF/interval 全部停 | 同左 | `document.hidden=true` 后 5s 计数为 0 |
| 切页内存 | 20 次切页后堆增长 < 5MB | 同左 | Memory 快照对比 |

- 连续 3 秒帧耗时 > 20ms：细流层降到 20fps；再持续 3 秒则停用细流，只留 CSS 光场。
- `prefers-reduced-motion: reduce`：常驻流动、玻璃高光漂移、圆环描边、昼夜扩散全部改为即时切换；不启动 rAF。
- 移动端（`max-width:700px` 或 `navigator.hardwareConcurrency ≤ 4`）：默认不创建 Canvas 细流；`--glass-blur` 降到 12px。
- 低端兜底：不支持 `backdrop-filter` 时用不透明表面色 `--glass-fill-strong`，不加滤镜。

## 14. 专项：内存、并发与生命周期

### 14.1 现状

- `lifecycle.js`：`visibleInterval` 跳过隐藏/未登录/重叠；`onViewHidden` 在视图隐藏时清理；`pagehide` 永久清理；`api.js` 的 `cancelReads()` 中止在途 GET。
- `egress.js`：打开弹窗只 GET；测速才 POST；轮询 1.5s，30 分钟上限；关闭/离开视图 abort + 清 interval + 代际丢弃迟到响应。
- `reqlog`：已完成流式逐行读取/清理，24 小时、1000 条、16 MiB、单条 8 KiB、`no_logs` 语义不变。
- `usage`：40 万桶上限；`SnapshotWindow` 在锁内复制后 marshal，存在峰值风险，但不在本轮 UI 范围。
- `models`：计划缓存，避免每次上游。
- `packages`：逐账号并发上限 3；结果一次性返回，账号多时响应体偏大。

### 14.2 资源/并发风险清单

| 风险 | 位置 | 影响 | 缓解 |
|---|---|---|---|
| 打开弹窗自动测速 | `egress.js` 历史路径 | 上游压力/隐私 | 已修为只 GET；测试锁定 |
| 切筛选发 POST | `egress.js` | 意外测速 | 已修为只 GET；测试锁定 |
| 关闭弹窗后轮询继续 | `egress.js` | 定时器/请求泄漏 | `closeNodeModal` abort + clear；测试锁定 |
| 迟到响应覆盖新筛选 | `applyNodeFilter` | 显示错节点 | 代际 `filterGeneration`；测试锁定 |
| 登录/切页触发订阅刷新 | `router.js`/`egress.js` | 上游请求 | 登录只刷新一次；切页不刷新；48h 只标记 |
| 模型页每次打上游 | `panel.go:480-525` | 上游限流/延迟 | 复用 10min/1h 缓存 + 负缓存 |
| 积分包全量响应 | `panel.go:918-973` | 账号多时内存/响应大 | 并发 3；未来分页/流式 |
| 用量快照峰值 | `usage.SnapshotWindow` | 40 万桶时内存峰值 | 单独批次优化；本轮只做前端缓存 |
| 错误归档整文件读取 | 已改流式 | 已缓解 | 保持 24h/容量/no_logs |
| 字体大文件 | 静态打包 | 首屏体积 | 子集化 woff2 + `font-display: swap` |
| 隐藏页面动画 | CSS 常驻 | CPU/GPU | `visibilitychange` 暂停；减少动画 |
| 弹窗重复绑定监听 | 各 modal | 重复请求 | 绑定一次/清理时移除 |
| 订阅 URL 残留 | 详情弹窗 | 密钥泄露 | 关闭清空；不写存储 |
| 远程字体放宽 CSP | 方案 B | 攻击面/隐私 | 默认方案 A；B 需决策 |

### 14.3 生命周期验收

- 打开/关闭弹窗 20 次：interval 数回到 0，DOM 不累积，监听不重复。
- 切页 20 次：无残留请求，无增长定时器。
- 页面隐藏：动画暂停、轮询停止、在途 GET abort。
- `pagehide`：所有 cleanup 只执行一次；`pageshow` 恢复不重复初始化。

## 15. 液态玻璃设计系统（v5 新增，已冻结）

### 15.1 设计目标

当前页面只做到“半透明卡片 + 模糊”，视觉上仍是普通管理后台。目标是把全站统一成克制的液态玻璃语言：深色底上有低饱和暖色光场，玻璃层有真实的厚度、边缘高光和内折射，信息密度下降，留白增加，但必要数据仍在一屏内可读。

三个硬标准：

- 任何卡片不能只靠 `background: rgba(...)` 和 `backdrop-filter: blur(...)` 冒充玻璃；必须有边缘线、内高光、外阴影三层。
- 高光只能服务于层次，不能变成大面积渐变或“霓虹灯”；正文区域保持低对比、耐看。
- 同一页面最多两种玻璃层级：工作面板与浮层。不要每个小卡片都单独加 blur，移动端按层降级。

### 15.2 设计 token（建议值，实施时以 `:root` 冻结）

```css
:root{
  /* 背景：深暖灰，不用纯黑 */
  --bg-base:#121014;
  --bg-deep:#0c0b0e;
  --bg-lift:#1a171c;

  /* 光场：低饱和暖色，只做背景，不进正文 */
  --glow-warm:rgba(214,138,102,.20);
  --glow-cool:rgba(110,146,170,.12);

  /* 玻璃：三层结构 */
  --glass-fill:rgba(32,28,34,.52);
  --glass-fill-strong:rgba(38,33,40,.66);
  --glass-line:rgba(255,238,226,.14);
  --glass-line-soft:rgba(255,238,226,.07);
  --glass-inner:inset 0 1px 0 rgba(255,246,238,.10);
  --glass-outer:0 24px 64px rgba(0,0,0,.36);
  --glass-blur:22px;
  --glass-saturate:135%;

  /* 文字：正文不用纯白，降低刺眼 */
  --ink:#eee7df;
  --ink-2:#bdb3a9;
  --ink-3:#8e847a;

  /* 强调：暖陶土色，只用于交互与关键数字 */
  --accent:#d98a68;
  --accent-soft:rgba(217,138,104,.14);

  /* 语义：低饱和，避免“中转站红黄绿” */
  --ok:#86b892;
  --warn:#c9ab72;
  --bad:#c47a72;
}
:root[data-theme="light"]{
  --bg-base:#efeae2;
  --bg-deep:#e6e0d7;
  --bg-lift:#f6f2ea;
  --glass-fill:rgba(255,252,246,.58);
  --glass-fill-strong:rgba(255,253,248,.74);
  --glass-line:rgba(60,45,34,.12);
  --glass-line-soft:rgba(60,45,34,.06);
  --glass-inner:inset 0 1px 0 rgba(255,255,255,.72);
  --glass-outer:0 20px 50px rgba(74,54,36,.10);
  --ink:#2b2621;
  --ink-2:#574f46;
  --ink-3:#7b7165;
  --accent:#a9553a;
  --ok:#37734a;
  --warn:#7d5f22;
  --bad:#9d4038;
}
```

### 15.3 玻璃层实现规范

```css
.glass-surface{
  position:relative;
  background:linear-gradient(180deg,var(--glass-fill-strong),var(--glass-fill));
  border:1px solid var(--glass-line);
  box-shadow:var(--glass-inner),var(--glass-outer);
  backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border-radius:24px;
}
.glass-surface::before{
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:
    radial-gradient(120% 60% at 18% 0%,rgba(255,255,255,.16),transparent 58%),
    radial-gradient(80% 40% at 82% 100%,rgba(214,138,102,.10),transparent 62%);
  opacity:.9;
}
.glass-surface::after{
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  border:1px solid transparent;
  background:linear-gradient(180deg,rgba(255,255,255,.18),transparent 26%) border-box;
  -webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
}
```

约束：

- `::before` 负责大面积柔光，`::after` 负责 1px 顶缘高光；两者都必须 `pointer-events:none`。
- 只有直接承载内容的容器用 `backdrop-filter`；嵌套小标签不再重复模糊。
- 滚动容器内不要放大面积模糊；移动端把 `--glass-blur` 降到 10-12px，或对非主面板改为纯色半透明。
- 文字不得落在强高光带上；高光透明度上限 0.16。

### 15.4 页面层级与留白

- 桌面采用悬浮导航：导航玻璃条距视口左/上各 16-20px，内容区从其右侧开始；页面最大内容宽度 1440px。
- 主区块垂直间距 28px，卡片内边距 24px，紧凑卡片 16px；不要用 `gap: 8px` 把功能硬挤在一起。
- 页面标题只留一行主标题；删除“YOUR PRIVATE WORKSPACE”“SETTINGS / ESSENTIALS”“01 / PREFERENCES”这类装饰性眉标题。
- 解释性小字只保留会影响操作的（风险、缓存时间、失败原因）；其余删除，不把“说明文档”塞进界面。
- 概览、出口、模型页使用非对称栅格；不要所有页面都做成等宽卡片矩阵。

### 15.5 动效语言

- 进入：透明度 0→1、`translateY(8px)→0`，240-360ms，`cubic-bezier(.22,.61,.36,1)`；同一页面所有区块最多 40ms 错峰。
- 悬停：只改边框色和背景亮度，位移不超过 1px；禁止缩放整卡。
- 数值变化：数字用 180ms 颜色过渡，不做滚动计数。
- 刷新中：按钮边框与文字同色高亮，结束后 400-600ms 平滑回落；不改按钮文案。
- `prefers-reduced-motion: reduce` 时所有位移、旋转、视差、背景流动停止，只保留即时状态切换。

## 16. 客户端动态背景与液态高光（v5 新增，已实现）

### 16.1 渲染边界

动画全部在浏览器执行，服务器只返回静态 HTML/CSS/JS 与数据接口：

- 不在 Go 后端生成动画帧、SVG 路径或逐帧 JSON。
- 不为动画新增轮询接口；动画不得触发任何 API 请求。
- 不使用服务端渲染的定时任务、WebSocket 推帧或视频流。
- 若浏览器不支持 `backdrop-filter` 或 Canvas，退化为静态渐变，不影响功能。

### 16.2 推荐实现：CSS 光场 + Canvas 细流，二选一按页面

| 层 | 技术 | 用途 | 预算 |
|---|---|---|---|
| 底色层 | CSS 固定渐变 | 深暖灰底，永不重绘 | 0 |
| 光场层 | 2-3 个 CSS 径向渐变，`transform` 缓慢漂移 | 大面积呼吸感 | 30-48s 循环，仅合成层 |
| 细流层 | Canvas 2D，低密度粒子/流线 | 底部液态流动 | 桌面 ≤ 60 个粒子，30fps 上限 |
| 玻璃高光 | CSS 伪元素 + 极慢 `transform` | 卡片顶缘微光 | 只改 `transform/opacity` |

选择原则：

- 首选纯 CSS 光场，稳定、零脚本、零内存增长。
- 只有底部“液态流动”需要更细腻时才加 Canvas；Canvas 尺寸按 `devicePixelRatio` 上限 2 设置，窗口变化时重建，页面隐藏时停帧。
- 禁止同时在每个卡片上跑独立 Canvas；全站最多一个背景 Canvas。

### 16.3 生命周期与性能预算

```js
// 伪代码，实施时放 internal/panel/assets/ambient.js
let raf = 0, running = false;
function frame(t){ if(!running) return; draw(t); raf = requestAnimationFrame(frame); }
function start(){ if(running || document.hidden) return; running = true; raf = requestAnimationFrame(frame); }
function stop(){ running = false; cancelAnimationFrame(raf); }
document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', syncMotion);
```

必须满足：

- `document.hidden` 时 `cancelAnimationFrame`，恢复时重新启动，不能空转。
- 切页不重建背景；背景属于 shell，不属于某个 view。
- Canvas 每帧只做位置更新和一次 `drawImage/clearRect`，不创建新对象、不读布局、不写 DOM。
- 帧率上限 30fps；连续 3 秒帧耗时超过 20ms 自动降到 20fps，再超则停用细流层。
- 移动端默认关闭 Canvas 细流，只保留 CSS 光场；`prefers-reduced-motion` 全部关闭。
- 不用 `filter: blur()` 跑动画；大 blur 只在静态层，避免 GPU 持续高负载。
- 禁止 `setInterval` 驱动逐帧动画；只用 `requestAnimationFrame`。

### 16.4 与液态玻璃的叠层顺序

```text
z-index 0   固定底色渐变
z-index 1   光场层（CSS，pointer-events:none）
z-index 2   Canvas 细流（可选，pointer-events:none）
z-index 3   页面内容与玻璃面板
z-index 60  启动动画
z-index 80  弹窗/登录遮罩
```

玻璃面板必须叠在背景之上，不能把背景画进卡片内部；卡片的“流动感”来自背景透出与顶缘高光，而不是卡片自己跑动画。

### 16.5 渲染技术边界（硬约束）

| 用途 | 允许 | 禁止 |
|---|---|---|
| 背景光场 | CSS 径向渐变 + `transform` 漂移 | 逐帧改 `background-position`、逐帧改 `filter` |
| 底部液态流动 | 单个 Canvas 2D（DPR ≤ 2，≤60 粒子，≤30fps） | 每卡片一个 Canvas、`toDataURL` 逐帧、WebGL 大纹理 |
| 启动动画 | SVG/CSS 时间线（登录阶段独占，退出即销毁） | 工作台常驻背景复用启动动画的 SVG 全屏时间线 |
| 昼夜扩散 | CSS `clip-path`/遮罩层 500ms | 全页 `opacity` 硬切、主题色逐帧内联写样式 |
| 玻璃高光 | 伪元素 + 极慢 `transform` | 大面积 `filter: blur()` 动画、`box-shadow` 逐帧重算 |
| 第三方库 | 无（零新增依赖） | 引入 GSAP/Lottie/Three.js 等动画库 |

- 所有动画必须在客户端执行；Go 后端不生成帧、不推送帧、不为动画新增接口（服务器零额外 CPU/内存）。
- 页面隐藏、弹窗关闭、路由切走三种情况都必须停帧；恢复时不重建对象，只重启 rAF。
- 任何一批若新增 ≥ 1 个常驻 rAF 循环，必须在提交说明里给出 §13.5 的实测数据。

## 17. 页面级视觉稿（文字版，实施按此对齐）

### 17.1 概览
- 顶部不再有装饰性眉标题，只保留“概览”与右侧内核状态小点。
- 主栅格 7:5：左侧账号池面板，右侧纵向叠昼夜组件与本机 API。
- 账号池面板：圆环在左、四项数据在右；每行“标签—细进度条—数字”，数字右对齐。圆环用细线分段，中心只显示总数与“账号”。
- 圆环进入时从 0 描边到目标值，320ms；数据行错峰 40ms 淡入；减少动画下直接显示。
- 昼夜组件占 1 个方形模块；点击时从太阳/月亮的圆点向外扩散切换明暗，500ms 内完成，不改整页硬切。
- 本机 API 只保留 Base URL 与两种接口名；删除“仅限本机 · 无需 API key”。

### 17.2 导航
- 桌面：悬浮导航栏。左侧固定悬浮玻璃条，宽 208-224px，四周留 16-20px 间隙，圆角 24px；不是贴边整列面板。玻璃只做一层，不平铺 blur。
- 当前页只高亮文字与左侧 2px 竖线，不做整行底色、不做整块边框。
- 已核实冲突点：`styles.css:68` 的 `.nav li > a.on` 仍带 `background: color-mix(...)`，`styles.css:69` 才有左侧 2px 线。实施时必须删除 `.on` 的背景与任何 `outline`/`box-shadow` 高亮，只保留文字色 + 左侧短线；`:focus-visible` 另用细描边，不能与“选中态”混用。
- 一级项平铺，名称固定为：概览、账号池、账号任务、账号出口、积分用量、积分构成、模型查看、错误记录、系统设置。取消“账号任务/积分用量”二级分组。
- 手机：悬浮胶囊导航，横向滚动；不出现二级展开；滚动时保持悬浮，不遮内容。

### 17.3 账号池与任务
- 账号卡只留：昵称、状态、余额、当前出口、禁用/删除；UID 与原因收进详情。
- 卡片高度控制在 132px 内；删除请求、Token、延迟/速率三项。
- 任务卡显示：任务名、上次执行时间、上次结果、失败数。无失败时失败数为灰色，不显示红色 0。
- 按钮文案固定“全部执行”，执行中只高亮边框，不改字。

### 17.4 账号出口
- 顶部一条订阅概览：订阅数、启用数、节点数、缓存状态；右侧“导入订阅”“查看订阅”“刷新节点”。
- 主体左侧 2/3 节点网格，右侧 1/3 订阅摘要与缓存说明；不再放账号路由大列表。
- 节点卡是小方框：名称、来源短标签、缓存延迟；点击即选中/绑定，不设“绑定此节点”大按钮。
- 节点卡按来源分组时用轻分隔，不套第二层玻璃。
- 订阅详情弹窗：名称、完整 URL、节点数、最近刷新、启用状态；关闭即清空 URL。
- 账户绑定入口移到节点卡点击后的紧凑操作条，不占首屏。

### 17.5 积分与模型
- 积分页先显示已知余额与到期分布；删除说明性小字；零余额包不渲染；积分数字完整显示。
- 到期展示统一封顶 30 天：超过 30 天显示“30 天内”，不显示 2928，也不改成 0。
- 模型卡只留：名称、ID、上下文、倍率、能力标签、推理档位、输出 Token。
- 推理档位横向按 `off → low → medium → high → xhigh → max → ultra` 排列。
- 禁用操作统一到卡片右上角一个开关；禁用后刷新排到最后。
- 删除“上下文展示”按钮与弹窗，不删除后端能力。

### 17.6 错误记录与设置
- 错误页只留错误列表：时间、模型、状态、简短原因；点击行才请求详情。
- 删除运行日志、成功率、平均耗时、归档说明。
- 设置页只留：管理密码、启动动画风格、昼夜/主题入口、服务状态。
- 订阅管理移出设置；本机 API 信息只在概览保留一处。

## 18. 登录、启动动画与首屏数据衔接

### 18.1 事实与约束

- 后端会话已是 24 小时 HttpOnly Cookie（`internal/localauth/auth.go:28-29`），本轮不改有效期、不改鉴权边界。
- 现状是登录成功后 `router.js:114-167` 才启动 bootstrap 与启动动画；失败会进入工作台但数据可能为空。
- 启动动画已有四种风格；本轮调整为“最短 8 秒、最长 12 秒”：主视觉必须完整播放一轮，数据提前返回也不硬切。
- 登录时刷新一次启用订阅并读取节点，不测速；这是用户明确要求，刷新失败不阻塞进入。
- 登录页当前仍显示“首次使用初始密码 123456”和“账号凭据仅由本机后端管理”，用户要求删除。

### 18.2 推荐流程

```text
打开 /panel/
  -> 先读 /auth/session
     已登录：直接进入“启动动画 + 同步”
     未登录：显示密码页（玻璃卡片，无说明小字）
  -> 提交密码成功
     记录会话（Cookie 24h，不在前端存 token）
     立即进入启动动画；后台并行执行：
       a. bootstrap 账号与余额
       b. 订阅列表读取 + 启用订阅刷新一次
       c. 节点缓存读取（不测速）
  -> 动画最短时长
     动画至少播放完一轮完整主视觉，不因数据提前返回而硬切
     数据在 8-12s 内就绪：动画自然收束，进入概览
     数据超时：12s 硬上限，动画退场，页面显示已有缓存/空态
     某个同步失败：不弹全局错误，页面内小状态提示，允许进入
```

### 18.3 视觉衔接

- 密码卡片与启动动画共用同一背景与玻璃层，避免“登录页是白底、进去是深色”的割裂。
- 登录页只留：品牌标记、一句标题、密码输入、进入按钮；删除所有解释性小字与“初始密码”提示。
- 启动动画使用英文 AI 名称逐字切换；字体与全站一致，不额外引入装饰字体。
- 动画退场用 360ms 的透明度与轻微上移，不整页闪白；概览内容在动画退场前已完成布局，避免跳动。
- 动画期间禁止用户点击导航；`inert` 保持在 shell 上，结束后移除。
- 动画最短完整一轮：即使 bootstrap 在 2 秒内完成，也要播放到 8 秒；超过 12 秒立即退场。
- 减少动画：直接显示登录/概览，不播放名称轮播；但仍执行同步，只是不遮挡。

### 18.3.1 刷新职责分工（防止前后端互相“以为对方做了”）

登录链路会跨三个文件，必须按下面的边界实现，否则会出现“前端以为后端刷新了、后端以为前端触发了”的空转：

| 环节 | 归属 | 具体职责 | 不做什么 |
|---|---|---|---|
| 会话判定 | `assets/auth.js`（批次 7） | 提交密码、拿到 24h Cookie、派发 `panel:authenticated` | 不直接调订阅/账号接口 |
| 启动编排 | `assets/router.js`（批次 7） | 启动动画与 bootstrap 并行；动画最短 8s/最长 12s；结束后再进入首屏 | 不自己拼订阅请求体 |
| 账号同步 | `assets/router.js` → `POST /panel/api/session/bootstrap` + `GET /panel/api/session/bootstrap/status` | 只同步账号与余额，不涉及节点 | 不测速 |
| 订阅刷新 | `assets/egress.js` 导出的 `refreshSubscriptionsOnce()`（批次 3/4 实现），由 `router.js` 在登录时调用一次 | 对启用订阅逐个 `POST meta/subscriptions {action:"refresh"}`，再 `GET meta/nodes` | 不发 `POST meta/tests`；失败不抛到全局 |
| 节点测速 | `assets/egress.js` 的 `startNodeTests()` | 只有用户点击才 `POST meta/tests` | 登录时绝不调用 |

对应契约：

```js
// egress.js 新增导出，批次 3 定义、批次 4 完善
export async function refreshSubscriptionsOnce({ signal, timeoutMs = 8000 }) { ... }
// 返回 { ok, refreshed, failed: [{id, error}], nodes }，永不 throw
```

- `router.js` 调用时必须包 `try/catch`，并且与动画共用同一个 abort 信号；动画退场即 abort，不等待迟到响应。
- 登录刷新与用户点“刷新节点”共用同一实现，区别只是前者不显示按钮高亮。
- 若批次 3 尚未合并，`router.js` 只能用可选动态导入 `import('./egress.js').then(m => m.refreshSubscriptionsOnce?.(...))`，不得复制一份刷新逻辑。

### 18.3.2 后端能力事实：没有“刷新全部订阅”接口

已核实 `internal/panel/meta.go:127-188` 只支持 `toggle`/`rename`/`refresh`/`delete`，其中 `refresh` 必须带单个 `id`，最终调用 `metacore.Subscriptions.RefreshSubscription(ctx, id)`（`subscriptions.go:364`）。因此：

- 登录同步只能在前端串行遍历启用订阅，逐个 `POST {"action":"refresh","id":...}`；不要假设存在批量接口。
- 串行而非并发：每条刷新都会改 provider 配置并可能写状态文件，并发会扩大锁竞争；且订阅通常 1-4 条，串行耗时可接受。
- 每条设置独立超时（建议 4s），全部总预算不超过动画上限 12s；超时或失败的那一条只记录，不中断其余订阅。
- 失败条目不弹出全局对话框，只在出口页订阅概览留一条“N 个订阅刷新失败”的静态提示，刷新成功后自动消失。
- 若将来订阅数量显著增长，再评估新增 `POST /panel/api/meta/refresh` 批量接口；本轮不新增，避免动后端锁与状态写入顺序。

### 18.3.3 顶栏“刷新”按钮的确切语义

已核实 `router.js:96-113`：顶栏刷新只调 `POST /panel/api/balance_all`，再 `loadOverview(true)`；`internal/panel/panel.go` 的 `balanceAll` 同步调用 `Scheduler.RunBalanceRefreshNow()` 并等全部账号完成才返回（`scheduler.go:626` 内部 `wg.Wait()`）。因此：

- 该按钮只刷新账号余额/积分与账号状态，**不刷新订阅、不刷新节点、不测速、不拉模型**。
- 因为接口是同步阻塞的，按钮高亮可以准确表示“真的在跑”；不需要额外轮询。
- 高亮样式：边框与文字同时变色（不做整块填充），结束后 400-600ms 过渡回落；期间保持原文字，加 `aria-busy="true"`、禁用重复点击。
- 若账号很多导致耗时较长，按钮内不插入转圈图标、不改文案，只用颜色与 `aria-busy` 表达状态，避免布局跳动。
- 出口页的“刷新节点”是另一个按钮，两者不能合并成一个“刷新”，否则会出现“点一次偷偷打上游两次”的问题。

### 18.4 同步范围

- 登录后做：账号列表/余额、能力、偏好、概览统计、订阅列表读取、启用订阅刷新一次、节点缓存读取。
- 不做：节点延迟测速、模型上游拉取、积分逐账号查询。
- 订阅刷新只执行一次，失败保留旧缓存；不注册后台定时刷新。
- 出口页、模型页、积分页进入时优先读缓存/已有数据；用户手动刷新才触达上游。
- 若同步失败：不阻塞进入；对应页面显示“读取失败，可重试”，不弹全局失败对话框。

## 19. 我不同意或需要修正的方案

以下不是“用户说什么就抄什么”，而是基于当前代码和维护成本给出的判断：

1. **不能只改 CSS 就叫液态玻璃。** 现有 `.glass` 只是半透明 + blur，卡片之间没有层级；必须先在批次 0 冻结三层玻璃 token。目标是尽量接近真实液态玻璃：边缘折射、顶缘高光、内阴影、低饱和光场；但不追求物理级仿真，避免 GPU 过载。
2. **动画保留，但不能每张卡片各自跑 Canvas。** 背景流动与玻璃高光必须做；全站只保留一个背景 Canvas，卡片动效走 CSS 合成层，移动端自动降级。
3. **订阅刷新改为登录时执行一次，但必须被启动动画遮挡。** 这是你明确要求；实现上只在登录成功后的 bootstrap 阶段跑一次，失败保留旧缓存，切页与后台不重复触发。
4. **2928 天按你的要求封顶 30 天展示。** 已核实根因是后端查询窗口 365×101 天，上游返回远期包；不改成 0，也不改内核，只在前端统一 `min(30, days)`。
5. **不建议删除模型拉取接口来“简化页面”。** 用户后续要更新模型；应保留拉取能力，改成缓存 + 手动刷新，而不是把功能删掉。
6. **不采用远程 Google Fonts。** 已定静态打包字体：当前 CSP 严格、产品强调本机，静态打包同时满足“打开即见字体”和“无第三方请求”；远程方案不再作为备选。
7. **不建议继续保留二级菜单作为“视觉分组”。** 用户已明确不要二级菜单；分组标题也不应可点击或展开，直接平铺一级项。
8. **不建议为了“高级感”隐藏必要数据。** 余额、状态、出口、错误原因必须可见；删的是解释性小字和重复信息，不是关键数字。

## 20. 安全分类

| 类别 | 现有控制 | UI 重构要求 | 不要做 |
|---|---|---|---|
| 鉴权 | 会话 Cookie、登录接口 | 新增页面/弹窗仍走同一会话 | 不在前端伪造已登录 |
| CSRF/Origin | 写请求守卫 | 所有 POST 沿用 | 不加免校验的本地接口 |
| XSS | `esc()` 文本/属性双转义、CSP `script-src 'self'` | 所有拼接 HTML 继续用 `esc` | 不用 `innerHTML` 注入未转义 URL/名称 |
| 点击劫持 | `X-Frame-Options: DENY`、`frame-ancestors 'none'` | 不变 | 不放宽 iframe |
| 订阅密钥 | 列表脱敏、reveal 显式、`no-store` | 详情关闭清空；不写日志/存储 | 不在列表/URL hash 放完整 URL |
| 节点凭证 | 后端保存，前端只读节点 ID/名称 | 不新增导出按钮 | 不把配置写入 localStorage |
| 日志隐私 | `reqlog` 不写提示词/响应/Authorization；摘要脱敏 | 错误详情按需；分类保守 | 不加错误正文（除非单独评审） |
| CSP | 严格白名单、无 `*` | 字体只加 `font-src 'self'`（方案 A） | 不用 `unsafe-eval`/任意 https |
| SSRF | 订阅 URL 只允许公网 HTTPS 443（`metacore/subscriptions.go:20-26`） | 导入继续校验 | 不放开 http/内网/任意端口 |
| 资源上限 | provider 16、节点 1000、64 MiB、绑定 256；reqlog 有界 | UI 不写死两条；超限明确报错 | 不做无界缓存/全量轮询 |
| 账号删除 | 现有确认 + 后端接口 | 保持二次确认 | 不做“一键清空”无确认 |
| 代理绑定 | 按账号独立，失败回读 | 单击即绑定 + 回读校验 + 失败提示 | 不静默改全局代理/TUN；不做确认弹窗 |

## 21. 最小修改文件清单

### 21.1 前端（仅 UI/交互，不含本轮代码改动）

| 文件 | 用途 | 负责批次 |
|---|---|---|
| `internal/panel/index.html` | 一级导航、概览、出口页节点主体、设置收敛、登录文案、段落锚点 | 0 建骨架；1/3/6 各改自己段 |
| `internal/panel/assets/styles.css` | 液态玻璃 token、导航、卡片、灰红、节点卡、响应式、字体、性能降级 | 0 定分区；1/3/6/7 各区段 |
| `internal/panel/assets/ambient.js`（新增） | 客户端背景光场/细流生命周期与性能降级 | 0 |
| `internal/panel/assets/overview.js` | 圆环与细进度条、昼夜扩散、删除解释小字 | 1 |
| `internal/panel/assets/router.js` | 页面标题映射；登录后 bootstrap 编排与动画时长 | 1（标题）/ 7（bootstrap） |
| `internal/panel/assets/account-rows.js`、`account-table.js` | 删除请求/Token/延迟、缩短卡片、出口入口改名 | 2 |
| `internal/panel/assets/tasks.js` | 上次执行时间、灰红语义、按钮文字不变、详情清理 | 2 |
| `internal/panel/assets/egress.js` | 节点主体、订阅概览/导入/详情、筛选、`refreshSubscriptionsOnce()`、生命周期 | 3 → 4（串行） |
| `internal/panel/assets/packages.js` | 30 天封顶、未知余额、零余额隐藏、完整数字 | 5 |
| `internal/panel/assets/models.js` / `model-policy.js` | 卡片简化、禁用开关统一/置底、缓存状态、手动刷新 | 5 |
| `internal/panel/assets/usage.js` | 预加载缓存、折叠维度、删除说明小字 | 6 |
| `internal/panel/assets/logs.js` | 仅错误、简洁列表、按需详情、保守分类 | 6 |
| `internal/panel/assets/config.js` | 移除订阅/API 重复块、保留密码/动画/服务状态 | 6 |
| `internal/panel/assets/auth.js` | 登录页交互、会话进入、删除说明小字 | 7 |
| `internal/panel/assets/startup-animation.js` | 动画视觉重做、最短 8s/最长 12s、销毁契约 | 7 |
| `internal/panel/assets/animation-settings.js`、`preferences.js` | 动画风格选择与偏好持久化 | 7 |
| `internal/panel/assets/fonts/`（新增） | 静态 woff2 字体 + `OFL.txt`；子集化 | 7 |
| `internal/panel/assets/common.js` | toast/格式化辅助 | 共享，仅必要改动 |
| `internal/panel/assets/lifecycle.js` | 统一暂停/销毁契约 | 0 定义接口；7 接入动画 |

### 21.2 后端（仅必要，不改内核）

| 文件 | 改动 | 风险 |
|---|---|---|
| `internal/maintenance/service.go` | 增加 `last_run_at/last_finished_at/last_result`（可选内存） | 低；需测试 |
| `internal/panel/maintenance.go` | 透传新字段 | 低 |
| `internal/panel/panel.go` | `/models` 复用缓存并新增 `POST /panel/api/models/refresh`（5 分钟冷却）；`/packages` 透传原始到期值；错误映射 | 中；需回归 `/v1/models` |
| `internal/panel/meta.go` | 可选 `cache_age_seconds/cache_expired`；不改 reveal 语义 | 中；需安全测试 |
| `internal/upstream/client.go` | 不改查询窗口；保留原始 `expires_at` 供前端封顶 | 低；不改内核路由 |
| `internal/panel/index.go` | CSP 加 `font-src 'self'`（方案 A） | 中；需安全测试 |
| `internal/panel/security_test.go` / `frontend_v02_test.mjs` | 更新字体断言、保留严格 CSP 反例 | 必须与字体方案同步 |

### 21.3 明确不改

- `third_party/meta/**`、Mihomo 二进制、`internal/metacore` 的第三方内核实现。
- `internal/server` 反代核心请求链路（本轮只在 panel 侧复用缓存读取）。
- `internal/reqlog/reqlog.go`：已实现流式读取与清理，本轮不改；24 小时、1000 条、16 MiB、单条 8 KiB、`no_logs` 语义不变。
- 文件所有权以第 25 节为准：`router.js` 由批次 7 独占，批次 3/4 需要登录钩子时只提交接口约定，不直接改文件；`logs.js` 归批次 6，`index.html` 按 `view-*` 区块分段拥有。任何批次都不得覆盖他人已合并的改动。

## 22. Git 基线与回退机制（开工前置条件；基线已建立，规则继续有效）

### 22.1 为什么必须先建 Git

开工前源码目录**不是 Git 仓库**（当时 `git status` 返回 `fatal: not a git repository`）。在无版本控制的情况下并行派发 8 个批次，无法回答三个问题：改坏了哪个文件、能否回退到可用版本、谁覆盖了谁。因此把 Git 初始化列为批次 -1 的硬门禁。

该门禁现已满足：基线 `29bd811`、标签 `baseline-ui-redesign`、当前 `main@0f3a8c2`。本节保留为回退规范与新增批次的准入要求，不再是阻塞项。

### 22.2 初始化步骤（由主助手或指定批次执行一次）

```bash
cd workbuddy-local
git init -b main
git config core.autocrlf false
git config core.safecrlf false
git add -A
git commit -m "chore: baseline before UI redesign"
git tag baseline-ui-redesign
```

要求：

- 用 `git init -b main` 直接建 `main`，不依赖全局 `init.defaultBranch` 配置，也不建多余分支。
- `core.safecrlf` 设为 `false`：仓库里混有 CRLF 的旧文件，设成 `true` 会让 `git add` 直接失败，反而卡住基线。
- 基线提交必须包含源码、测试、部署脚本、`config.example.json`、`README.md`、`docs/`。
- 基线提交**不得包含**真实账号凭据、`config.json`、`auths/`、`data/`、`backups/`、根目录的 `server.exe`/`.d2b-check.exe`、`dist/`、`demo-data/`、`.d2b-data/`、`.d2b-shots/`、日志与截图；`third_party/meta` 下若有随包二进制，先确认来源再决定是否入库，不要用通配 `*.exe` 一刀切。
- 基线标签 `baseline-ui-redesign` 是唯一的“开工前可用版本”回退点。

### 22.3 `.gitignore` 必须先修正

当前 `.gitignore` 的 `docs/` + `*.md` 组合会让规则难以推理。实测结论（在临时仓库用同一份 `.gitignore` 复现）：

- `git add -A -n` 目前**确实能加入** `docs/superpowers/plans/*.md`，所以“文档必定漏提交”不成立，不要按这个错误结论去改。
- 但 `git check-ignore -v docs/...md` 会输出 `!docs/**` 这一行并以退出码 0 结束；它表示“匹配到了某条规则（这里是否定规则）”，**不能**用它判断文件是否被忽略。用 `-v` 做门禁会误报。
- 正确判据是 `git check-ignore -q <path>`：退出码 0 = 被忽略，1 = 未忽略。

规则本身仍然要收敛，改成显式白名单，避免以后新增文档/图片时被意外吞掉：

```gitignore
*.md
!README.md
!PROJECT_STATE.md
!docs/**/*.md
docs/**/*.png
docs/**/*.jpg
```

并保留以下敏感/产物排除：

```gitignore
auths/
data/
backups/
config.json
.env
.env.*
*.key
*.pem
/server.exe
/.d2b-check.exe
/dist/
demo-data/
.d2b-data/
.d2b-shots/
.d2b-shots/profile*/
*.log
```

修正后必须检查（三条都要过）：

```bash
git check-ignore -q docs/superpowers/plans/2026-10-21-complete-ui-redesign-plan.md; echo $?
git check-ignore -q notes.md; echo $?
git add -A -n
```

- 第 1 条必须输出 `1`（设计文档未被忽略）。
- 第 2 条必须输出 `0`（普通 `.md` 仍被忽略，白名单没有放得过宽）。
- 第 3 条的 dry-run 列表里必须出现设计文档，且**不得**出现 `auths/`、`data/`、`config.json`、`server.exe`、`backups/`。
- `git status --short --ignored` 只用于人工扫一眼，不作为门禁判据。

### 22.3.1 执行顺序防呆

基线只需做一次，但做错会污染整个仓库。执行时按这个顺序，每一步都要看结果：

1. 先确认没有 `.git`：`Test-Path .git` 应为 `False`；若已存在，**不要**重复 `git init`，直接跳到第 3 步检查。
2. 先改 `.gitignore` 再 `git add`。顺序反了会把 `auths/`、`data/` 暂存进去，之后再 `git rm --cached` 容易漏。
3. `git add -A -n` 先 dry-run，人工确认列表里没有敏感文件，再执行真正的 `git add -A`。
4. 提交前跑 `git status --short | Select-String 'auths|data/|config.json|server.exe'`，必须无输出。
5. 提交后用 `git show --stat --oneline HEAD` 复核文件数，正常应在数百个源码/文档文件的量级；若只有个位数，说明忽略规则写宽了。

### 22.4 提交与回退规则

| 场景 | 规则 |
|---|---|
| 每个批次开始 | 从 `main` 当前 HEAD 开短分支：`git switch -c ui/batch-<编号>-<主题>` |
| 每个批次结束 | 至少一次提交，提交信息写清批次与范围，例如 `feat(ui): batch 0 glass tokens and ambient background` |
| 合并前 | 主助手审查 diff、测试结果、截图；通过后 `git switch main && git merge --no-ff ui/batch-...` |
| 批次失败 | 该分支直接丢弃，不改 `main`；`main` 始终保留可运行版本 |
| 紧急回退 | `git reset --hard baseline-ui-redesign`，随后重新拉取批次分支 |
| 禁止 | 不在 `main` 上直接改代码；不用 `git push --force`；不删除基线标签 |

### 22.5 与部署的关系

- 只有 `main` 通过全量测试后才允许部署到 VM。
- 部署前记录 `git rev-parse HEAD`，部署后写入部署记录；回退时按该 commit 重新构建。
- VM 上的二进制、配置、账号数据不属于 Git；回退只回退程序版本，不回退数据。
- 部署脚本必须支持“保留旧二进制 + 失败回滚”，不能用覆盖式删除。

### 22.6 Git 门禁验收

- `git log --oneline -1` 能看到基线提交。
- `git tag --list` 包含 `baseline-ui-redesign`。
- `git check-ignore -q` 对设计文档退出码为 `1`，对普通 `.md` 为 `0`。
- `git status` 干净，除当前批次改动外无未跟踪的敏感文件。
- 每个批次分支都能独立 checkout、构建、跑测试。

## 23. 施工批次书（主助手编排，子智能体执行）

> 每批一个子智能体；同一时刻并行批次只能落在**完全不重叠的文件**上。`egress.js`、`index.html`、`styles.css` 是全站冲突热点，按下面的串行规则处理。

| 批次 | 名称 | 独占文件（写权） | 依赖 | 可否并行 |
|---|---|---|---|---|
| -1 | Git 基线 | 仅 `.gitignore` | 无 | 否（必须最先） |
| 0 | 设计冻结 | `styles.css` token 段、`index.html` shell 段、`assets/ambient.js`（新建） | -1 | 否 |
| 1 | 导航与概览 | `index.html` 导航/概览段、`overview.js`、`styles.css` 概览段、`router.js` 页面标题映射 | 0 | 与 2/5/6 并行 |
| 2 | 账号池与任务 | `account-rows.js`、`account-table.js`、`tasks.js`、`maintenance/service.go`、`panel/maintenance.go` | 0 | 与 1/5/6 并行 |
| 3 | 出口页主体 | `index.html` 出口段、`egress.js`、`styles.css` 出口段 | 0 | 否（与 4 串行） |
| 4 | 出口生命周期与刷新 | `egress.js`（接手）、`meta.go`（只读字段） | 3 | 否（串行接 3） |
| 5 | 积分与模型 | `packages.js`、`models.js`、`model-policy.js`、`panel.go` models/packages 段、`upstream/client.go` 只读字段 | 0 | 与 1/2/6 并行 |
| 6 | 用量、错误、设置 | `usage.js`、`logs.js`、`config.js`、`index.html` 对应段 | 0 | 与 1/2/5 并行 |
| 7 | 登录、动画、字体 | `auth.js`、`startup-animation.js`、`animation-settings.js`、`router.js` bootstrap 段、`preferences.js`、`fonts/`、`styles.css` 字体段、`index.go`、`security_test.go`、`frontend_v02_test.mjs` | 0、4（需 `refreshSubscriptionsOnce`） | 否（收尾） |
| 8 | 性能与全量验收 | 只读全部；仅修缺陷 | 全部 | 否 |

### 批次 -1：Git 基线（不通过不得进入批次 0）
- 执行：`git init -b main`、修正 `.gitignore`、`git add -A -n` 人工核对、基线提交、打 `baseline-ui-redesign` 标签。
- 门禁：`git log --oneline -1` 有基线；`git tag --list` 含标签；`git check-ignore -q <设计文档>` 退出码 `1`；`git check-ignore -q notes.md` 退出码 `0`；暂存区无 `auths/`、`data/`、`config.json`、`server.exe`、`backups/`。
- 交付：命令输出原文粘贴到回报里。不通过则不得改任何产品代码。

### 批次 0：设计冻结
- 产出：`:root` 设计 token（§15.2）、三层玻璃 class、背景层骨架与叠层顺序（§16.4）、`ambient.js` 生命周期骨架、登录页/启动层骨架。
- 门禁：1440/1366/390 三档静态截图；控制台无报错；`prefers-reduced-motion` 有效；`document.hidden` 停帧可验证。
- 不做：任何页面信息增删、任何 API 改动、任何业务 JS。

### 批次 1：导航与概览
- 门禁：一级导航平铺无分组；选中态只有文字色 + 左侧 2px 线（删除 `styles.css:68` 的整行 `background` 与任何 `outline`/`box-shadow`）；圆环在左、四项数据在右且每行带细进度条；圆环描边动画 320ms、数据行错峰 40ms；昼夜组件点击扩散 500ms；解释性小字删除。

### 批次 2：账号池与任务
- 门禁：账号卡只留昵称/状态/余额/当前出口/禁用/删除，高度 ≤ 132px；请求、Token、延迟/速率三项删除；出口入口改名“出口”并排在禁用旁；任务卡显示上次执行时间；失败数无失败时灰色；按钮文案固定“全部执行”；Go/Node 通过。

### 批次 3：出口页主体
- 门禁：首屏主体是节点网格（不是账号路由/流量卡）；订阅概览（订阅数/启用数/节点数/缓存状态）；支持 3-4 条订阅导入；订阅详情弹窗明文 URL、关闭即清空；节点卡小方框、名称后带缓存延迟、单击即绑定（无“绑定此节点”按钮）；不自动测速。

### 批次 4：出口生命周期与刷新
- 门禁：打开/切页/关闭后 interval 归零；筛选只 GET；`refreshSubscriptionsOnce()` 串行逐条刷新且永不 throw；48h 过期只标记；统一“刷新节点”只刷订阅+重读节点、不测速；无迟到渲染。

### 批次 5：积分与模型
- 门禁：到期 >30 天显示“30 天内”，不出现 2928；未知余额不计 0；零余额包不渲染；积分数字完整不缩写；模型卡只留名称/ID/上下文/倍率/能力/推理档位/输出 Token；档位按 `off→low→medium→high→xhigh→max→ultra` 横向排列；禁用统一为右上开关，禁用后置底；“上下文展示”按钮删除；`POST /panel/api/models/refresh` 5 分钟冷却；连进 5 次只打 1 次上游。

### 批次 6：用量、错误、设置
- 门禁：用量首屏用预加载缓存，不重复 GET；错误页只保留错误、删除成功率/说明小字、详情按需弹窗；设置只剩密码/启动动画/服务状态，删除订阅管理与本机 API 重复块；页面标题“系统设置”。

### 批次 7：登录、动画、字体
- 门禁：登录页只留品牌标记/标题/密码/按钮，删除全部说明小字与初始密码提示；会话 24h Cookie；启动动画最短 8s、最长 12s，数据提前返回不硬切，超时也放行；英文 AI 名称逐字轮播；动画期间 shell `inert`；字体静态打包生效、断网回退系统字体、CSP 只加 `font-src 'self'`。

### 批次 8：性能与全量验收
- 门禁：§13.5 全部指标实测；三档截图；`go test ./...`；全部 Node 测试；隐藏页暂停；20 次切页内存无增长；网络面板无 404/空响应；前后端每个交互都有真实接口与回读。

### 批次边界规则
- 同一文件同一时间只有一个 owner；冲突时后到者只提 patch 建议。
- `index.html` 由批次 0 冻结 shell 与段落锚点后，各批次只改自己 `view-*` 区块；新增控件由需要它的批次自己加，不再有“视觉批次统一加”。
- `styles.css` 按段落注释分区（token / nav / overview / accounts / egress / packages / models / logs / config / responsive / motion），每批只写自己区段。
- 每批交付必须包含：改动文件清单、测试命令与输出、挡板覆盖说明、未做事项。

## 24. 实施顺序

```text
-1 Git 基线
 └─ 0 设计冻结
     ├─ 并行组 A：1 导航概览 │ 2 账号任务 │ 5 积分模型 │ 6 用量错误设置
     ├─ 3 出口页主体 ─→ 4 出口生命周期与刷新
     └─ 7 登录动画字体（依赖 4 的 refreshSubscriptionsOnce）
          └─ 8 性能与全量验收
```

原则：先建 Git 与设计冻结，再并行互不重叠的页面批次；`egress.js` 单独串行；登录链路最后收口；验收只做修复不接新功能。

## 25. 文件所有权与防冲突策略

| 文件/范围 | 唯一 Owner | 允许 | 禁止 |
|---|---|---|---|
| `internal/panel/index.html` | 批次 0 建骨架，之后按 `view-*` 段 | 各自区块结构 | 跨段改写、改他人 ID |
| `internal/panel/assets/styles.css` | 批次 0 定分区，之后按段 | 自己区段 | 改 token、改他人区段 |
| `assets/ambient.js` | 批次 0 新建，之后只读 | 生命周期与绘制 | 后续批次改绘制 |
| `assets/egress.js` | 批次 3 → 批次 4（串行） | 节点主体/订阅/刷新/生命周期 | 并行修改 |
| `assets/router.js` | 批次 1 改标题映射；批次 7 改 bootstrap | 各自段落 | 双向覆盖 |
| `assets/overview.js` | 批次 1 | 圆环/进度条/昼夜 | 改统计接口 |
| `assets/account-rows.js`、`account-table.js`、`tasks.js` | 批次 2 | 卡片字段/任务字段 | 改分页契约 |
| `assets/packages.js`、`models.js`、`model-policy.js` | 批次 5 | 展示与排序 | 改内核 |
| `assets/usage.js`、`logs.js`、`config.js` | 批次 6 | 页面收敛 | 改 `reqlog` 保留策略 |
| `assets/auth.js`、`startup-animation.js`、`animation-settings.js`、`preferences.js`、`fonts/` | 批次 7 | 登录/动画/字体 | 改业务页面 |
| `internal/maintenance/service.go`、`internal/panel/maintenance.go` | 批次 2 | 增加上次执行时间字段 | 改调度语义 |
| `internal/panel/panel.go` | 批次 5 | models 缓存 + refresh 接口 | 改反代核心 |
| `internal/panel/meta.go` | 批次 4 | 只读缓存字段 | 改 reveal 语义 |
| `internal/panel/index.go` | 批次 7 | `font-src 'self'` | 放宽其他 CSP |
| `third_party/meta/**`、`internal/metacore/**`、`internal/server/**`、`internal/reqlog/reqlog.go` | 无（禁止改） | 只读 | 任何修改 |

## 26. Go / Node / 浏览器验收矩阵

> 下表是验收矩阵，不是历史声明。批次 10 已在 `main@0f3a8c2` 派生 worktree 实跑全量：`go build ./...`、`go test ./...`、12 个 `frontend_*_test.mjs`（118/118）均通过，详见 §30.2。浏览器三档与性能实测仍未执行。

### 26.1 Go

| 测试 | 覆盖 | 命令 |
|---|---|---|
| `go test ./internal/panel/...` | 面板 API、Meta、CSP、密码、订阅、绑定 | `go test ./internal/panel/...` |
| `go test ./internal/maintenance/...` | 任务状态/时间字段 | `go test ./internal/maintenance/...` |
| `go test ./internal/upstream/...` | 积分包到期/余额 | `go test ./internal/upstream/...` |
| `go test ./internal/reqlog/...` | 24h/容量/no_logs/流式 | `go test ./internal/reqlog/...` |
| `go test ./internal/usage/...` | 用量窗口/快照 | `go test ./internal/usage/...` |
| `go test ./internal/server/...` | `/v1/models` 缓存回归 | `go test ./internal/server/...` |
| `go test ./...` | 全量回归 | `go test ./...` |

### 26.2 Node

| 测试 | 覆盖 | 命令 |
|---|---|---|
| `frontend_egress_filter_batch_e_test.mjs` | 筛选参数、无 POST、关闭取消、无订阅保持全部 | `node --test internal/panel/frontend_egress_filter_batch_e_test.mjs` |
| `frontend_lifecycle_batch_e_test.mjs` | 打开无 POST、点击才测速、关闭/切页停止轮询 | 同上 |
| `frontend_v02_test.mjs` | 订阅 reveal、积分过滤、错误分类、设置不拉订阅 | 同上 |
| `frontend_startup_test.mjs` | 动画最短 8s/最长 12s、销毁、减少动画 | 同上 |
| `frontend_logs_errors_test.mjs` | 错误只保留错误、详情按需 | 同上 |
| `frontend_overview_test.mjs` | 圆环/统计 | 同上 |
| `frontend_modules_test.mjs` / `frontend_pool_test.mjs` | 模块/账号池回归 | 同上 |

### 26.3 浏览器（Playwright/人工）

| 场景 | 视口 | 验收 |
|---|---|---|
| 概览 | 1440/1366/390 | 圆环/进度条/昼夜扩散/无横向滚动 |
| 导航 | 1440/390 | 一级平铺、悬浮、仅文字+左侧短线高亮、无二级菜单 |
| 账号池 | 1440/390 | 卡片缩短、无请求/Token/延迟、分页稳定 |
| 任务 | 1440/390 | 上次时间、灰红、按钮文字不变、失败详情按需 |
| 出口 | 1440/390 | 节点主体、订阅概览/导入/详情、筛选只 GET、无自动测速 |
| 出口生命周期 | 1440 | 打开/切页/关闭后 interval=0、无迟到渲染 |
| 积分 | 1440/390 | 2928 天显示 30 天内、未知不计 0、零余额隐藏、完整数字 |
| 模型 | 1440/390 | 卡片简化、禁用优先排序、缓存时间、手动刷新冷却 |
| 用量 | 1440/390 | 缓存预加载、本机观测、折叠、无超长列表 |
| 错误 | 1440/390 | 仅错误、详情按需、保守分类 |
| 登录/动画 | 1440/390 | 无默认密码文案、动画可销毁、减少动画 |
| 字体 | 1440/390 | 字体生效、断网回退、CSP 无 `*` |

浏览器验收命令（示例，实际路径按仓库）：
```bash
npx playwright test --project=chromium
```
若仓库无 Playwright 配置，用现有 `agent-browser` 手工三档截图，不新增依赖。

### 26.4 挡板（mock/fixture）与回归门禁

前后端不互通是本轮最需要防的失败模式，因此每一批都必须证明“界面上的每个数字与动作都有真实接口支撑”，并且测试不依赖真实环境。

**挡板分层**

| 层 | 做法 | 位置 | 用途 |
|---|---|---|---|
| 前端 API 挡板 | 复用 `frontend_helpers_test.mjs` 的 `mockAPI(handler)` 拦截 `fetch`，按 URL 返回固定 JSON | 现有 | 所有 `frontend_*_test.mjs` |
| 交互时序挡板 | 可控 `flush()` / 假定时器推进，验证“点击→请求→渲染” | 现有 | 刷新高亮、轮询归零、迟到响应丢弃 |
| Go 上游挡板 | `httptest.Server` 或接口注入，返回固定 models/packages/余额 | `internal/panel`, `internal/upstream` | 模型缓存、30 天封顶、余额不可读 |
| 浏览器挡板 | 拦截 `/panel/api/*` 返回固定 fixture，页面可离线完整走查 | 批次 8 验收 | 三档截图、动画、性能 |

**每批必须交付的四件事**

1. 改动文件清单（绝对路径）。
2. 执行过的命令与原始输出（Go 与 Node）。
3. 挡板覆盖说明：新增/修改的交互，在哪个测试里被 mock，断言了什么。
4. 未做事项与已知风险。

**回归门禁（批次 8 必跑）**

```bash
go build ./...
go vet ./...
go test ./...
for f in internal/panel/*_test.mjs; do node --test "$f" || exit 1; done
```

- 新增页面/组件必须有对应 `frontend_*_test.mjs`；只改 CSS 的批次可豁免 Node 测试，但必须交三档截图。
- 任何“前端有按钮、后端无接口”或“后端有字段、前端不展示”的差异，必须在批次说明里写明是**有意为之**并给出理由，否则视为未完成。
- 接口变更必须同时更新：后端 handler、前端调用、Node 挡板断言、§5 契约表。缺一项即回归失败。

## 27. 明确不能做 / 已定项

### 27.1 不能做（本轮硬约束）

- 不新增后台订阅调度器；登录时只刷新一次启用订阅，切页/后台不重复触发。
- 不自动测速：只有用户点击 `POST meta/tests`。
- 登录时刷新订阅一次（启动动画遮挡）；切页/打开弹窗/切筛选不请求上游订阅。
- 不把完整订阅 URL 放普通列表、日志、localStorage、URL hash。
- 不修改 Meta/Mihomo/`third_party/meta`/`internal/metacore` 第三方内核。
- 不修改 `internal/server` 反代核心请求链路。
- 不把 2928 天改成 0；统一封顶 30 天展示；不伪造未知余额。
- 不放宽 CSP 到 `*`/`unsafe-eval`；远程字体必须白名单或静态打包。
- 不把附件 HTML 的脚本/事件当产品代码执行。
- 不在未建立 Git 基线的情况下修改产品代码；基线已建立（`29bd811` / `baseline-ui-redesign`），新增批次仍须独立分支/worktree。
- 不在 E 范围改 `router.js`、`index.html`、`logs.js`（由其他批次 owner）；文件冲突时只报告建议，不覆盖。

### 27.2 已定项（实施时不得再改口径）

1. 48 小时基准：`last_refresh_at`；超过只标记。登录时执行一次订阅刷新与节点加载，由启动动画遮挡；不新增后台定时器。
2. 到期展示上限：30 天；超过一律显示“30 天内”，不归零、不显示 2928。
3. 未取得余额：不重试、不计 0、单独计数。
   登录时订阅刷新：执行一次；启动动画最短 8 秒、最长 12 秒；刷新失败不阻塞进入。
4. 模型手动刷新：当前代码没有独立刷新接口（已核实）；本轮新增面板缓存 + `POST /panel/api/models/refresh`，5 分钟冷却，失败保留旧缓存。
5. 字体：静态打包 `Source Sans 3 + Noto Sans SC`；不上远程字体；体积超预算时只保留 400/500 两档。
6. 订阅 URL：允许在详情弹窗查看；不提供复制按钮；关闭即清空。
7. 任务上次执行时间：只保留内存，重启显示“尚无记录”。
8. 账号卡三字段：删除，不放进主卡片；需要时进详情。
9. 出口账号路由：移出首屏，保留绑定管理入口。
10. 启动动画：四种风格全部保留；默认风格由实施时按视觉完成度选定，不写死 `names`。

### 27.3 已确认项（本轮）

1. 概览圆环位置：已定，圆环在左、数据在右。
2. 导航形态：已定，桌面悬浮玻璃侧栏 + 手机悬浮胶囊。
3. 出口节点卡：`auto-fill minmax(176px,1fr)`，按视口自适应；全屏约 4 列，小窗约 3 列，手机 1 列。
4. 模型卡：`auto-fill minmax(300px,1fr)`；全屏 3 列，小窗 2 列，手机 1 列。
5. 启动动画默认风格：由实施时选视觉完成度最高的一种（候选 `names`/`orbital`/`scan`/`minimal`），其余作为设置选项。
6. 订阅详情不显示复制按钮。

## 28. 新增需求矩阵（v5 补充，必须与批注 1-48 同批验收）

| 编号 | 需求 | 当前事实 | 目标 | 主要文件 | 验收 |
|---|---|---|---|---|---|
| N1 | 整体视觉重做 | 现有卡片为普通半透明，密度高 | 液态玻璃、留白、非对称栅格 | `styles.css`、`index.html` | 三档视口截图一致，无“中转站模板感” |
| N2 | 液态玻璃 | 只有 `backdrop-filter` | 三层玻璃：填充、顶缘高光、外阴影、内折射 | `styles.css`、`ambient.js` | 卡片有可见边缘与层次，文字不糊 |
| N3 | 客户端动态背景 | 仅两个 CSS 光斑漂移 | 一个背景 Canvas + CSS 光场，全部客户端 | `ambient.js`、`index.html` | 隐藏暂停，30fps 上限，无 API 请求 |
| N4 | 启动动画融合 | 四种风格已存在但未与玻璃语言统一 | 英文 AI 名称、逐字切换、最短 8s/最长 12s、可配置 | `startup-animation.js`、`animation-settings.js` | 最短 8s、最长 12s 退场、减少动画直接进 |
| N5 | 登录与同步衔接 | 登录后才 bootstrap，启动动画可遮住等待 | 密码页与动画同一视觉；失败也放行；24h 会话 | `index.html`、`auth.js`、`router.js` | 登录后不白屏，失败可进，Cookie 24h |
| N6 | 字体直接可见 | CSP 阻断、仅有本地栈 | 静态打包 woff2 + `font-src 'self'`；英文类似 Claude 的人文无衬线 | `styles.css`、`fonts/`、`index.go`、测试 | 页面直接生效，断网回退，CSP 无外域 |
| N7 | 出口页节点主体 | 首屏是流量/账号路由 | 节点卡为主体，订阅组件在侧 | `index.html`、`egress.js` | 首屏可见节点与缓存延迟 |
| N8 | 多订阅与详情 | 设置页有订阅管理 | 出口页集成 3/4+ 订阅；详情弹窗显明文 URL | `egress.js`、`config.js` | 可导入 4 条，列表默认脱敏 |
| N9 | 统一手动刷新 | 只有单订阅刷新 | 一个按钮刷新启用订阅并重读节点，不测速；按钮不变文案 | `egress.js` | 点击前无 POST，刷新中高亮，结束回落 |
| N10 | 48h 缓存 | 有 `last_refresh_at`，无展示 | 登录刷新一次；未过期只读；过期标记但不清空；切页不刷新 | `egress.js`、`meta.go` | 登录一次；切页/后台不刷新 |
| N11 | 模型拉取与排序 | 每次直连上游；禁用无排序 | 缓存 + 手动刷新；禁用排最后 | `panel.go`、`models.js`、`model-policy.js` | 连进 5 次只拉 1 次；禁用后置底 |
| N12 | 错误仅保留错误 | 已有 reqlog 24h，仅错误 | 删除运行日志面板，详情按需 | `logs.js`、`index.html` | 无成功记录、无成功率、无解释小字 |
| N13 | 任务上次执行时间 | `Status` 无时间字段 | 显示上次执行/完成时间 | `maintenance/service.go`、`tasks.js` | 执行后可见，重启策略明确 |
| N14 | 响应式 | 现有断点但未验收手机 | 1440/1366/390 无横向滚动 | `styles.css`、`index.html` | 手机导航、卡片、弹窗可用 |
| N15 | 前后端互通 | 部分视觉改动无接口支撑 | 每个交互都有真实 API + 回读 | 全链路 | 浏览器网络面板无 404/空响应 |

## 29. 覆盖清单与状态

### 29.1 需求覆盖

- 浏览器批注 1-48：48/48 已逐条编号覆盖，每条含现状、目标、拟改文件、接口影响、验收、决策。
- 新增需求 N1-N15：已进入第 28 节矩阵，与批注 1-48 同批验收。
- 液态玻璃、客户端动态背景、字体、启动/登录衔接：已进入第 15-18 节，属于本报告新增的设计约束。

### 29.2 实施状态（以真实代码为准）

- 已完成（`main@0f3a8c2` 逐项核对，详见 §2 与 §30）：
  - 批次 -1：Git 基线 `29bd811` + 标签 `baseline-ui-redesign`。
  - 批次 0：设计 token、三层玻璃、`ambient.js`、`lifecycle.js` 暂停契约、CSS 分区锚点（`7276c50`）。
  - 批次 2A：维护任务上次执行/完成时间与结果（`28bc85f`）。
  - 批次 5A：模型 10min 缓存 + 60s 负缓存 + `POST /panel/api/models/refresh` 5min 冷却（`7b99f4a`）。
  - 批次 2：账号卡删请求/Token/延迟、≤132px、出口按钮同排、任务上次执行时间、失败灰红（`f1c8fca`）。
  - 批次 1：九项一级导航、悬浮玻璃条、仅文字+2px 左线选中、圆环在左+细进度条、昼夜扩散（`ceca7c5`）。
  - 批次 5：到期 30 天封顶、零余额隐藏、模型卡简化、档位排序 `off→low→medium→high→xhigh→max→ultra`、禁用置底、手动刷新（`ac9857b`）。
  - 批次 3：出口页节点网格首屏、订阅概览/导入/详情（关闭即清空明文）、串行刷新不测速（`9d7022a`）。
  - 批次 6：设置只剩密码/动画、删订阅+API+外观块、登录遮罩小字删除、用量 60s memo、错误只留错误（`3ee482e`）。
  - 批次 8A：订阅逻辑清空、CSS 死规则清理、跨批测试漂移修正（`1737782`）。
  - 批次 7A：同源 woff2 字体 + CSP `font-src 'self'`（`fc1f87d`）。
  - 批次 4：登录后自动刷新订阅一次（与动画共用 12s 截止）、`subscriptionCacheState()` 48h、生命周期加固（`0a74e82`）。
  - 批次 7B：启动动画重做（8s/12s、四风格、流体拉幕/百叶/光闸/noise/进度条）（`399af97`）。
- 部分完成：
  - 解释性小字清理：概览/账号池已删，积分用量 `usNote` 与错误页 `reqSummary/reqNote/logNote`、`运行记录` 面板仍在（批次 9 处理中，分支 `ui/batch-9-clean` 目前与 `main` 无差异）。
  - 节点缓存延迟：只用 `node.delay_ms` 缓存值，无测试时间/缓存年龄展示。
  - 积分用量预加载：60s memo 与 in-flight 去重已有，但登录时未预取。
  - 悬浮导航：宽屏仍是整高侧栏玻璃，不是悬浮胶囊。
  - 响应式：断点覆盖到 620px，1440/1366/390 未做截图验收。
  - 渲染性能预算：§13.5 指标已定义、降级逻辑已写，但无实测数据（帧率、单帧长任务、合成层数量）。
- 未完成：
  - 批次 9：死 CSS（`.subscription-manager/.subscription-*`、`.metric-card`、`.egress-top` 残留）与剩余解释性小字清理。
  - 浏览器视觉验收：1440/1366/390 三档截图与交互走查。
  - 渲染性能实测：按 §13.5 采集数据并与门槛比对。
  - VM 部署：`192.168.189.128:22` 通，`:7863` 不通（实测 `ConnectAsync` = False），panel 进程未监听，需先修复服务再核对 commit。
- 未修改：Meta/Mihomo 内核、`third_party/meta`、`internal/metacore`、`internal/server` 反代核心、`internal/reqlog` 保留策略。

### 29.3 开工门禁

- Git 基线：**已满足**。`29bd811` + 标签 `baseline-ui-redesign`；当前 `main@0f3a8c2`。
- `.gitignore`：**已修正并验证**。白名单放行 `docs/**/*.md`（`git check-ignore -q` 退出码 1），敏感/产物排除保持。
- 挡板契约：**已落地**。12 个 `frontend_*_test.mjs` 使用 `mockAPI`，本次全量 118/118 通过。
- 后续批次仍需独立分支/worktree、逐批验收；不得直接改 `main`。

### 29.3.1 环境实测（2026-10-21 本轮）

| 项 | 结果 | 含义 |
|---|---|---|
| `127.0.0.1:17863` | HTTP 200，LEN=18665 | 本地 demo 面板在跑（`-demo`，`WB2A_LISTEN=127.0.0.1:17863`），用于验收 |
| `127.0.0.1:7863` | 可建连但连接被重置 | Windows `portproxy`：`127.0.0.1:7863 -> 192.168.189.128:7863` |
| `192.168.189.128:22` | 通（TcpClient=True） | VM 在线，SSH 可用 |
| `192.168.189.128:7863` | 不通（TcpClient=False） | VM 上面板进程未监听或已退出；**不是隧道问题** |

结论：部署验证前必须先让 VM 的 panel 进程重新监听 7863，并确认版本号与本地 commit 对应。**本轮未执行部署**，该风险单独跟踪。

### 29.4 本轮交付物

- 本文件是唯一总规划；`2026-10-21-egress-redesign-plan.md` 是出口专项，内容已被本文件第 17.4/22/23 节吸收，实施时以本文件为准，专项文件只作补充阅读。
- v5 新增：§13.5 渲染性能预算、§16.5 渲染技术边界、§26.4 挡板与回归门禁、第 23/25 节批次与所有权去歧义、Git 回退为硬门禁。
- 批次 10（本文）：只回填状态与执行记录，不改产品代码。
- 本轮回归（`main@0f3a8c2` 派生 worktree 实测）：`go build ./...` 退出 0；`go test ./...` 全部 `ok`；`node --test internal/panel/*_test.mjs` 118 tests / 118 pass / 0 fail。
- 下一步：批次 9 清死 CSS/小字 → 三档浏览器视觉验收 → §13.5 性能实测 → VM 服务修复与部署核对。

## 30. 批次执行记录

> 来源：`git log --oneline -30` 与逐条 `git show --stat`；提交时间均为 2026-10-21（+0800）。验收结果为本轮在 `main@0f3a8c2` 派生 worktree 中实际执行，不引用历史口头结论。

### 30.1 汇总表

| 批次 | 内容摘要 | commit | 验收方式（命令） | 结果 |
|---|---|---|---|---|
| -1 | Git 基线、`.gitignore` 白名单 | `29bd811` | `git log --oneline -1`；`git tag --list`；`git check-ignore -q <doc>` | 通过：基线存在、标签存在、文档未被忽略（退出码 1）、370 文件入库 |
| 0 | 设计 token、三层玻璃、`ambient.js`、`lifecycle.js` | `7276c50` | `git show --stat 7276c50`；`go build ./...` | 通过：4 文件 470 增；构建 0 |
| 2A | 维护任务 `last_run_at/last_finished_at/last_result` | `28bc85f` | `go test ./internal/maintenance/... ./internal/panel/...` | 通过：新增 `timing_test.go`、`maintenance_test.go`，全包 ok |
| 5A | 模型缓存 + 手动刷新接口 | `7b99f4a` | `go test ./internal/panel/...` | 通过：新增 `panel_models_cache_test.go`，全包 ok |
| 2 | 账号卡精简、任务时间、失败灰红 | `f1c8fca` | `node --test internal/panel/frontend_modules_test.mjs internal/panel/frontend_pool_test.mjs` | 通过：全量 118/118 |
| 1 | 一级导航、圆环在左+进度条、昼夜扩散 | `ceca7c5` | `node --test internal/panel/frontend_overview_test.mjs` | 通过：新增 86 行断言，全量 118/118 |
| 5 | 到期 30 天封顶、模型卡简化/排序/禁用置底 | `ac9857b` | `node --test internal/panel/frontend_modules_test.mjs` | 通过：新增 62 行断言，全量 118/118 |
| 3 | 出口页节点网格、订阅概览/导入/详情 | `9d7022a` | `node --test internal/panel/frontend_egress_filter_batch_e_test.mjs` | 通过：新增 165 行测试，全量 118/118 |
| 6 | 设置收敛、登录文案、用量 memo、错误只留错误 | `3ee482e` | `node --test internal/panel/frontend_logs_errors_test.mjs internal/panel/frontend_v02_test.mjs` | 通过：全量 118/118 |
| 8A | 跨批测试漂移修正、订阅死代码清理 | `1737782` | `node --test internal/panel/*_test.mjs` | 通过：118/118；`config.js` 删 94 行 |
| 7A | 同源 woff2 字体、CSP `font-src 'self'` | `fc1f87d` | `go test ./internal/panel/...` | 通过：新增 `fonts_test.go`，`security_test.go` 断言 CSP |
| 4 | 登录后订阅刷新一次、48h 缓存状态、生命周期 | `0a74e82` | `node --test internal/panel/frontend_lifecycle_batch_e_test.mjs` | 通过：新增 230 行测试，全量 118/118 |
| 7B | 启动动画重做（8s/12s、四风格） | `399af97` | `node --test internal/panel/frontend_startup_test.mjs internal/panel/frontend_animation_settings_test.mjs` | 通过：新增/改写 186 行测试，全量 118/118 |
| 10 | 本文状态回填与执行记录 | 本条提交 | `git diff --stat`；`git cat-file -t <hash>` | 见 §30.3 |

### 30.2 全量回归（本轮实跑）

```text
go build ./...                         -> exit 0
go test ./...                          -> 全部 ok（含 internal/scheduler 15.6s、internal/server 11.4s）
node --test internal/panel/*_test.mjs  -> tests 118 / pass 118 / fail 0（12 个测试文件）
```

补充实测：

```text
GET http://127.0.0.1:17863/panel/      -> HTTP 200, LEN=18665
192.168.189.128:22                     -> True  (SSH 可用)
192.168.189.128:7863                   -> False (panel 未监听)
```

### 30.3 未完成项跟踪

| 项 | 状态 | 剩余内容 | 建议归属 |
|---|---|---|---|
| 批次 9：死 CSS 与小字清理 | 进行中 | `styles.css` 删除 `.subscription-manager/.subscription-list/.subscription-row/.subscription-copy/.subscription-actions/.subscription-url`、`.metric-card`、`.egress-top` 残留；删 `index.html:147` `usNote`、`index.html:171` `reqSummary/reqNote/logNote` 与“运行记录”面板 | 分支 `ui/batch-9-clean`（当前与 `main` 无差异） |
| 浏览器视觉验收 | 未完成 | 1440/1366/390 三档：登录页无小字、九项导航、圆环+进度条、昼夜扩散、出口节点网格、订阅详情、设置两块、动画四风格、字体生效、无横向滚动 | 批次 8/验收 |
| 渲染性能实测 | 未完成 | §13.5 帧率、单帧长任务、合成层数量、blur 面积；隐藏页暂停实测 | 批次 8/验收 |
| VM 部署 | 未完成 | 修复 VM panel 进程监听 `:7863`，部署 `main@0f3a8c2`，核对版本号与 commit | 部署批次 |

> 批次 10 只改本文件；未触碰任何代码、测试或部署配置。

文档结束。

---

## 31. 设计系统重构 v6（2026-10-21 追加，用户目视验收后重做）

### 31.1 为什么重做

v5 的 token 与字体已实现并通过回归，但用户目视验收结论为「配色土、字体没改、动画没高级感」。实证如下，不采信自我描述：

| 现象 | 实测证据 | 结论 |
|---|---|---|
| 字体没改 | 浏览器 `document.fonts.check('16px "Source Sans 3"')` 返回 true；`getComputedStyle(body).fontFamily` 含 Source Sans 3 | 字体确实加载并生效，但选的是无衬线，观感接近系统默认，用户感知不到变化 |
| 没有衬线体 | `styles.css` 全文 0 处 `serif`；`--display` 与 `--font` 取值完全相同 | 需要新增衬线族并让标题/数字/强调词走衬线 |
| 配色土 | `--bg-base:#121014`（偏紫灰）、`--accent:#d98a68`（偏粉、明度高） | 与参考基准 `#131311` / `#D97757` 色相与饱和度双重偏差 |
| 动画没高级感 | 参考质感来自「衬线斜体词轮播 + Georgia 超大计数器 + 等宽全大写小标签 + 非线性进度」四件套 | 当前四风格只做了背景特效（拉幕/百叶/光闸/光带），文字层仍是无衬线常规字重 |

### 31.2 参考基准（源文件 `F:\下载\新建 文本文档.html`，只读，不得修改）

原值冻结，v6 一律以本表为准：

```css
--bg-dark:   #131311;   /* 暖黑，不是纯黑也不是紫黑 */
--bg-light:  #F4F1EA;   /* 米白 */
--text-light:#FAF8F5;
--text-dark: #141413;
--accent:    #D97757;   /* 陶土橙，全站唯一强调色 */
--muted:     #8C8881;
--border-light: rgba(20,20,19,.10);
--border-dark:  rgba(250,248,245,.12);
--ease-out-expo:     cubic-bezier(.16,1,.3,1);
--ease-in-out-quart: cubic-bezier(.76,0,.24,1);
```

字体角色分工（参考文件原样）：

| 角色 | 字体栈 | 用法 |
|---|---|---|
| 标题 / 强调词 / 大数字 | `Georgia, "Noto Serif SC", "Songti SC", serif` | `font-weight:400`、负字距、强调词 `font-style:italic` |
| 正文 | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | 常规 |
| 小标签 / 元数据 | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | `.78rem`、`letter-spacing:.08em`、`text-transform:uppercase` |

非线性进度映射（参考文件原样，v6 必须复刻）：

```text
t < .35        -> (t/.35) * .42          快冲 42%
.35 <= t < .65 -> .42 + ((t-.35)/.3)*.18  放缓到 60%
t >= .65       -> .60 + easeOutExpo((t-.65)/.35)*.40  冲顶 100%
```

### 31.3 新 token（v6 唯一真源，覆盖 `styles.css` 00 段）

暗色（默认）：

```css
:root{
  color-scheme: dark;

  /* 底：暖黑三层，禁止出现紫调 */
  --bg-base:#131311;
  --bg-deep:#0d0d0c;
  --bg-lift:#1a1a18;
  --bg:var(--bg-base);

  /* 光场：极低饱和暖光，只做背景 */
  --glow-warm:rgba(217,119,87,.16);
  --glow-cool:rgba(150,150,140,.07);

  /* 液态玻璃四层 */
  --glass-fill:rgba(30,30,28,.48);
  --glass-fill-strong:rgba(38,38,35,.62);
  --glass-line:rgba(250,248,245,.13);
  --glass-line-soft:rgba(250,248,245,.06);
  --glass-inner:inset 0 1px 0 rgba(250,248,245,.11);
  --glass-outer:0 24px 64px rgba(0,0,0,.42);
  --glass-blur:20px;
  --glass-saturate:130%;
  --glass-rim:rgba(250,248,245,.20);
  --glass-radius:22px;

  /* 文字 */
  --ink:#FAF8F5;
  --ink-2:#C6C2BA;
  --ink-3:#8C8881;

  /* 强调：陶土橙唯一 */
  --accent:#D97757;
  --accent-soft:rgba(217,119,87,.13);
  --accent-fill:#C4643F;
  --on-accent:#FAF8F5;

  /* 语义：低饱和，禁止红黄绿交通灯 */
  --ok:#8FA98C;
  --warn:#C0A36B;
  --bad:#B8736B;
  --fluoro-red:#E06A5E;

  /* 兼容层：变量名不变，只换值 */
  --surface:rgba(32,32,29,.72);
  --surface-soft:rgba(40,40,36,.52);
  --input:rgba(18,18,17,.58);
  --line:rgba(250,248,245,.12);
  --shadow:0 18px 60px rgba(0,0,0,.34);
  --radius:20px;
  --small-radius:12px;

  /* 字体：display 走衬线，body 走无衬线（由批次 11 提供文件） */
  --display:'Source Serif 4','Noto Serif SC',Georgia,'Songti SC',serif;
  --font:'Source Sans 3','Noto Sans SC','Microsoft YaHei UI','Segoe UI',sans-serif;
  --mono:'JetBrains Mono','Cascadia Code','Consolas',ui-monospace,monospace;

  /* 动效曲线：与参考一致 */
  --ease-out-expo:cubic-bezier(.16,1,.3,1);
  --ease-in-out-quart:cubic-bezier(.76,0,.24,1);
}
```

亮色：

```css
:root[data-theme="light"]{
  color-scheme: light;
  --bg-base:#F4F1EA;
  --bg-deep:#EAE6DD;
  --bg-lift:#FAF8F5;
  --glow-warm:rgba(217,119,87,.10);
  --glow-cool:rgba(120,130,140,.07);
  --glass-fill:rgba(255,253,248,.56);
  --glass-fill-strong:rgba(255,254,250,.74);
  --glass-line:rgba(20,20,19,.10);
  --glass-line-soft:rgba(20,20,19,.05);
  --glass-inner:inset 0 1px 0 rgba(255,255,255,.78);
  --glass-outer:0 20px 50px rgba(60,50,40,.09);
  --glass-rim:rgba(255,255,255,.62);
  --ink:#141413;
  --ink-2:#4A4843;
  --ink-3:#8C8881;
  --accent:#C4643F;
  --accent-soft:rgba(196,100,63,.11);
  --accent-fill:#B25433;
  --on-accent:#FAF8F5;
  --ok:#4F7A52;
  --warn:#8A6B2A;
  --bad:#A04B3F;
  --fluoro-red:#C9453A;
  --surface:rgba(255,253,247,.82);
  --surface-soft:rgba(252,249,242,.68);
  --input:rgba(240,236,227,.74);
  --line:rgba(20,20,19,.13);
  --shadow:0 18px 60px rgba(60,50,40,.08);
}
```

### 31.4 字体栈与字阶

必须先由批次 11 构建并入库（同源 woff2、SIL OFL、CSP 只允许 `font-src 'self'`）：

| 文件 | 用途 | 权重 | 预算 |
|---|---|---|---|
| `source-serif-4-400.woff2` | 英文标题/大数字 | 400 | ≤ 60 KB |
| `source-serif-4-600.woff2` | 英文标题强调 | 600 | ≤ 60 KB |
| `source-serif-4-400-italic.woff2` | 动画强调词斜体 | 400 italic | ≤ 60 KB |
| `noto-serif-sc-400.woff2` | 中文衬线标题 | 400 | ≤ 620 KB |
| `noto-serif-sc-500.woff2` | 中文衬线强调 | 500 | ≤ 620 KB |

保留现有 `source-sans-3-*` 与 `noto-sans-sc-*` 作正文。字体总量上限 **2.8 MB**，超限必须报告并给出裁剪方案。

字阶（v6 统一，替换散落的 `font-size`）：

```css
--fs-hero:  clamp(34px, 5.2vw, 62px);   /* 页面主标题，衬线 400 */
--fs-h2:    clamp(24px, 2.4vw, 32px);   /* 区块标题，衬线 500 */
--fs-h3:    17px;                        /* 卡片标题，衬线 500 */
--fs-body:  14px;                        /* 正文，无衬线 400 */
--fs-label: 11px;                        /* 小标签，等宽，letter-spacing .08em，大写 */
--fs-num:   clamp(26px, 3vw, 40px);      /* 关键数字，衬线 400，tabular-nums */
```

### 31.5 液态玻璃四层规范（替换现有单层半透明）

```css
.glass-surface{
  position:relative;
  background:linear-gradient(180deg,var(--glass-fill-strong),var(--glass-fill));
  border:1px solid var(--glass-line);
  box-shadow:var(--glass-inner),var(--glass-outer);
  backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border-radius:var(--glass-radius);
}
/* 第 1 层：大面积柔光（左上冷白 + 右下暖橙） */
.glass-surface::before{
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:
    radial-gradient(120% 62% at 16% -4%,rgba(255,255,255,.14),transparent 56%),
    radial-gradient(90% 46% at 86% 104%,rgba(217,119,87,.09),transparent 62%);
}
/* 第 2 层：1px 顶缘镜面高光（必须用 mask 只留边框） */
.glass-surface::after{
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  border:1px solid transparent;
  background:linear-gradient(180deg,var(--glass-rim),transparent 30%) border-box;
  -webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
}
```

约束：

- 只有直接承载内容的容器挂 `backdrop-filter`；嵌套标签不重复模糊。
- 高光透明度上限 `.16`；正文不得落在高光带。
- 移动端（`max-width:700px`）`--glass-blur` 降到 `10px`，非主面板改纯色半透明。
- `@supports not (backdrop-filter:blur(1px))` 分支必须回退到 `--bg-lift` 实色。

### 31.6 启动动画文字层（参考文件四件套，必须复刻）

结构（在现有 `startup-animation.js` 上改，不新建文件）：

1. 顶部元数据：左 `● INITIALIZING`，右 `STAGE 0N // <PHASE>`；等宽、`0.78rem`、`letter-spacing:.08em`、大写、`--ink-3` 色。
2. 中央词轮播：`overflow:hidden` 的 mask 内，`font-family:var(--display)`、`font-weight:400`、`font-style:italic`、`clamp(2rem,4.5vw,3.8rem)`、`--ink`；切换用 `translateY(±100%) + opacity`，每 1000ms，退场 360ms。
3. 底部进度条：高 `1px`、宽 `clamp(140px,22vw,280px)`、底 `--glass-line`、填充 `--accent`、`transform:scaleX()` 由 `requestAnimationFrame` 驱动（**必须走 31.2 的非线性映射**，不是线性）。
4. 底部计数器：`font-family:var(--display)`、`clamp(4.5rem,14vw,12rem)`、`font-weight:400`、`letter-spacing:-.04em`、`font-variant-numeric:tabular-nums`；单位 `%` 用 `--mono`、`--accent`、`vertical-align:super`。

四风格保留，仅换材质与文字层：

| 风格 | 背景 | 文字层差异 |
|---|---|---|
| `names` | SVG 流体拉幕 + 五列百叶（40ms 错峰）+ 中轴光闸 | 词轮播 + 计数器 + 进度条全开 |
| `orbital` | 同心环 188px + 18 粒子 | 词轮播 + 计数器，弱化进度条 |
| `scan` | 百叶 + 水平光带 3.4s 循环 | 标语点亮，保留计数器 |
| `minimal` | 无背景特效 | 仅 `W·` 标记 + 480ms 淡入，不挂计数器 |

时长不变：`TARGET_MS=8000`、`HARD_LIMIT_MS=12000`、预览 `3200/4200`。`prefers-reduced-motion` 下不创建任何动画节点。

### 31.7 批次切分与 CSS 区段所有权（防冲突硬约束）

`styles.css` 是唯一冲突热点，因此**按区段所有权并行**；只要各区段不重叠，git 三方合并可自动处理。任何批次不得越界。

| 批次 | 内容 | 独占文件/区段 | 依赖 |
|---|---|---|---|
| 11 | 字体工程（衬线族构建 + 入库） | `internal/panel/assets/fonts/**`（新增 5 个 woff2）、`styles.css` **仅 13 段**、`fonts_test.go` 字体清单 | 无 |
| 12 | token 与液态玻璃 | `styles.css` **仅 00/01/02 段** | 11（字体文件可后到，回退安全） |
| 13 | 启动动画文字层 | `startup-animation.js`、`styles.css` **仅 14 段**、`frontend_startup_test.mjs`、`frontend_animation_settings_test.mjs` | 12（依赖新 token 变量名，但变量名不变，可并行） |
| 14 | 页面版式与字阶落地 | `styles.css` **仅 03-11 段**、`index.html`（仅结构性 class 增删，不改 id） | 12 |

禁止事项：

- 不得重命名任何现有 CSS 变量（`--surface`、`--line`、`--radius`、`--font`、`--display` 等名字保持）。只允许改值与新增。
- 不得改任何 `.go` 业务代码（`fonts_test.go` 的字体清单除外）。
- 不得触碰 `third_party/meta/**`、`internal/metacore/**`、`internal/server/**`、`internal/reqlog/**`、Mihomo 二进制。
- 不得删除或弱化现有测试断言；只允许因新设计而**加强或改值**，并在回报中逐条说明。

### 31.8 验收门禁（批次 11-14 全绿才算完成）

```text
go build ./...
go test ./...
node --test internal/panel/*.mjs
```

外加浏览器实测（1440 / 1366 / 390 三档）：

- `getComputedStyle(document.querySelector('h2')).fontFamily` 必须命中 `Source Serif 4`。
- `document.fonts.check('16px "Source Serif 4"')` 与 `'16px "Noto Serif SC"'` 均为 true。
- 页面 `--accent` 计算值等于 `rgb(217, 119, 87)`（暗色）。
- 无横向滚动条（`document.documentElement.scrollWidth <= innerWidth`）。

---

## 32. 批次 15 之后的真实状态与剩余规划（2026-10-22 02:00 追加）

> 本节是对 §30/§31 的**事实更正与继续执行计划**。凡与前面冲突，以本节为准。

### 32.1 本次实测发现的两类严重问题

#### 32.1.1 启动动画在 56ms 被销毁（真实缺陷，非"没做"）

用 headless Chrome + CDP `Page.addScriptToEvaluateOnNewDocument` 打点，原始输出：

```text
["8 ready","47 session event","47 AUTH event","56 rm wb-startup-word is-active","56 rm wbStartup"]
```

链路：

1. 47ms：`initAuth()` 的 `refreshSession()` 发现 cookie 已存在，派发 `panel:session` 与 `panel:authenticated`。
2. 动画 DOM 正常创建（40+ 次 appendChild，含 `wbStartup` 根节点、`wb-startup-shutter`、`wb-startup-word`）。
3. 9ms 后（56ms）根节点被 `remove()`。

根因在 `internal/panel/assets/router.js:169-196`：

```js
const work = Promise.allSettled([loadCapabilities(), bootstrapAccounts(hardDeadline), preferencesPromise, animationStylePromise, refreshWork]);
const result = await withinStartupBudget(work, deadline);
...
if (values) { releaseStartupRefresh(); animation.destroy(); startup = null; return; }
```

`withinStartupBudget` 是 `Promise.race([work, 到 deadline 的 timer])`。当所有 promise 立刻 settle（登录页状态下各接口 400、或缓存命中），`result.timed_out` 为 undefined，`values` 为真值，于是走"数据已就绪 → 立即销毁动画"的快路径。

**这直接违背用户明确要求："我给的动画要设定一个最短的时间，也就是必须跑完那一个完整动画"。**

修复要点（批次 17）：

- 数据就绪后必须补等 `deadline - Date.now()`（`TARGET_MS = 8000`）。
- 删除 189-196 的快路径分支，所有情况统一走 `setPhase('syncing') → go() → 360ms 退场`。
- `startupSession === authToken` 用 csrf_token 去重的语义也要换掉（同一会话内二次派发被静默跳过）。
- 登录页在动画期间隐藏（`body.is-booting`），解决"割裂"。

#### 32.1.2 批次 16 把批次 15 的导航修复整体回滚（流程事故）

批次 16 从 `e59043d` 分出，批次 15 从同一基线并行，批次 15 先合入 `main`。直接 merge 批次 16 会把 `.shell` / `.nav` / 滚动条规则改回旧值，测试断言也被改回 `padding: 16px 20px`、`nav padding: 26px 16px`。

这是用户反复看到"导航又坏了 / 又出现白色拖动条"的直接原因。

处置（已完成）：

- 只从批次 16 取 `egress.js` / `index.html` / `frontend_egress_filter_batch_e_test.mjs`。
- `styles.css` **只按段拼接 06 egress 段**，01/03/11 段保留批次 15 的修复。
- `frontend_v02_test.mjs` 的 `text-overflow/white-space` 禁令收窄为"06 段之外的全文"，而不是整文件。
- 合并提交 `73a4297`。
- 验证：`node --test` 124/124 通过，`go build ./...` exit 0。

**流程规则（新增，必须遵守）：**

1. 每个批次开工前先 `git fetch` 主仓库，基于**当时最新 main** 建 worktree。
2. 回报中必须写明基线 commit。
3. 主助手合并时**不允许 `git merge` 整个分支**，必须检查 `git diff --stat` 是否触碰了其它批次的所有权范围。
4. `styles.css` 一律按段（00-14）拼接，不整文件覆盖。

### 32.2 已合入 main 的批次（真实记录）

| 批次 | 内容 | commit |
|---|---|---|
| 15 | 导航贴边、杀白色滚动条、行高 41px | `40b212a` → `d1c9638`（去 CRLF 重提） |
| 16 | 出口页节点延迟、详情区、多订阅来源 | `3e2d911` → `73a4297`（仅 egress 段） |

### 32.3 剩余批次与拆分（防冲突）

| 批次 | 内容 | 独占范围 | 状态 |
|---|---|---|---|
| 17 | 启动动画最小时长 + 登录页时序 + 事件去重 | `router.js`、`auth.js`、`startup-animation.js`、`styles.css` 14 段、`index.html` 的 `body`/`#authVeil` 属性 | 进行中 |
| 18 | 视觉根基：流动背景 + 玻璃四层 + 提示条去黄 + 字阶 + 登录页两栏 | `styles.css` 00/01/02 段、`index.html` 的 `#authVeil` 内部 | 进行中 |
| 19 | 概览页：圆环左置 + 图例进度条 + 昼夜扩散重做 | `overview.js`、`index.html` 概览段、`styles.css` 04 段 | 待开工 |
| 20 | 模型页精简 + 禁用交互 + 拉取 | `models.js`、`model-policy.js`、`styles.css` 08 段 | 待开工 |
| 21 | 错误记录收敛为"仅错误 + 点开弹窗" | `logs.js`、`index.html` 日志段、`styles.css` 09 段 | 待开工 |
| 22 | 全站小字清理 + 三档响应式验收 + 性能预算 | 各页 `.hint` 清理、`styles.css` 11 段 | 待开工 |
| 23 | VM 部署与回滚演练 | `deployment/`、systemd unit | 待开工 |

### 32.4 依赖顺序

```text
17 ─┬─> 19 ─┐
    │       ├─> 22 ─> 23
18 ─┴─> 20 ─┤
       21 ──┘
```

- 17 与 18 可并行（文件不重叠：17 只碰 14 段与 JS，18 只碰 00/01/02 段）。
- 19/20/21 必须在 18 合入后开工（依赖新 token 与新玻璃实现）。
- 22 必须在 19/20/21 全部合入后开工（要扫全站 `.hint`）。
- 23 最后。

### 32.5 每批次的验收门禁（统一）

```text
go build ./...                        -> exit 0
node --test internal/panel/*_test.mjs -> 全绿（当前基线 124/124）
```

加真实浏览器实测（禁止用内嵌浏览器，其 DOM 被 mock）：

- 启动动画：DOM 停留 ≥ 7900ms，`rm wbStartup` 只在 ≥8000ms 后。
- 玻璃：`getComputedStyle(card).backdropFilter` 含 `blur`。
- 提示条：`getComputedStyle(#demoNotice).backgroundColor === 'rgba(0, 0, 0, 0)'`。
- 导航：`.nav a.on` 无 `background`，有 2px 左侧竖线。
- 响应式：1600 / 1280 / 390 三档 `scrollWidth === clientWidth`。

`go test ./...` 在沙箱下会因本地 socket / 临时文件重命名失败，属环境限制；必须在回报中标注失败用例名与报错原文，不得改测试跳过。

### 32.6 Git 纪律（重申）

- 基线标签 `baseline-ui-redesign`（`29bd811`）保留，任何批次出问题可 `git reset --hard` 回去。
- 每批次一个分支 + 一个 commit；主助手合并时按段拼接。
- 提交前必须：`git diff --numstat` 检查是否只有预期文件；确认没有 CRLF 整文件重写。
- 不得提交临时脚本（`*.cjs`、`*.mjs` 探针）到仓库根目录。

### 32.7 用户已确认、不得再改口径的项

1. 圆环放左侧，图例在右；图例每行要有进度条。
2. 桌面用悬浮导航栏，全局液态玻璃。
3. 出口页：节点是"小方框"，名称后直接跟延迟；点击即绑定，不要"绑定节点"按钮。
4. 订阅链接支持多条，明文只在弹窗里看。
5. 节点延迟统一用上次缓存，48h 或手动刷新。
6. 到期分布最长只显示 30 天，超过的屏蔽。
7. 错误记录只留错误，不要运行记录，不要汇总统计。
8. 全站禁止解释性小字（`.hint` 只允许承载数据，不承载说明）。
9. 动画文字必须用衬线斜体英文 AI 名 + 等宽大写标签 + 衬线大计数器 + 非线性进度。
10. 字体全部同源 woff2，不引远程。