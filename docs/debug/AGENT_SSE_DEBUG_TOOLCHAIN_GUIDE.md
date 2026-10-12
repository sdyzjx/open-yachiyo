# Agent SSE 调试工具链使用手册

版本：v1  
日期：2026-03-01  
适用分支：`codex/logger-sse-mvp`

## 1. 文档目标

本文档用于指导后续开发 Agent 在本项目中使用 `Gateway WS + SSE Debug Stream` 进行联调与排障，重点覆盖：

1. 如何调用每个调试相关 API。
2. 如何观察一条请求在系统中的完整调用链。
3. 如何新增调试点并保证可追踪性。
4. 如何根据症状快速定位故障层级。

## 2. 系统调试架构

调试链路由两条通道组成：

1. 主执行通道：`WebUI/Electron/Agent -> WS /ws(runtime.run) -> Queue -> Worker -> Loop -> Dispatcher -> Executor -> WS 响应`。
2. 旁路观测通道：`RuntimeEventBus -> DebugEventStream(SSE) -> WebUI Debug 面板 / curl 订阅端`。

关键含义：

1. 主执行通道决定业务结果。
2. SSE 旁路只用于观测，不影响主流程。
3. 任何端（WebUI/Electron/Agent）都可通过 `POST /api/debug/emit` 注入自定义调试事件。

## 3. 调试前置条件

执行任何调试步骤前，先确认：

1. Gateway 正常启动并可访问 `http://127.0.0.1:3000/health`。
2. 使用者知道当前请求的 `session_id`（若没有则可在运行时自动生成）。
3. 调试模式已打开（见 4.3 节）。

快速检查命令：

```bash
curl -s http://127.0.0.1:3000/health | jq
```

检查字段：

1. `ok: true`
2. `debug_stream.enabled: true`
3. `debug_stream.debug_mode: true/false`
4. `debug_stream.clients`
5. `queue_size`

## 4. API 端点手册

### 4.1 GET /api/debug/events

用途：建立 SSE 长连接，持续接收调试事件。

请求参数：

1. Query `topics`（可选）：逗号分隔 topic 过滤列表。
2. `topics` 当前按精确匹配处理，建议直接填完整 topic 名称。
3. Query `token`（可选）：当服务端启用 `DEBUG_STREAM_BEARER_TOKEN` 时可通过 query 传 token。
4. Header `Authorization: Bearer <token>`（可选）：同上，服务端启用 token 时可用。
5. Header `Last-Event-ID`（可选）：用于断线续传，从 ring buffer 回放后续事件。

调用示例（全量订阅）：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events"
```

调用示例（按 topic 过滤）：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.gateway.ws.inbound,chain.worker.runner.completed"
```

调用示例（带 token）：

```bash
curl -N -H "Authorization: Bearer YOUR_TOKEN" \
  "http://127.0.0.1:3000/api/debug/events?topics=chain.gateway.ws.inbound,chain.gateway.ws.outbound,chain.gateway.enqueue.start,chain.gateway.enqueue.accepted,chain.gateway.enqueue.rejected"
```

调用示例（从事件 120 后续传）：

```bash
curl -N -H "Last-Event-ID: 120" \
  "http://127.0.0.1:3000/api/debug/events?topics=chain.worker.envelope.start,chain.worker.runner.start,chain.worker.runner.completed,chain.worker.runtime.final_sent"
```

SSE 事件格式（示意）：

```text
id: 431
event: log
data: {"id":"431","event":"log","topic":"chain.worker.runner.completed","ts":1740750000000,"payload":{"trace_id":"...","session_id":"...","source_file":"apps/runtime/rpc/runtimeRpcWorker.js"}}
```

排障提示：

1. `401 unauthorized`：token 校验失败或缺失。
2. `429 too many connections`：单用户连接超限。
3. `503 debug stream is full`：全局连接超限。
4. 仅收到心跳、无业务日志：通常是 `debug_mode=false` 或 topic 过滤过严。

### 4.2 GET /debug/stream

用途：`/api/debug/events` 的别名，行为完全一致。

示例：

```bash
curl -N "http://127.0.0.1:3000/debug/stream?topics=chain.queue.submit.accepted,chain.queue.submit.rejected,chain.queue.pop.dequeued"
```

### 4.3 GET /api/debug/mode

用途：读取当前 debug 开关状态。

示例：

```bash
curl -s http://127.0.0.1:3000/api/debug/mode | jq
```

返回示例：

```json
{
  "ok": true,
  "data": {
    "debug": true
  }
}
```

### 4.4 PUT /api/debug/mode

用途：开关全局 debug 产出（`chain.*`、`shell.exec.*` 等关键流事件依赖该开关）。

示例（开启）：

```bash
curl -s -X PUT http://127.0.0.1:3000/api/debug/mode \
  -H "content-type: application/json" \
  -d '{"debug":true}' | jq
```

示例（关闭）：

```bash
curl -s -X PUT http://127.0.0.1:3000/api/debug/mode \
  -H "content-type: application/json" \
  -d '{"debug":false}' | jq
```

错误示例：

