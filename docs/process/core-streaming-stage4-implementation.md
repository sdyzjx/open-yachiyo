# Core Streaming 阶段 4 实现说明

## 目标
- 在不破坏默认串行语义的前提下，增加受控并发工具执行能力。
- 仅允许无副作用工具并发执行，其余工具保持串行。

## 代码变更
1. `apps/runtime/loop/toolLoopRunner.js`
- 新增构造参数：
  - `maxParallelTools`（默认 `3`）
- `plan.runtime_flags` 新增：
  - `max_parallel_tools`
- 工具执行策略改造：
  - 读取工具元数据 `side_effect_level` / `requires_lock`
  - 仅在以下条件满足时开启并发：
    - `toolAsyncMode=parallel`
    - 本轮工具数 > 1
    - 所有工具满足 `side_effect_level=none && requires_lock=false`
  - 并发按 `chunk_width=min(maxParallelTools, tool_calls)` 分批执行。
- 新增事件：
  - `tool.dispatch.mode`（`serial|parallel`，含 `chunk_width`）
- 统计增强：
  - 并发模式下用最早返回时间更新 `first_tool_result_ms`
  - 命中 dispatcher 去重结果时累加 `tool_dedup_hit`

2. `apps/gateway/server.js`
- 新增环境变量：
  - `RUNTIME_MAX_PARALLEL_TOOLS`（默认 `3`）
- 注入 runner，并在 `/health.runtime` 回显 `max_parallel_tools`。

3. 调度元数据透传
- `apps/runtime/tooling/toolRegistry.js`
  - 在 registry/list 中透传 `side_effect_level`、`requires_lock`
- `apps/runtime/executor/toolExecutor.js`
  - legacy registry 的 `listTools()` 同步透传上述字段
- `apps/runtime/executor/localTools.js`
  - 标注本地工具副作用级别（`none/read/write`）及锁需求
- `config/tools.yaml`
  - 为 runtime 工具配置 `side_effect_level`、`requires_lock`

## 兼容性与默认行为
- 默认 `toolAsyncMode=serial`，行为与旧版一致。
- 即使开启 `parallel`，若工具不是 `none` 级别或需要锁，仍自动回退串行。

## 测试
1. 更新 `test/runtime/toolLoopRunner.test.js`
- 新增并发执行测试（`side_effect_level=none`）。
- 新增串行回退测试（`write + requires_lock=true`）。
- 更新 runtime flags 断言（包含 `max_parallel_tools`）。

2. 更新 `test/runtime/tooling.test.js`
- 新增 registry 元数据透传测试（`side_effect_level` / `requires_lock`）。

3. 回归测试
- `test/runtime/openaiReasoner.test.js`
- `test/runtime/runtimeRpcWorker.test.js`
- `test/runtime/toolCallDispatcher.test.js`
- `test/runtime/toolCallAccumulator.test.js`

## 已验证
- 运行命令：
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js test/runtime/toolCallDispatcher.test.js test/runtime/toolCallAccumulator.test.js test/runtime/tooling.test.js`
- 结果：全部通过。
