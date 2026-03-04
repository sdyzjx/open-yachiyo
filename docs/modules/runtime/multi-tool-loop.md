# Multi-Tool Loop（运行时细粒度文档）

## 1. 关键文件

- `apps/runtime/llm/openaiReasoner.js`
- `apps/runtime/loop/toolLoopRunner.js`
- `apps/runtime/orchestrator/toolCallDispatcher.js`

## 2. Reasoner 行为

`OpenAIReasoner.decide()` 现在支持解析完整 `message.tool_calls[]`：

- 兼容字段：
  - `decision.tool`：首个工具调用（向后兼容）
  - `decision.tools`：完整工具调用数组（新）

参数解析规则：

- `arguments` 是 JSON 字符串时尝试 `JSON.parse`
- 解析失败时回退 `{ raw }`

## 3. LoopRunner 执行策略

### 每步逻辑

1. 调用 reasoner 获取 decision
2. 若 `final`：直接结束
3. 若 `tool`：
   - `normalizeToolCalls(decision)` 得到工具列表
   - 同步写入 assistant message（含 tool_calls）
   - 根据 `tool_async_mode` + 工具元数据决定串行/并行调度
   - 对每个 call：
     - publish `tool.call.requested`
     - wait `tool.call.result`
     - 成功则写入 tool message
     - 若 `APPROVAL_REQUIRED`：回写 tool message，等待下一步由模型调用 `shell.approve`
     - 其他错误：回写结构化错误并触发重规划重试（最多 `toolErrorMaxRetries` 次）

### 重试策略

- 默认最大报错重试次数：`5`
- 后端可通过环境变量 `RUNTIME_TOOL_ERROR_MAX_RETRIES` 调整
- 重试达到上限后，loop 返回 ERROR（包含最后一次错误信息）

## 4. EventBus 事件

### 运行时事件

- `plan`
- `llm.final`
- `tool.call`
- `tool.result`
- `tool.error`
- `done`

### 工具调度事件

- publish: `tool.call.requested`
- consume: `tool.call.result`

## 5. Dispatcher 职责

`ToolCallDispatcher` 订阅 `tool.call.requested`，执行后写回 `tool.call.result`。

返回字段：

- 成功：`ok=true, result, metrics`
- 失败：`ok=false, error, code, details, metrics`

## 6. 故障处理

- waitFor 超时 => loop 捕获错误并返回 ERROR
- tool 执行失败（非审批类）=> loop 将错误回写给模型并重规划；超过重试上限后终止并输出 `工具执行失败：...`
- decision 为 tool 但无可执行 call => 立即 ERROR

## 7. 扩展路线

1. 串行 -> 有序并行（先保序收敛再提交结果）
2. 支持按工具类型的差异化 retry policy（例如幂等/非幂等区分）
3. 增加 per-call budget（token/time）
