# Core Streaming 阶段 2 实现说明

## 目标
- 构建 `trace_id + call_id` 维度的调度幂等底座，避免工具重复执行。

## 代码变更
1. `apps/runtime/orchestrator/toolCallDispatcher.js`
- 新增去重配置：`dedupTtlMs`（默认 5 分钟）。
- 新增两类去重命中路径：
  - `completed cache` 命中：直接回放历史 `tool.call.result`。
  - `in-flight` 命中：等待首个执行结果后回放。
- 同一 `trace_id + call_id` 在 TTL 内仅执行一次。
- 命中回放结果带 `dedup_hit=true`。
- 新增链路事件：`dispatch.dedup.hit`（source: `cache|inflight`）。

2. `apps/gateway/server.js`
- 新增环境变量接入：
  - `RUNTIME_TOOL_CALL_DEDUP_TTL_MS`
- `/health` 增加 `runtime.tool_call_dedup_ttl_ms`。

## 兼容性
- 不改变工具接口和 `tool.call.result` 核心字段。
- 未出现重复请求时，行为与旧版一致。

## 测试
1. 新增 `test/runtime/toolCallDispatcher.test.js`
- 覆盖 completed cache 命中去重。
- 覆盖 in-flight 命中去重。
- 断言重复请求只执行一次工具逻辑。

2. 回归测试
- `test/runtime/openaiReasoner.test.js`
- `test/runtime/toolLoopRunner.test.js`
- `test/runtime/runtimeRpcWorker.test.js`

## 已验证
- 运行命令：
  - `node --test test/runtime/toolCallDispatcher.test.js`
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js`
- 结果：全部通过。
