# 模块与依赖

## 决策
- 模块化Go单体，嵌入原生ES modules；不引入微服务或运行时Node依赖。
- 入站唯一可信边界是 localauth.Wrap：TCP回环、Host/Origin、管理会话/CSRF。server/panel业务处理器不应独立暴露为生产入口。
- api_key已从运行配置、面板和livecfg移除；旧配置键仅被忽略且保存时清理，不形成备用管理员入口。
- Panel保留完整业务底座；VPS独有能力按模块迁入，不复制其整份handler。

## 依赖方向
cmd/server（组装）→ localauth / server / panel / tasks / scheduler / logservice
server → pool / session / conversation / upstream / modelpolicy / resource / usage / telemetry
panel → tasks / egress / pool / usage / telemetry / upstream
scheduler → pool / upstream；通过注入回调调用同一 tasks.Service
logservice → reqlog → telemetry；no_logs 时 logservice → telemetry.Noop
前端 → 同源API客户端 → 管理HTTP接口，不直接持有上游凭证

## 目录职责
- auth：凭证及代理字段、原子保存与导入并发保护。
- pool：成本/健康/并发/临期/模型限流调度，保留原测试。
- upstream：账号感知传输、协议适配与上游业务调用。
- egress：有界手动探测和快照，不自动轮询外网。
- tasks：动作、队列、扫描、账号锁；HTTP适配独立文件，不依赖panel。
- conversation：多轮历史TTL/LRU/容量/持久化事务。
- session：会话绑定，账号健康优先于粘性，本地定期/退出落盘。
- modelpolicy：启停与展示覆盖，裸名与cn:共享策略，global独立。
- resource：请求预算和响应读取限制；Go内存目标不是硬上限。
- telemetry：数据契约/空实现；reqlog为可替换的有界归档模块。
- usage：用量汇总，不能依赖是否启用日志。
- panel/assets：账号行/筛选/批量操作、登录、网络、路由、各视图分模块。

## 已知取舍
Responses仍为聚合适配；历史持久化同步保存确保成功响应前可读，写盘失败回滚内存并返回错误。HTTP任务取消不强制中止旧上游多步骤流程。账号库规模未经过真实千号负载测试。Docker仅给Linux宿主网络示例，Windows以原生exe为验收对象。
