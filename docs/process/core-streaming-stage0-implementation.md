# Core Streaming 阶段 0 实现说明

## 范围
- 引入运行开关与基础指标护栏。
- 默认行为保持与既有版本一致（工具执行仍串行、无早发）。

## 代码变更
1. `apps/runtime/loop/toolLoopRunner.js`
- 新增构造参数：
  - `runtimeStreamingEnabled`
  - `toolAsyncMode`（`serial|parallel`）
  - `toolEarlyDispatch`
- `plan` 事件中新增 `payload.runtime_flags`。
- runtime 事件 envelope 新增 `seq`（单次 run 内递增）。
- run 结果新增 `metrics`：
  - `first_token_ms`
  - `first_tool_result_ms`
  - `final_ms`
  - 预留计数指标：`out_of_order_events`、`tool_dedup_hit`、`tool_parse_error`

2. `apps/gateway/server.js`
- 从环境变量读取并注入 runner 开关：
  - `RUNTIME_STREAMING_ENABLED`
  - `RUNTIME_TOOL_ASYNC_MODE`
  - `RUNTIME_TOOL_EARLY_DISPATCH`
- `/health` 新增 `runtime` 配置回显，便于调试与验收。

3. `apps/runtime/rpc/runtimeRpcWorker.js`
- `runtime.final` 与 RPC result 透传 `metrics` 字段。

## 兼容性说明
- 未开启任何新开关时，不改变现有控制流。
- 新增字段均为增量字段，旧客户端忽略即可。

## 测试
1. 更新 `test/runtime/toolLoopRunner.test.js`
- 新增：`seq` 递增、`runtime_flags` 注入、`metrics` 返回校验。
- 新增：工具执行场景下 `first_tool_result_ms` 赋值校验。

2. 更新 `test/runtime/runtimeRpcWorker.test.js`
- 校验 `runtime.final` 与 RPC result 中 `metrics` 透传。

## 运行开关默认值
- `RUNTIME_STREAMING_ENABLED=false`
- `RUNTIME_TOOL_ASYNC_MODE=serial`
- `RUNTIME_TOOL_EARLY_DISPATCH=false`
