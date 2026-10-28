# 当前几何前端 API 契约

本清单从 internal/panel/assets/*.js 的实际 api()/request() 调用提取。路径均为同源 /panel/api/ 相对路径；除登录外，写请求由 assets/api.js 统一携带管理会话 Cookie 和 X-CSRF-Token。动态 UID 按前端 encodeURIComponent 编码。这个契约只覆盖当前模块化几何前端，不覆盖旧面板或未调用的兼容路由。

| 方法 | 路径/查询 | 请求字段 | 前端读取的响应字段 |
|---|---|---|---|
| GET | overview | 无 | accounts, total, healthy, cooling, disabled, paused, in_flight, demo |
| GET | capabilities | 无 | 能力开关 |
| GET | packages | 无 | accounts[]: uid, nickname, realm, remain, size, packages[], error |
| GET | usage?hours=0 | hours=0 | totals, series[], by_account[], by_model[], by_realm[], credit_by_account[], credit_by_model[] |
| GET | maintenance/status | 无 | running, steps[], last_run_at, last_result |
| POST | maintenance/run | 空 JSON {} | 同维护状态快照；冲突可为 HTTP 409 |
| GET/POST | session/bootstrap[ /status] | POST 空 JSON {} | 启动状态字段 |
| GET | meta/status | 无 | available, running, error |
| GET | meta/stats | 无 | 流量、速率、连接数、sampled_at, estimated |
| GET | meta/nodes[?subscription_id=ID] | 可选查询 subscription_id | nodes[], bindings[] |
| GET/POST | meta/tests | POST 空 JSON {} | running, started_at, finished_at, total, completed, failed, results[]；重复启动可 409 |
| GET/POST | meta/subscriptions | GET 无；POST 导入 {url,name?} 或操作 {action,id,enabled?} | subscriptions[]、导入 nodes、刷新结果 |
| POST | meta/accounts/{uid}/bind | {node} | ok |
| GET | models | 无 | models[], cached, stale, cache_age_seconds |
| GET | model_probes | 无 | probes |
| POST | models/refresh | 空 JSON {} | ok, models[], cached, stale, cache_age_seconds, cooldown_seconds |
| GET/POST | model_policy | POST {id,disabled,context_length,...patch} | models |
| GET/POST | preferences | POST {credit_guard_low,theme,animation_style?} | credit_guard_low, theme, animation_style |
| GET | request_metrics | 无 | archive.enabled, recent[] |
| GET | request_logs?summary=1&limit=1000 | 查询 summary, limit | entries[] |
| GET | request_logs?id=ID | 查询 id | entry |
| POST | accounts/{uid}/remove | 空 JSON {} | ok |
| POST | accounts/{uid}/toggle_disabled | {disabled} | ok |
| POST | login/start | {realm} | state, url |
| GET | login/poll?state=STATE | 查询 state | done, nickname, uid, realm, credits, credits_total |
| POST | import/cockpit | multipart file | imported, skipped, errors[] |
| POST | refresh | 空 JSON {} | ok, components |
| GET | /auth/session | 无 | authenticated, csrf_token, default_password |
| POST | /auth/login | {password} | authenticated, csrf_token, default_password |
| POST | /auth/logout | 空 body | 成功状态 |
| POST | /auth/password | {old_password,new_password} | 成功状态 |

assets/geometric.js 中保留的历史兼容音乐写入直接调用 POST /panel/api/customization，body 为 {customization}，并设置同源 Cookie、CSRF token 与 JSON Content-Type。自动更新接口保持 HTTP 501。

