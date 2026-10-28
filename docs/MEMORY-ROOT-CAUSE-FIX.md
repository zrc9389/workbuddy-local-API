# Responses 请求链路内存根因与修复设计

## 根因（生产调用链）

`Handler.ServeHTTP` 先经 `admit` 做准入与压力 spool，但普通请求仍可能继续从内存 body 进入 `Handler.responses`。`decodeResponsesRequest` 使用 `json.Decoder.Decode(&map[string]any)`，长文本、图片 URL/base64、工具参数及 metadata 均以完整字符串/对象驻留。`buildChatRequestFromResponses` 随后克隆历史、转换输入和工具到新的 map/slice，再对整份 Chat 请求 `json.Marshal`，形成另一个完整 messages JSON。

Responses 再用 `httptest.NewRecorder` 调用 `chatCompletions`。Recorder 将 Chat 响应整包保存在 bytes.Buffer；随后 `json.Unmarshal` 再构造一份响应 map，`chatResponseToResponses` 又复制输出和历史消息。非流式响应最终还要编码，流式响应则先等上游完成、构造整份 Responses 对象，再发事件。客户端断开无法在上游聚合期间及时取消。

严格历史 `ValidateStrictHistoryReader` 虽接受 reader，但 `json.Decoder` 将所有 message、tool call 反序列化到 slice；`conversation.Store` 又以 `json.RawMessage` 缓存、复制，并在持久化归档时 `Compact` 与 `Marshal` 整包。易失 history 的默认 32 MiB 配额触发时返回 507，这是历史业务约束，不是临时 spool 资源错误。

既有独立进程基线只覆盖测试 Handler：Responses 128 MiB × 8 时服务 heap 峰值约 8.79 GiB、RSS 约 8.82 GiB。该基线没有客户端/代理独立 RSS 记录；夹具内存不计入服务数据。

## 替换设计

1. 准入阶段把每个原始请求流式写入私有 spool，使用固定大小缓冲同步计算 SHA-256；完成前不派发。达到请求/磁盘配额返回 413/507 的资源错误，文件创建、写入、同步或 receipt 失败返回独立存储错误。请求体重放使用 spool 文件句柄。
2. Responses 使用有界 JSON 词法扫描器，只把 model、布尔/数值选项、ID 和顶层属性区间索引保存在内存。长文本、图片/base64、工具 schema/参数保留源文件 byte range，以流复制到转换输出；禁止把这些字段解码成 Go string、`json.RawMessage` 或完整 map。未知字段按兼容策略保留原始区间，不能保留时明确返回 unsupported。重复键遵守 JSON 解码器最后值语义；语法、深度、字段数和偏移均需受限。
3. 持久历史以记录文件作为事实来源；启动/读取时用有界缓冲扫描 JSON，索引 message 与 tool-call 关键字段，strict 检查维持 orphan/duplicate/incomplete 规则。读取时按范围复制消息，避免完整 `[]map` 与 RawMessage 缓存；易失模式超过业务预算继续明确返回 history business limit，不截断旧历史。
4. Chat 转写输出写到受限临时文件或 `io.Pipe`，每条消息和大字段逐段编码，不创建完整 `messages` map/JSON 副本。下游请求取消须关闭 pipe 并取消上游。
5. Responses 输出使用编码器向 `io.Pipe`/HTTP 流逐事件写入；不经 `httptest.ResponseRecorder`。下游写错误立即取消内部请求并停止上游读取。非流式也允许受控私有临时文件缓冲，但限制清晰且响应不能静默截断。
6. 错误分类稳定区分 history business limit（507）、spool quota/resource exhaustion（507 或 413，含错误码）、spool storage I/O（500），不通过放大预算或丢历史消除。

## 迁移边界与验收

端到端验收覆盖图片/base64与长文本输入、工具字段保真、stream 与 non-stream；记录原始输入、转写上游请求及最终响应的 SHA-256，并检查服务进程 heap/RSS、临时文件上界及请求结束后的清理。客户端、上游夹具与代理必须独立进程采样。运行完整 Go 测试、vet、Linux 普通/no_logs 构建及当前前端/API 测试。修复前后数字采用同等的独立服务进程场景；不把测试夹具分配计入服务。尚未迁移路径必须在交付报告中逐项列明。

## 2026-10-28 主会话复核状态

本轮先恢复了 `internal/server/responses.go` 与当前 `RequestPayload`/pressure spool 接口一致的候选版本，并通过 `go test ./...`、`go vet ./...`。当前生产路径的真实状态如下：

- 已有：Chat 入站大请求使用私有临时文件，读取使用固定前缀和重复打开句柄；pressure spool 自带 receipt、大小校验和 SHA-256 完整性校验；Responses 解码使用 reader 并检查多 JSON 值。
- 已有：Responses stream 只有完整转换和事件写入成功后才提交 pressure spool；history 超过易失预算仍返回 `history_working_budget`/`history_storage_failed`，不会截断旧历史。
- 未完成：Responses 入站仍是 `map[string]any` 全量解码；`buildChatRequestFromResponses` 仍构造完整 Chat map 并 `json.Marshal`；Chat 内部仍通过 `httptest.ResponseRecorder` 聚合响应；strict history reader 仍将 messages 解码到切片；响应端尚未完成 io.Pipe/事件流取消联动。
- 未完成：本轮没有产生修复后独立服务进程 heap/RSS 曲线，也没有完成输入/输出 hash 贯穿记录、图片/长文本端到端 stream/non-stream 验收或新的临时文件清理证据。不得把当前状态标记为内存根因修复完成。

因此本文件记录的是复核边界和未迁移路径，不能作为生产内存优化完成证明。后续仍需先实现有界 JSON 区间扫描与文件流转写，再进行小规模回归和独立进程采样；禁止重复 128 MiB×8 压测。
