# Core Streaming 阶段 6 实现说明

## 目标
- 收敛协议事件，保证客户端可以稳定消费新增 `tool_call.*` 流式事件。
- 保持旧协议兼容，不影响既有 `runtime.event` / `message.delta` 消费路径。

## 代码变更
1. `apps/runtime/rpc/runtimeRpcWorker.js`
- 新增 `extractToolCallEventFromRuntimeEvent(event)`：
  - 从 runtime 事件中抽取 `tool_call.*` 事件
  - 标准化输出：
    - `session_id`
    - `trace_id`
    - `step_index`
    - `seq`
    - `type`
    - `payload`
- 在 `runner.run(... onEvent)` 转发逻辑中新增：
  - 将 `tool_call.*` 事件额外转发为 RPC 事件 `tool_call.event`
- 保留原有行为：
  - 继续透传 `runtime.event`
  - 继续透传 `message.delta`
  - `llm.final(streamed=true)` 仍避免 preview 重复发 delta

## 兼容性
- 旧客户端可继续只消费 `runtime.event` / `message.delta`。
- 新客户端可消费 `tool_call.event` 获得结构化流式工具事件，不需要从全量 runtime 事件流自行筛选。

## 测试
1. 更新 `test/runtime/runtimeRpcWorker.test.js`
- 新增：`tool_call.delta/stable/parse_error` 转发到 `tool_call.event` 的覆盖。

2. 回归测试
- `test/runtime/openaiReasoner.test.js`
- `test/runtime/toolLoopRunner.test.js`
- `test/runtime/toolCallDispatcher.test.js`
- `test/runtime/toolCallAccumulator.test.js`
- `test/runtime/tooling.test.js`

## 已验证
- 运行命令：
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js test/runtime/toolCallDispatcher.test.js test/runtime/toolCallAccumulator.test.js test/runtime/tooling.test.js`
- 结果：全部通过。
