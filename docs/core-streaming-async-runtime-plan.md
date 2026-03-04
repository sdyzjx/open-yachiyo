# Core Streaming + Async Tooling 施工方案（风险驱动版）

## 总目标
- 让 runtime 支持端到端流式输出、异步工具调用、增量工具参数解析。
- 明确把以下 4 项设为 P0 风险并优先收敛：
1. 工具早发语义安全（避免错执行）
2. 并发工具副作用冲突（避免状态破坏）
3. 事件顺序与幂等（避免乱序和重复执行）
4. 增量参数解析鲁棒性（避免碎片参数误解析）

## P0 风险对策（全局）
1. 语义安全：
- 引入 `tool_call.stable`，默认仅在 `finish_reason=tool_calls` 或 `quiet_window_ms`（参数不再变化）后 dispatch。
- `RUNTIME_TOOL_EARLY_DISPATCH` 默认 `false`，灰度开启。
2. 副作用冲突：
- 工具元数据新增 `side_effect_level=none|read|write`、`requires_lock`。
- 默认 `serial`，仅 `side_effect_level=none` 的工具允许并发。
3. 顺序与幂等：
- 所有 runtime 事件增加 `seq`（单会话单调递增）。
- tool 执行强制 `call_id` 幂等键，dispatcher 层去重缓存（TTL）。
4. 解析鲁棒性：
- 增量参数解析使用状态机聚合器，不以单次 `JSON.parse` 轮询作为唯一判定。
- 流结束 `flushFinal()` + 失败显式 `tool.error(call_id, parse_reason)`。

## 阶段 0：护栏与回退
### 目标
- 建立可回退、可观测、可比较的基线。

### 产出
1. 新增开关：
- `RUNTIME_STREAMING_ENABLED=false`
- `RUNTIME_TOOL_ASYNC_MODE=serial|parallel`（默认 `serial`）
- `RUNTIME_TOOL_EARLY_DISPATCH=false`
2. 指标：
- `first_token_ms`、`first_tool_stable_ms`、`first_tool_result_ms`、`final_ms`
- `out_of_order_events`、`tool_dedup_hit`、`tool_parse_error`
3. 双路径共存：新旧流程并存，按开关切换。

### 验收
1. 开关全关与当前线上行为一致。
2. 指标可在 debug stream 和日志中看到。

## 阶段 1：文本流式（保持工具串行）
### 目标
- 先稳定拿到 token 级流式，不引入工具并发变量。

### 改动点
1. `apps/runtime/llm/openaiReasoner.js` 增加 `decideStream()`。
2. `apps/runtime/loop/toolLoopRunner.js` 转发 `llm.stream.delta`。
3. `apps/runtime/rpc/runtimeRpcWorker.js` 透传 `message.delta`。

### 验收
1. 前端持续收到 delta。
2. `done` 语义与旧版一致。
3. 工具调用路径无行为变化。

## 阶段 2：事件顺序与幂等底座
### 目标
- 在并发前先保证不会“乱序 + 重复执行”。

### 改动点
1. 给 runtime 事件添加 `seq`（按 session 递增）。
2. dispatcher 增加 `call_id` 去重（缓存命中直接回放历史结果）。
3. worker / gateway 转发保留 `seq`，客户端可按 `seq` 重排。

### 验收
1. 重连/重试不重复执行工具。
2. 前端按 `seq` 重放后状态稳定一致。

## 阶段 3：增量参数聚合器
### 目标
- 先把 `tool_calls.arguments` 聚合做稳，再谈早发。

### 改动点
1. 新增 `toolCallAccumulator`（按 `tool_call.index` 聚合）。
2. 输出 `tool_call.delta`、`tool_call.stable` 事件。
3. `flushFinal()` 做尾包兜底和错误归因。

### 验收
1. 分片参数在 fuzz 回放下可稳定解析。
2. 解析失败可定位（`call_id` + `parse_reason`）。

## 阶段 4：受控并发工具执行
### 目标
- 在安全约束下引入并发，先吃到收益再扩范围。

### 改动点
1. `ToolLoopRunner` 支持 `Promise.allSettled` 并发调度。
2. 并发前检查工具元数据：
- `requires_lock=true` 强制串行。
- `side_effect_level=write` 默认串行。
3. 增加 `max_parallel_tools` 上限。

### 验收
1. 只读工具并发下总时延下降。
2. 写类工具无冲突回归。
3. `serial` 可完全回退旧行为。

## 阶段 5：工具早发（灰度）
### 目标
- 在 `stable` 判定通过后才早发，避免语义漂移。

### 改动点
1. 仅对 `tool_call.stable` 执行早发。
2. 若后续参数仍变化：
- 默认丢弃后续变化并记录告警；
- 可选策略：`cancel_and_restart`（实验开关）。
3. 输出 `tool_dispatch_mode=normal|early`。

### 验收
1. `first_tool_result_ms` 显著提前。
2. 无明显错工具执行回归。

## 阶段 6：协议收敛与客户端适配
### 目标
- 新旧协议兼容，消费端逐步切换。

### 改动点
1. 规范事件：`llm.stream.start|delta|end`、`tool_call.delta|stable`、`tool.result`。
2. 网关/desktop/web 保留旧字段，新增字段增量接入。
3. debug 面板增加顺序和幂等指标展示。

### 验收
1. 旧客户端不升级也可用。
2. 新客户端可消费全部增强事件。

## 阶段 7：压测、混沌与灰度上线
### 目标
- 证明稳定性后再放量。

### 测试矩阵
1. 单工具 / 多工具（只读并发）
2. 多工具（含写操作串行）
3. 流式断连、重试、乱序、重复包
4. 参数分片异常（引号、转义、截断）
5. 超时、取消、回滚

### 上线策略
1. 内测：`streaming=true` + `parallel=false` + `early_dispatch=false`
2. 小流量：开放并发只读工具
3. 最后灰度 `early_dispatch`
4. 触发阈值自动回退到 `serial`/非流式

## 上线门槛（必须满足）
1. 无重复执行（`tool_dedup_hit` 可解释，重复执行率为 0）。
2. 无不可恢复乱序（`out_of_order_events` 在可控阈值内并可重排）。
3. 参数解析失败率低于阈值并可追踪根因。
4. 写类工具在并发模式下仍保持串行一致性。

## 里程碑
1. M1：阶段 0-1（流式文本）
2. M2：阶段 2-3（顺序幂等 + 增量解析稳态）
3. M3：阶段 4（受控并发）
4. M4：阶段 5-7（早发灰度 + 上线）
