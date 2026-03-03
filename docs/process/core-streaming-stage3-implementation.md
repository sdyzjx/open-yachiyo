# Core Streaming 阶段 3 实现说明

## 目标
- 稳定聚合流式 `tool_calls.arguments` 分片。
- 输出 `tool_call.delta` / `tool_call.stable` 事件，提供参数解析可观测性。
- 在流结束时执行 `flushFinal` 解析兜底，并上报解析错误。

## 代码变更
1. `apps/runtime/llm/toolCallAccumulator.js`
- 新增增量聚合器 `ToolCallAccumulator`，按 `tool_call.index` 聚合：
  - `call_id`
  - `name`
  - `args_raw`
- 支持回调：
  - `onDelta`
  - `onStable`
  - `onParseError`
- `finalize()` 统一做尾包解析，返回：
  - `toolCalls`（仅包含可解析 JSON 的调用）
  - `parseErrors`（包含 `call_id`、`args_raw`、`parse_reason`）

2. `apps/runtime/llm/openaiReasoner.js`
- `decideStream()` 接入 `ToolCallAccumulator`。
- 新增可选回调参数：
  - `onToolCallDelta`
  - `onToolCallStable`
  - `onToolCallParseError`
- 解析成功时直接返回结构化 `tools`（不再依赖宽松 JSON fallback）。
- 决策结果新增 `stream_meta`：
  - `tool_parse_errors`
  - `parse_errors`

3. `apps/runtime/loop/toolLoopRunner.js`
- 流式决策路径新增事件转发：
  - `tool_call.delta`
  - `tool_call.stable`
  - `tool_call.parse_error`
- 新增指标落点：
  - 首次 `tool_call.stable` 时记录 `first_tool_stable_ms`
  - 解析错误计数累加到 `tool_parse_error`
- 对 `onToolCallParseError` 回调与 `stream_meta.parse_errors` 做去重合并，避免重复计数。
- `llm.final` 事件新增 `stream_meta` 透传。

## 兼容性
- 非流式路径（`decide()`）无变更。
- 未消费新增事件的客户端不受影响。
- 新增字段均为增量字段，可被旧客户端忽略。

## 测试
1. 新增 `test/runtime/toolCallAccumulator.test.js`
- 覆盖分片聚合、stable 去重、finalize parse error 上报。

2. 更新 `test/runtime/openaiReasoner.test.js`
- 覆盖 `decideStream` 的 `tool_call delta/stable` 回调。
- 覆盖 parse error 冒泡到 `stream_meta` 和回调。

3. 更新 `test/runtime/toolLoopRunner.test.js`
- 覆盖 runner 级 `tool_call.delta/stable` 事件发射。
- 覆盖 parse error 去重计数（callback + stream_meta 同时存在时只记一次）。

4. 回归测试
- `test/runtime/runtimeRpcWorker.test.js`
- `test/runtime/toolCallDispatcher.test.js`

## 已验证
- 运行命令：
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js test/runtime/toolCallDispatcher.test.js test/runtime/toolCallAccumulator.test.js`
- 结果：全部通过。
