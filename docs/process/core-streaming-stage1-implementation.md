# Core Streaming 阶段 1 实现说明

## 目标
- 在不改变工具调度语义（仍串行）的前提下，打通文本流式事件链路。

## 代码变更
1. `apps/runtime/llm/openaiReasoner.js`
- 新增 `decideStream({ messages, tools, onDelta })`。
- 通过 OpenAI `stream=true` 读取 SSE。
- 增量解析 `delta.content` 并回调 `onDelta`。
- 同时聚合 `delta.tool_calls` 片段，在流结束后返回与 `decide()` 同结构决策。
- 保留既有 `decide()`，默认路径不变。

2. `apps/runtime/loop/toolLoopRunner.js`
- 当 `runtimeStreamingEnabled=true` 且 reasoner 支持 `decideStream` 时，启用流式决策路径。
- 新增事件：
  - `llm.stream.start`
  - `llm.stream.delta`
  - `llm.stream.end`
- 保留 `llm.final` 事件，并新增 `payload.streamed=true` 标记。

3. `apps/runtime/rpc/runtimeRpcWorker.js`
- 支持把 `llm.stream.delta` 直接透传成 `message.delta`。
- 当 `llm.final` 带 `streamed=true` 时，不再重复发送 preview delta。

## 兼容性
- 默认开关关闭时，仍走旧版 `decide()` 路径。
- 客户端继续消费 `runtime.final` 即可；支持流式的客户端可消费 `message.delta` 增量更新。

## 测试
1. `test/runtime/openaiReasoner.test.js`
- 新增 `decideStream` 文本 delta 测试。
- 新增 `decideStream` 工具参数分片聚合测试。

2. `test/runtime/toolLoopRunner.test.js`
- 新增 streaming 模式事件链路测试（start/delta/end + streamed final）。

3. `test/runtime/runtimeRpcWorker.test.js`
- 新增 `llm.stream.delta` 透传测试。
- 校验 `llm.final(streamed=true)` 不重复下发 delta。

## 已验证
- 运行命令：
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js`
- 结果：全部通过。
