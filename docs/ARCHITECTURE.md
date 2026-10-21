# v0.2 模块与依赖

## 边界
Go模块化单体+原生ES modules；内核为独立Mihomo进程，不启TUN或系统代理。管理认证仍统一在localauth边界，业务模块不自行开放监听。前端仅通过受会话/CSRF保护的窄HTTP接口取数与操作，不持有账号token或内核secret。

## 依赖
- cmd/server：组装、生命周期、只绑定回环、模式隔离、软内存目标。
- server：Chat/Responses适配、严格历史检查、资源准入、spool、用量与可选事件接口。
- pool：手动禁用、已知余额保护、冷却/熔断、按模型健康、成本/临期选号；手动状态与系统状态正交。
- maintenance：唯一四步骤编排和每账号结果；没有定时器、UI依赖。传统scheduler/tasks代码为兼容保留，但生产入口不启动自动排程。
- metacore：固定校验sidecar、controller、provider、独立入口/选择组、测速、流量快照、租约和闲置退出。与auth/upstream/panel通过接口联动。
- upstream：所有账号网络请求共享代理选择与AccountLease；响应Body.Close才释放。严格模式先拒绝不完整工具历史，不依赖兼容清理丢弃内容。
- conversation：持久manifest+独立记录文件，热缓存TTL/LRU不删除磁盘；sha256校验、磁盘额度、旧格式迁移；Clear切换代次，旧文件手动清理。
- spool：有界磁盘请求暂存、receiving/queued/dispatch_intent/committed/unknown元信息；unknown绝不自动重放。
- resource：原始body预算、保守工作预算、并发和响应读取上限；不是操作系统内存硬限制。
- usage：独立汇总；telemetry接口由logservice接reqlog或Noop，no_logs不依赖归档包。
- demo：只在-demo下组装本地模拟upstream、显式假账号与动态日志；Meta自带Demo engine，页面明确标记。
- panel/assets：页面/网络/认证/主题/弹层/分页按职责拆分；无搜索筛选；概览内容留空。
- third_party/meta：固定版本内核来源/校验/许可，以及真正复用的metacubexd趋势helper（不是整个dashboard）。

## 重要契约
同账号节点切换仅影响新连接，已有流保持；新入口/订阅配置重载需要安全空闲条件。删除账号先解绑Meta，繁忙则409。管理员默认123456可改密，但本机其他进程仍可能访问免key聊天。

完整档案不代表无限上下文：档案可恢复，工作预算/上游限制不足时明确拒绝，不能静默截断并回200。当前尚有整包JSON转换和磁盘完整前缀写放大，不宣传任意体量可承载。详情见V02-STATUS和V02-VALIDATION。