1. `400 body.debug must be boolean`：传参非布尔。

### 4.5 POST /api/debug/emit

用途：主动注入调试事件。用于 WebUI/Electron/外部 Agent 自定义埋点。

请求体字段：

1. `topic`（必填）：事件主题。
2. `msg`（必填）：简要文本。
3. `event`（可选，默认 `log`）：事件类型。
4. `level`（可选，默认 `info`）：日志级别。
5. 其他任意字段（可选）：会进入 payload（如 `trace_id`、`session_id`、`source_file`）。

示例：

```bash
curl -s -X POST http://127.0.0.1:3000/api/debug/emit \
  -H "content-type: application/json" \
  -d '{
    "event":"log",
    "topic":"chain.agent.turn.start",
    "msg":"agent turn started",
    "trace_id":"trace-001",
    "session_id":"sess-001",
    "source_file":"apps/agent/orchestrator.js"
  }' | jq
```

返回：

```json
{
  "ok": true,
  "id": "912"
}
```

### 4.6 POST /debug/emit

用途：`/api/debug/emit` 别名，行为一致。

### 4.7 WS /ws（JSON-RPC 调用主入口）

用途：触发实际 runtime 流程，供 SSE 观测完整链路。

请求（`runtime.run`）示例：

```json
{
  "jsonrpc": "2.0",
  "id": "req-1001",
  "method": "runtime.run",
  "params": {
    "session_id": "sess-001",
    "input": "请帮我检查当前工具调用是否成功",
    "permission_level": "medium",
    "input_images": []
  }
}
```

通知/响应示例：

1. `runtime.start`：请求被 worker 接受并进入执行。
2. `runtime.event`：中间事件（tool.call / tool.result / llm.final 等）。
3. `runtime.final`：最终输出。
4. JSON-RPC result：包含 `trace_id`、`state`、`output`。

## 5. 推荐调试流程（可直接执行）

### 5.1 一次完整联调

步骤：

1. 开 debug 模式。
2. 开两个终端：一个订阅 SSE，一个发送 runtime.run。
3. 用 `trace_id` 串起整条链。

终端 A（订阅）：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.webui.ws.sent,chain.electron.run.start,chain.gateway.ws.inbound,chain.gateway.enqueue.start,chain.queue.submit.accepted,chain.queue.pop.dequeued,chain.worker.runner.start,chain.loop.decide.completed,chain.dispatch.received,chain.executor.completed,chain.worker.runner.completed,chain.gateway.ws.outbound,chain.webui.ws.final,chain.electron.run.completed"
```

终端 B（开 debug）：

```bash
curl -s -X PUT http://127.0.0.1:3000/api/debug/mode \
  -H "content-type: application/json" -d '{"debug":true}'
