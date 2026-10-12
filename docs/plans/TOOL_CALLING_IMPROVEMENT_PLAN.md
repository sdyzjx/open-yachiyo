# Tool Calling 改进方案（feature/tool-call）

## 当前状态（已实现）

- ToolLoopRunner 支持单轮 1 个 tool call，并等待 `tool.call.result`
- ToolExecutor 支持本地工具执行
- Dispatcher 已把 `tool.call.requested` 分发为 `tool.call.result`
- OpenAIReasoner 已支持 `tool_choice:auto` 并可解析第一个 tool call

## 关键缺口

1. **仅支持首个 tool call**
   - 当前 `message.tool_calls?.[0]`，多工具并发/串行能力缺失
2. **无参数校验层**
   - 未按 schema 做 required/type 校验
3. **无权限与风险分级**
   - 工具没有 `risk_level` / allowlist
4. **错误可恢复性不足**
   - 工具失败直接 ERROR，缺少重试与降级策略
5. **无 background tool 标准协议**
   - 缺 task_id 约定、状态查询、完成回调规范
6. **上下文回灌偏原始**
   - tool result 未做结构化摘要，长输出可能污染上下文

## 目标能力（P0->P2）

### P0.1（立即）
- 支持 `tool_calls[]` 全量解析（串行执行）
- 引入 `ToolCallEnvelope` 统一结构：
  - `call_id`, `name`, `args`, `timeout_ms`, `retry`, `idempotency_key`
- 参数校验：基于 JSON Schema（Ajv）

### P0.2（稳定）
- 执行策略器 `ExecutionPolicy`
  - `max_parallel`, `default_timeout_ms`, `max_retries`
- 错误分类：
  - `VALIDATION_ERROR` / `TOOL_NOT_FOUND` / `TIMEOUT` / `RUNTIME_ERROR`
- Tool result 标准化：
  - `{ ok, data, error, metrics }`

### P1（可观测 + 可恢复）
- Trace 增强：
  - `tool.call.started`, `tool.call.finished`, `tool.call.failed`
- 结果压缩器：
  - 长文本摘要后回灌 LLM，原始结果保存在 session-store
- 失败恢复：
  - 重试 + fallback tool + graceful final answer

### P2（高级）
- Background Tool 协议：
  - `task.submit`, `task.progress`, `task.completed`, `task.failed`
- 权限模型：
  - tool级 ACL（会话/用户/环境）
- MCP / Handoff 对齐统一执行契约

## 建议代码改造点

- `apps/runtime/llm/openaiReasoner.js`
  - 从单个 tool call 改为 `tool_calls[]` 返回
- `apps/runtime/loop/toolLoopRunner.js`
  - 支持一步多调用（先串行，后并行）
- `apps/runtime/executor/toolExecutor.js`
  - 增加 schema 校验、超时、重试
- `apps/runtime/orchestrator/toolCallDispatcher.js`
  - 增加标准化结果对象与 metrics

## 最小 API 草案

```json
{
  "call_id": "uuid",
  "name": "string",
  "args": {},
  "timeout_ms": 8000,
  "retry": 1,
  "idempotency_key": "optional"
}
```

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "metrics": {
    "latency_ms": 123,
    "retries": 0
  }
}
```

## 本分支建议下一步

1. 先做 `tool_calls[]` 全量解析 + 串行执行（低风险高收益）
2. 接入 Ajv 参数校验
3. 增加 timeout/retry 与错误码
4. 增加 tool result 压缩回灌策略
