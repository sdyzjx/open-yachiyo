# Core Streaming 阶段 5 实现说明

## 目标
- 基于 `tool_call.stable` 实现“稳定参数即早发”。
- 在不重复执行工具的前提下，把工具请求前移到流式决策阶段。

## 代码变更
1. `apps/runtime/loop/toolLoopRunner.js`
- 在单步决策内新增工具请求复用缓存：
  - `pendingToolCallPromises`（按 `call_id` 缓存等待中的结果）
  - `pendingToolCallDefs`（缓存首次下发的调用参数）
- 新增统一分发函数 `dispatchToolCall(rawCall, dispatchMode)`：
  - 支持 `early` / `normal` 两种分发模式
  - 同一 `call_id` 只下发一次，后续复用同一个 wait promise
  - 参数变化时发出 `tool.call.stable_mismatch` 事件
- 在 `onToolCallStable` 回调中：
  - 维持既有 `tool_call.stable` 指标与事件
  - 当 `toolEarlyDispatch=true` 时，立即尝试早发工具调用
  - 无法早发（缺失 `call_id`/`name`）时发出 `tool.call.early_skipped`
- 新增事件：
  - `tool.call.early_dispatched`
  - `tool.call.stable_mismatch`
  - `tool.call.early_skipped`
- `tool.call` 事件新增 `dispatch_mode`（`early|normal`）。

2. 兼容既有执行路径
- 进入正式工具执行阶段后，`normal` 分发会优先复用已早发的 promise。
- 避免了“早发一次 + 正常阶段再发一次”的重复执行。

## 兼容性
- 默认 `toolEarlyDispatch=false`，行为与旧版一致。
- 开启后仅改变请求时机，不改变 `tool.result` / `done` 协议结构。

## 测试
1. 更新 `test/runtime/toolLoopRunner.test.js`
- 新增：`toolEarlyDispatch=true` 时稳定调用会早发，且仅触发一次 `tool.call`。
- 断言工具开始时间早于第一步 `decideStream` 返回时间。

2. 回归测试
- `test/runtime/openaiReasoner.test.js`
- `test/runtime/runtimeRpcWorker.test.js`
- `test/runtime/toolCallDispatcher.test.js`
- `test/runtime/toolCallAccumulator.test.js`
- `test/runtime/tooling.test.js`

## 已验证
- 运行命令：
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js test/runtime/toolCallDispatcher.test.js test/runtime/toolCallAccumulator.test.js test/runtime/tooling.test.js`
- 结果：全部通过。