```

终端 C（发请求，示意，按你的客户端实现发送到 /ws）：

1. 发送 `runtime.run`。
2. 观察终端 A 是否按顺序输出关键节点。

### 5.2 关键字段怎么用

定位时优先看：

1. `trace_id`：串联单次推理与工具调用。
2. `session_id`：区分会话上下文。
3. `request_id`：关联一次 RPC 请求。
4. `source_file`：直接定位代码来源文件。
5. `source_line/source_col`：定位具体触发行（若可用）。

## 6. 调用链排障剧本（Playbook）

### 6.1 现象：前端点击发送后无任何结果

订阅 topics：

```text
chain.webui.ws.sent,chain.webui.ws.connected,chain.webui.ws.closed,chain.webui.ws.error,chain.webui.ws.final,chain.gateway.ws.inbound,chain.gateway.ws.parse_error,chain.gateway.ws.invalid_request,chain.gateway.ws.outbound,chain.gateway.enqueue.start,chain.gateway.enqueue.accepted,chain.gateway.enqueue.rejected
```

判定路径：

1. 有 `chain.webui.ws.sent`，无 `chain.gateway.ws.inbound`：网络或 ws 连接问题。
2. 有 `inbound`，无 `enqueue.accepted`：参数校验失败或权限字段非法。
3. 有 `enqueue.rejected`：看 `reason/error` 定位（空输入、图片超限、queue 满等）。

### 6.2 现象：Gateway 收到但长时间无 final

订阅 topics：

```text
chain.gateway.enqueue.start,chain.gateway.enqueue.accepted,chain.gateway.enqueue.rejected,chain.queue.submit.accepted,chain.queue.submit.rejected,chain.queue.pop.dequeued,chain.worker.envelope.start,chain.worker.runner.start,chain.worker.runner.completed,chain.worker.runtime.final_sent,chain.loop.start,chain.loop.decide.start,chain.loop.decide.completed,chain.loop.tool.requested,chain.loop.tool.waiting_result,chain.loop.tool.result_received,chain.loop.final,chain.loop.error
```

判定路径：

1. `queue.submit.accepted` 无 `queue.pop.dequeued`：worker 未消费，检查 worker 生命周期。
2. 到 `worker.runner.start` 但没有 `worker.runner.completed`：loop 内部阻塞或下游超时。
3. 仅见 `loop.tool.waiting_result`：tool.result 未返回，检查 dispatcher/executor/tool adapter。

### 6.3 现象：工具调用失败

订阅 topics：

```text
chain.loop.tool.requested,chain.loop.tool.waiting_result,chain.loop.tool.result_received,chain.dispatch.received,chain.dispatch.completed,chain.executor.start,chain.executor.completed,tool.call.requested,tool.call.dispatched,tool.call.result
```

判定路径：

1. `dispatch.received` 无 `executor.start`：dispatcher 流程中断。
2. `executor.completed ok=false`：直接看 `error/code`。
3. `tool.call.result` 报错：看具体工具参数与权限策略。

### 6.4 现象：runtime.final 已产生但 UI 没渲染

订阅 topics：

```text
chain.gateway.ws.outbound,chain.webui.ws.final,chain.electron.notification.received,chain.electron.ui.output_rendered
```

判定路径：

1. 有 `gateway.ws.outbound` 无 `webui.ws.final`：前端 ws 处理异常。
2. Electron 有 `notification.received` 无 `ui.output_rendered`：主进程 UI 分支未执行或 output 为空。

## 7. 调试点插入规范（给后续 Agent）

### 7.1 topic 命名规范

统一使用：`chain.<layer>.<action>.<status>`。

示例：

1. `chain.agent.turn.start`
2. `chain.agent.plan.completed`
3. `chain.agent.tool.exec.failed`

### 7.2 字段规范

建议至少包含：

1. `trace_id`
2. `session_id`
3. `request_id`（若有）
4. `step_index`（多步推理时）
5. `source_file`

失败事件必须包含：

1. `error`
2. `code`（若有）

### 7.3 后端埋点示例（Runtime 层）

```js
publishChainEvent(bus, 'agent.plan.start', {
  trace_id,
  session_id,
  request_id,
  source_file: 'apps/agent/orchestrator.js'
});
```

说明：

1. 若不手动传 `source_file`，链路函数会自动注入调用源信息。
2. 手动传值可覆盖自动值，用于包装函数场景。

### 7.4 前端/Electron/外部 Agent 埋点示例

```bash
curl -s -X POST http://127.0.0.1:3000/api/debug/emit \
  -H "content-type: application/json" \
  -d '{
    "topic":"chain.agent.tool.exec.start",
    "msg":"tool execution started",
    "trace_id":"trace-001",
    "session_id":"sess-001",
    "tool_name":"shell.exec",
    "source_file":"apps/agent/client.js"
  }'
```

## 8. 常用 topics 预设

全链路（推荐联调）：

```text
chain.webui.ws.sent,chain.webui.ws.connected,chain.webui.ws.closed,chain.webui.ws.error,chain.webui.ws.event,chain.webui.ws.error_message,chain.webui.ws.final,chain.electron.ensure_session.start,chain.electron.ensure_session.completed,chain.electron.run.start,chain.electron.run.completed,chain.electron.run.error,chain.electron.ws.connected,chain.electron.ws.sent,chain.electron.ws.error,chain.electron.ws.closed,chain.gateway.ws.inbound,chain.gateway.ws.outbound,chain.gateway.enqueue.start,chain.gateway.enqueue.accepted,chain.gateway.enqueue.rejected,chain.queue.submit.accepted,chain.queue.submit.rejected,chain.queue.pop.dequeued,chain.worker.envelope.start,chain.worker.runner.start,chain.worker.runner.completed,chain.loop.start,chain.loop.decide.completed,chain.loop.tool.requested,chain.loop.tool.result_received,chain.dispatch.received,chain.dispatch.completed,chain.executor.start,chain.executor.completed,runtime.event,tool.call.requested,tool.call.result,shell.exec.stdout,shell.exec.stderr,shell.exec.exit
```

仅 RPC 主链路：

```text
chain.gateway.ws.inbound,chain.gateway.enqueue.start,chain.gateway.enqueue.accepted,chain.gateway.enqueue.rejected,chain.queue.submit.accepted,chain.queue.submit.rejected,chain.queue.pop.dequeued,chain.worker.envelope.start,chain.worker.runner.start,chain.worker.runner.completed,chain.loop.start,chain.loop.decide.completed,chain.loop.tool.requested,chain.loop.tool.result_received,chain.dispatch.received,chain.dispatch.completed,chain.executor.start,chain.executor.completed,chain.gateway.ws.outbound
```

仅错误排查：

```text
chain.gateway.enqueue.rejected,chain.worker.envelope.rejected,chain.loop.error,chain.executor.completed
```

## 9. 质量与安全要求

1. 禁止上报密钥：`api_key/token/secret`。
2. 大文本输出需截断后再上报，避免 SSE 面板阻塞。
3. 高频埋点要可按 topic 独立过滤，避免污染全局流。
4. 合并前必须自测：`debug_mode=true/false` 两种路径都要通过。

## 10. 交付检查清单

后续 Agent 在提交调试改动前，请确认：

1. 新增埋点 topic 命名符合规范。
2. 每个关键节点都能通过 SSE 看到。
3. 至少一次端到端请求可串出完整 `trace_id`。
4. 文档中补充了新增 topic 与排障方式。
