# SSE Express Logger MVP 施工方案

版本：v1  
日期：2026-02-28  
分支：`codex/logger-sse-mvp`

## 1. 目标

基于 `SSE + Express` 落地 runtime debug logger MVP，提供可被浏览器与 `curl -N` 直接消费的实时事件流能力，并支持最小可用的鉴权、topic 过滤、断线补发与调试开关。

## 2. 规范依据

本方案遵循以下文档约束：

1. [Branch Collaboration Spec](../process/BRANCH_COLLABORATION_SPEC.md)
2. [Merge & Integration SOP](../process/merge-and-integration-sop.md)

对应执行策略：

1. 功能在独立分支开发，不直接在 `main` 提交。
2. 提交前必须测试通过，并同步文档。
3. PR 需提供变更范围、风险、验证与回滚方案。

## 3. 功能范围

MVP 内：

1. `GET /api/debug/events` SSE 订阅接口（附带 `/debug/stream` 别名）。
2. `POST /api/debug/emit` 手动注入测试事件（附带 `/debug/emit` 别名）。
3. `PUT /api/debug/mode` 与 `GET /api/debug/mode` 全局 debug 开关。
4. topic 过滤、可选 Bearer 鉴权、`Last-Event-ID` 补发、心跳、连接上限控制。
5. runtime EventBus 全量事件镜像到 SSE stream。
6. `shell.exec` 在 debug 模式下实时发布 `stdout/stderr/exit` 事件。

MVP 外：

1. 多实例一致性回放。
2. 持久化历史事件仓库。
3. 双向控制通道。

## 4. 架构与改动点

1. 新增 [debugEventStream.js](../../apps/gateway/debugEventStream.js)。
2. 扩展 [eventBus.js](../../apps/runtime/bus/eventBus.js) 支持 `subscribeAll`。
3. 网关挂载 SSE/emit/debug-mode API，并在 `/health` 暴露 debug stream 状态：
   [server.js](../../apps/gateway/server.js)。
4. 工具执行上下文透传 `bus`：
   [toolExecutor.js](../../apps/runtime/executor/toolExecutor.js)、
   [toolCallDispatcher.js](../../apps/runtime/orchestrator/toolCallDispatcher.js)。
5. `shell.exec` 由一次性回调执行改为流式 `spawn`，可实时 publish：
   [shell.js](../../apps/runtime/tooling/adapters/shell.js)。

## 5. 配置与运行参数

可通过环境变量调整：

1. `DEBUG_MODE`：启动时默认 debug 开关（`true/false`）。
2. `DEBUG_STREAM_BEARER_TOKEN`：设置后启用 Bearer 鉴权。
3. `DEBUG_STREAM_ALLOWED_TOPICS`：允许订阅的 topic 列表（逗号分隔，`*` 代表全部）。
4. `DEBUG_STREAM_HEARTBEAT_MS`：心跳间隔。
5. `DEBUG_STREAM_BUFFER_SIZE`：ring buffer 大小。
6. `DEBUG_STREAM_MAX_CONNECTIONS`：全局连接上限。
7. `DEBUG_STREAM_PER_USER_MAX_CONNECTIONS`：单用户连接上限。

## 6. 验收标准

1. `curl -N "http://localhost:3000/api/debug/events?topics=runtime.event"` 可持续收到事件。
2. `POST /api/debug/emit` 后，SSE 客户端能收到同 topic 事件。
3. 重连时携带 `Last-Event-ID` 可收到补发窗口内事件。
4. `PUT /api/debug/mode` 可立即影响 shell 流事件发布行为。
5. debug 开启后执行 `shell.exec` 可看到 `shell.exec.stdout/shell.exec.stderr/shell.exec.exit`。

## 7. 风险与缓解

1. 风险：SSE 连接泄漏导致内存上涨。  
缓解：连接关闭时清理心跳与 client 记录，限制连接数。
2. 风险：shell 改为 `spawn` 后输出行为偏差。  
缓解：保留原有权限与输出截断逻辑，补充适配器测试。
3. 风险：debug 事件量大导致前端消费压力。  
缓解：topic 过滤 + ring buffer 限长 + 可关闭 debug 模式。

## 8. 回滚方案

1. 回滚本次分支合并 commit（`git revert <commit>`）。
2. 关闭 debug 入口（移除路由或设置严格 token 保护）。
3. 将 shell adapter 切回非流式实现（保留历史版本差异可逆）。

## 9. 验证记录

已执行：

1. `node --test test/runtime/eventBus.test.js test/runtime/shellAdapterDebug.test.js test/gateway/debugEventStream.test.js`
2. `node --test test/runtime/tooling.test.js`
3. `node --test test/integration/gateway.e2e.test.js`
