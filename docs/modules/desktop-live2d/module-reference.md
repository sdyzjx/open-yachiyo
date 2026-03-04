# Desktop Live2D 模块级细粒度文档

## 1. 范围与目标

本文覆盖 `desktop-live2d` 全模块（`main` / `renderer` / `scripts`）的：
- 调用方法（入口、参数、返回、错误）
- 实现方法（核心机制、状态机、调用链）
- 模块依赖关系（谁调用谁、跨进程如何通信）

适用目录：
- `apps/desktop-live2d/main/*`
- `apps/desktop-live2d/renderer/*`
- `scripts/desktop-up.js`
- `scripts/live2d-import.js`
- `scripts/desktop-live2d-smoke.js`
- `apps/desktop/waitForGateway.js`（启动依赖）

## 2. 端到端调用链

### 2.1 启动链

`npm run desktop:up` -> `scripts/desktop-up.js` -> `apps/desktop-live2d/main/electronMain.js` -> `startDesktopSuite()`

`startDesktopSuite()` 内部执行顺序：
1. `resolveDesktopLive2dConfig()` 读取配置
2. `validateModelAssetDirectory()` 校验模型资源
3. `GatewaySupervisor.start()` 启动或接入网关
4. 创建三窗口：`createMainWindow()`（Avatar）/ `createChatWindow()`（聊天）/ `createBubbleWindow()`（气泡）
5. 绑定 IPC（drag/control/chat/rpc）
6. 加载 Avatar renderer 页面并等待 `rendererReady`
7. Avatar renderer 持续上报模型包围盒（`model:bounds-update`），main 进程按阈值自动裁剪 Avatar 窗口尺寸
8. 创建 `IpcRpcBridge`
9. 启动 `Live2dRpcServer`
10. 写入 `~/yachiyo/data/desktop-live2d/runtime-summary.json`

### 2.2 控制链（RPC）

外部客户端 -> `Live2dRpcServer` -> `requestHandler`
- 模型控制方法：`IpcRpcBridge.invoke()` -> Avatar Renderer `handleInvoke()`
- 聊天与气泡方法：main 进程内存态处理 -> Chat/Bubble 窗口同步

### 2.3 对话链

聊天框输入 -> preload `sendChatInput` -> main `createChatInputListener` -> `GatewayRuntimeClient.runInput`

网关通知 `runtime.*` -> `GatewayRuntimeClient.onNotification` ->
- RPC 通知：`desktop.event`
- UI 追加：main 进程 `appendChatMessage()` -> `chatStateSync`
- 气泡显示：main 进程 `showBubble()` -> `bubbleStateSync`

### 2.4 流式气泡输出链（Streaming Bubble Output）

**流式模式**（有 `message.delta` 事件）：

```
Runtime (LLM生成)
  ↓ message.delta 事件（增量文本）
GatewayRuntimeClient
  ↓ desktopEvent { type: 'message.delta', data: { delta, session_id, trace_id } }
desktopSuite.js
  ↓ updateBubbleStreaming(delta) - 累积文本 + 50ms 节流
  ↓ showBubble({ text, streaming: true, durationMs: 30000 })
  ↓ IPC: bubbleStateSync
bubble.js (Renderer)
  ↓ applyBubbleState({ text, streaming: true })
DOM 更新 + 闪烁光标动画
  ↓ runtime.final 事件
finishBubbleStreaming(finalText)
  ↓ showBubble({ text: finalText, streaming: false, durationMs: 5000 })
气泡显示 5 秒后自动隐藏
```

**非流式模式**（无 `message.delta` 事件）：

```
Runtime (LLM生成)
  ↓ runtime.final 事件（完整文本）
desktopSuite.js
  ↓ showBubble({ text: output, durationMs: 5000 })
  ↓ IPC: bubbleStateSync
bubble.js (Renderer)
  ↓ applyBubbleState({ text, streaming: false })
DOM 更新
气泡显示 5 秒后自动隐藏
```

**技术细节**：
- 流式期间使用 50ms 节流避免过于频繁的 IPC 通信
- 流式气泡保持显示 30 秒（vs 非流式 5 秒）
- 通过 `session_id` 和 `trace_id` 隔离不同会话/追踪
- 流式期间禁用自动隐藏计时器
- 闪烁光标动画提供视觉反馈（CSS `.streaming::after`）
- 向后兼容：无 delta 事件时自动降级为非流式模式

## 3. 协议与方法总览

### 3.1 IPC Channels（main <-> renderer）

定义位置：`apps/desktop-live2d/main/desktopSuite.js` + `preload.js`

- `live2d:rpc:invoke`
- `live2d:rpc:result`
- `live2d:renderer:ready`
- `live2d:renderer:error`
- `live2d:get-runtime-config`
- `live2d:chat:input:submit`
- `live2d:chat:panel-toggle`
- `live2d:chat:state-sync`
- `live2d:bubble:state-sync`
- `live2d:bubble:metrics-update`
- `live2d:model:bounds-update`
- `live2d:window:drag`
- `live2d:window:control`
- `live2d:chat:panel-visibility`

### 3.2 JSON-RPC Methods（桌宠 RPC 服务）

定义位置：`apps/desktop-live2d/main/constants.js` `RPC_METHODS_V1`

注：
- 本节只描述当前 `RPC_METHODS_V1` 中仍然存在的方法。
- 语音主链现在不是 `voice.play` / `voice.play.test` RPC，而是 `voice.requested -> desktop main -> renderer` 事件链。

- `state.get`
- `debug.mouthOverride.set`
- `param.set` / `model.param.set`
- `model.param.batchSet`
- `model.motion.play`
- `model.expression.set`
- `chat.show` / `chat.bubble.show`
- `chat.panel.show` / `chat.panel.hide` / `chat.panel.append` / `chat.panel.clear`
- `tool.list` / `tool.invoke`

#### 3.2.1 对外 `invoke` 协议结构

桌宠对外暴露的是 WebSocket JSON-RPC 2.0：

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "tool.invoke",
  "params": {
    "name": "desktop_model_play_motion",
    "arguments": {
      "group": "TapBody",
      "index": 0
    },
    "traceId": "optional-trace-id"
  }
}
```

成功回包：

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "ok": true,
    "tool": "desktop_model_play_motion",
    "result": {
      "ok": true
    }
  }
}
```

失败回包：

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "error": {
    "code": -32602,
    "message": "invalid params"
  }
}
```

#### 3.2.2 对外可调用方法与参数结构

- `state.get`
  - `params: {}`
- `debug.mouthOverride.set`
  - `params: { "enabled": boolean, "mouthOpen"?: number, "mouthForm"?: number }`
- `param.set` / `model.param.set`
  - `params: { "name": string, "value": number }`
- `model.param.batchSet`
  - `params: { "updates": [{ "name": string, "value": number }] }`
- `model.motion.play`
  - `params: { "group": string, "index"?: integer }`
- `model.expression.set`
  - `params: { "name": string }`
- `chat.show` / `chat.bubble.show`
  - `params: { "text": string, "durationMs"?: integer, "mood"?: string }`
- `chat.panel.show`
  - `params: {}`
- `chat.panel.hide`
  - `params: {}`
- `chat.panel.append`
  - `params: { "role"?: "user" | "assistant" | "system" | "tool", "text": string, "timestamp"?: integer, "requestId"?: string }`
- `chat.panel.clear`
  - `params: {}`
- `tool.list`
  - `params: {}`
- `tool.invoke`
  - `params: { "name": string, "arguments"?: object, "traceId"?: string }`

#### 3.2.3 `tool.invoke` 白名单

定义位置：`apps/desktop-live2d/main/toolRegistry.js`

- `desktop_chat_show`
  - 映射到 `chat.bubble.show`
  - `arguments: { "text": string, "durationMs"?: integer, "mood"?: string }`
- `desktop_chat_panel_append`
  - 映射到 `chat.panel.append`
  - `arguments: { "role"?: string, "text": string, "timestamp"?: integer, "requestId"?: string }`
- `desktop_model_set_param`
  - 映射到 `model.param.set`
  - `arguments: { "name": string, "value": number }`
- `desktop_model_batch_set`
  - 映射到 `model.param.batchSet`
  - `arguments: { "updates": [{ "name": string, "value": number }] }`
- `desktop_model_play_motion`
  - 映射到 `model.motion.play`
  - `arguments: { "group": string, "index"?: integer }`
- `desktop_model_set_expression`
  - 映射到 `model.expression.set`
  - `arguments: { "name": string }`

#### 3.2.4 Main -> Renderer 内部 `invoke` 结构

Main 不把 JSON-RPC 原样发给 renderer，而是经由 `ipcBridge` 包装成内部 IPC 请求：

```json
{
  "requestId": "uuid",
  "method": "model.motion.play",
  "params": {
    "group": "TapBody",
    "index": 0
  },
  "deadlineMs": 3000
}
```

Renderer 回包：

```json
{
  "requestId": "uuid",
  "result": {
    "ok": true
  }
}
```

或：

```json
{
  "requestId": "uuid",
  "error": {
    "code": -32005,
    "message": "internal error"
  }
}
```

#### 3.2.5 当前语音主链不是 `invoke`

当前语音播放主链已经从 RPC `invoke` 分离：

`runtime voice.requested -> desktopSuite processVoiceRequestedOnDesktop() -> desktop:voice:play-memory / desktop:voice:play-remote / desktop:voice:stream-* -> renderer playback entry`

兼容链仍存在 `runtime_legacy` / `voice.playback.electron` 路由，但当前主线语音路径应优先视为 `voice.requested` 事件链。

### 3.3 JSON-RPC 错误码

- `-32600` invalid request
- `-32601` method not found
- `-32602` invalid params
- `-32002` rate limited
- `-32003` renderer timeout
- `-32004` model not loaded
- `-32005` internal error
- `-32006` tool not allowed

## 4. Main 进程模块（逐文件）

## 4.1 `apps/desktop-live2d/main/constants.js`

职责：集中常量定义。

导出：
- `PROJECT_ROOT`
- `MODEL_ASSET_RELATIVE_DIR`
- `MODEL_JSON_NAME`
- `DEFAULT_IMPORT_SOURCE_DIR`
- `RUNTIME_SUMMARY_RELATIVE_PATH`
- `BACKUP_ROOT_RELATIVE_PATH`
- `DEFAULT_RPC_PORT`
- `DEFAULT_RENDERER_TIMEOUT_MS`
- `RPC_METHODS_V1`

调用方：`config.js` `live2d-import.js` `desktopSuite.js`

实现说明：
- 模型运行路径固定在项目 `assets/live2d/yachiyo-kaguya`，避免运行时依赖绝对目录。
- `RPC_METHODS_V1` 作为协议白名单上游输入，供 `rpcValidator` 判定合法方法。

## 4.2 `apps/desktop-live2d/main/config.js`

职责：解析环境变量 + JSON/JSONC 配置，输出运行配置对象。

导出方法：
- `resolveDesktopLive2dConfig({ env, projectRoot })`
- `loadDesktopLive2dUiConfig(configPath)`
- `normalizeUiConfig(raw)`
- `parseJsonWithComments(input)`
- `upsertDesktopLive2dLayoutOverrides(configPath, overrides)`
- `toPositiveInt(value, fallback)`
- `DEFAULT_UI_CONFIG`

调用方法：
- 主入口调用：`desktopSuite.startDesktopSuite()`

返回关键字段（`resolveDesktopLive2dConfig`）：
- 网关：`gatewayUrl` `gatewayHost` `gatewayPort` `gatewayExternal`
- RPC：`rpcHost` `rpcPort` `rpcToken` `rendererTimeoutMs`
- 资源：`modelDir` `modelJsonName` `modelRelativePath`
- UI：`uiConfigPath` `uiConfig`

实现方法要点：
- 优先读取 `DESKTOP_LIVE2D_CONFIG_PATH`，默认 `~/yachiyo/config/desktop-live2d.json`
- 支持带注释的 JSONC 风格配置
- 对 window/render/layout/chat 全字段做数值归一化和兜底
- `lockScaleOnResize` / `lockPositionOnResize` 默认为 true
- layout tuner 保存时只回写 `offsetX` / `offsetY` / `scaleMultiplier` 覆盖项

## 4.3 `apps/desktop-live2d/main/modelAssets.js`

职责：模型资源导入、完整性校验、manifest 生成。

导出方法：
- `validateModelAssetDirectory({ modelDir, modelJsonName })`
- `importModelAssets({ sourceDir, targetDir, modelJsonName, backupRoot, allowOverwrite })`
- `listRelativeFiles(rootDir)`
- `buildManifest({ sourceDir, targetDir, modelJsonName })`

调用方法：
- CLI 调用：`scripts/live2d-import.js`
- 启动校验：`desktopSuite.startDesktopSuite()`

实现方法要点：
- 校验 `model3.json` 中 `FileReferences` 的 `Moc` / `Textures` / `Physics` / `DisplayInfo`
- 使用路径逃逸防护：拒绝引用 `modelDir` 外部路径
- 导入时支持备份旧目录（`data/backups/live2d/<timestamp>`）
- 导入完成后写 `manifest.json`

## 4.4 `apps/desktop-live2d/main/gatewaySupervisor.js`

职责：网关生命周期管理。

导出：
- `class GatewaySupervisor`

调用方法：
- `new GatewaySupervisor(...).start()` / `.stop()`
- 主调用方：`desktopSuite.startDesktopSuite()`

构造参数：
- `projectRoot` `gatewayUrl` `gatewayHost` `gatewayPort` `external`
- 可注入：`waitForGatewayFn` `spawnFn`

实现方法要点：
- `external=true`：仅等待健康检查
- `external=false`：spawn `apps/gateway/server.js` 并等待健康
- `stop()` 先发 `SIGTERM`，2 秒后兜底 `SIGKILL`

## 4.5 `apps/desktop-live2d/main/gatewayRuntimeClient.js`

职责：连接 gateway `/ws`，发 `runtime.run`，消费 `runtime.*` 通知，管理 desktop 会话。

导出：
- `createDesktopSessionId()`
- `toGatewayWsUrl(gatewayUrl)`
- `mapGatewayMessageToDesktopEvent(message)`
- `class GatewayRuntimeClient`

`GatewayRuntimeClient` 调用方法：
- `getSessionId()`
- `setSessionId(sessionId)`
- `createAndUseNewSession({ permissionLevel })`
- `ensureSession({ sessionId, permissionLevel })`
- `runInput({ input, permissionLevel })`

实现方法要点：
- 会话 bootstrap 通过 `PUT /api/sessions/:id/settings`
- `runInput` 使用单次 WS 调用，超时受 `requestTimeoutMs` 控制
- 将 `runtime.start/runtime.event/runtime.final/message.delta` 映射为 desktop event
- 兼容 legacy `start/event/final/delta` 消息格式
- `message.delta` 建议字段：`{ session_id, trace_id, step_index, delta }`（用于前端渐进渲染）

## 4.6 `apps/desktop-live2d/main/rpcValidator.js`

职责：JSON-RPC 请求结构与参数 schema 校验。

导出：
- `METHOD_SCHEMAS`
- `validateRpcRequest(payload)`
- `buildRpcError(code, message, data)`

调用方法：
- `rpcServer.Live2dRpcServer` 在消息入口调用

实现方法要点：
- 使用 AJV 编译各 method schema
- `params` 必须是 object；null/undefined 自动按 `{}` 处理
- method 白名单来自 `RPC_METHODS_V1`

## 4.7 `apps/desktop-live2d/main/rpcRateLimiter.js`

职责：按 `clientId + method` 的每秒限流。

导出：
- `class RpcRateLimiter`

调用方法：
- `limiter.check({ clientId, method, nowMs })`
- 主调用方：`rpcServer.handleMessage`

实现方法要点：
- 1 秒固定窗口
- 内置方法级配额（`param.set` 60/s、`tool.invoke` 40/s 等）
- 超限返回 `retryAfterMs`

## 4.8 `apps/desktop-live2d/main/rpcServer.js`

职责：WebSocket JSON-RPC 服务端。

导出：
- `class Live2dRpcServer`
- `extractToken(request)`
- `normalizeError(err)`

`Live2dRpcServer` 调用方法：
- `start()` -> `{ host, port, url }`
- `handleMessage({ ws, message, clientId })`
- `notify({ method, params })`（广播通知）
- `stop()`

实现方法要点：
- 鉴权：Header `Authorization: Bearer <token>` 或 query `token`
- 入口校验：`validateRpcRequest`
- 限流：`RpcRateLimiter`
- 异常归一：`normalizeError`，最终编码为 JSON-RPC error

## 4.9 `apps/desktop-live2d/main/ipcBridge.js`

职责：Main -> Renderer 的请求-响应桥。

导出：
- `class IpcRpcBridge`

调用方法：
- `invoke({ method, params, timeoutMs })`
- `dispose()`

实现方法要点：
- 每次 invoke 生成 `requestId`，通过 `live2d:rpc:invoke` 发送
- 通过 `live2d:rpc:result` 收到回包并匹配 pending map
- 超时返回 `-32003 renderer timeout`

## 4.10 `apps/desktop-live2d/main/toolRegistry.js`

职责：对 Agent 暴露桌宠工具白名单。

导出：
- `DESKTOP_TOOL_DEFINITIONS`
- `listDesktopTools()`
- `resolveToolInvoke({ name, args })`

调用方法：
- `tool.list` -> `listDesktopTools`
- `tool.invoke` -> `resolveToolInvoke`

实现方法要点：
- 工具名到 RPC 方法映射，未知工具直接 `-32006`
- 仅透传 object 形态参数，非 object 参数归一为 `{}`

## 4.11 `apps/desktop-live2d/main/desktopSuite.js`

职责：桌宠系统编排核心（主流程入口）。

导出：
- 常量：`CHANNELS`
- 主入口：`startDesktopSuite(...)`
- 工具函数：
  - `waitForRendererReady`
  - `createMainWindow`
  - `computeWindowBounds`
  - `computeRightBottomWindowBounds`
  - `resolveWindowMetrics`
  - `resolveWindowSizeForChatPanel`
  - `resizeWindowKeepingBottomRight`
  - `writeRuntimeSummary`
  - `normalizeChatInputPayload`
  - `normalizeWindowDragPayload`
  - `normalizeWindowControlPayload`
  - `normalizeChatPanelVisibilityPayload`
  - `createWindowDragListener`
  - `createWindowControlListener`
  - `createChatPanelVisibilityListener`
  - `createChatInputListener`
  - `handleDesktopRpcRequest`
  - `isNewSessionCommand`

`startDesktopSuite` 参数：
- 必需：`app` `BrowserWindow` `ipcMain`
- 可选：`screen` `logger` `onChatInput`

`startDesktopSuite` 返回：
- `config`
- `summary`
- `window`
- `stop()`

实现方法要点：
- 启动时自动创建新的 `desktop-*` session，并 `permission=medium`
- 处理 `/new` 指令：新会话 + 清空聊天框 + 系统消息提示
- `runtime.final` 自动同步到 chat panel 与气泡
- chat panel 显隐通过 `chatPanelVisibility` IPC 驱动窗口 expanded/compact 切换
- `tool.list` / `tool.invoke` 在 main 层拦截并转发到 renderer

## 4.12 `apps/desktop-live2d/main/trayController.js`

职责：托盘图标与菜单控制。

导出：
- `TRAY_TOOLTIP`
- `TRAY_ICON_RELATIVE_PATH`
- `resolveTrayIconPath({ projectRoot })`
- `createTrayImage({ nativeImage, iconPath, size })`
- `createTrayController({ Tray, Menu, nativeImage, ...handlers })`

调用方：`electronMain.js`

实现方法要点：
- 菜单项：`Show Pet` `Hide Pet` `Quit`
- 单击托盘图标等价 `Show Pet`
- 图标不存在时回退 `nativeImage.createEmpty()`

## 4.13 `apps/desktop-live2d/main/preload.js`

职责：受限桥接 API 暴露到 renderer（`desktopLive2dBridge`）。

暴露方法：
- `onInvoke(handler)`
- `sendResult(payload)`
- `notifyReady(payload)`
- `notifyError(payload)`
- `sendChatInput(payload)`
- `sendWindowDrag(payload)`
- `sendWindowControl(payload)`
- `sendChatPanelVisibility(payload)`
- `getRuntimeConfig()`

实现方法要点：
- 使用 `contextBridge` + `ipcRenderer`
- renderer 不直接访问 Node/Electron API

## 4.14 `apps/desktop-live2d/main/electronMain.js`

职责：Electron 生命周期入口。

调用方法：
- `bootstrap()`（`app.whenReady()` 后触发）
- `hidePetWindow()`
- `showPetWindow()`
- `teardown()`

实现方法要点：
- 首次启动调用 `startDesktopSuite`
- 创建 tray controller，支持 Show/Hide/Quit
- `window-all-closed` 不退出进程（保持后台网关存活）

## 4.15 `apps/desktop-live2d/main/index.js`

职责：对外导出统一入口。

导出：
- `startDesktopSuite`

## 5. Renderer 模块（逐文件）

## 5.1 `apps/desktop-live2d/renderer/index.html`

职责：桌宠 renderer 页面与静态结构。

关键 DOM：
- `#stage`（Pixi canvas 容器）
- `#resize-mode-close`
- `#layout-tuner-toggle`
- `#layout-tuner-panel`
- `#chat-panel`（聊天框）
- `#chat-panel-messages`
- `#chat-input` / `#chat-send`
- `#pet-hide` / `#pet-close`
- `#bubble-layer` / `#bubble`

加载顺序：
1. `pixi.min.js`
2. `live2dcubismcore.min.js`
3. `pixi-live2d-display`
4. `../shared/defaultUiConfig.js`
5. `layout.js`
6. `interaction.js`
7. `chatPanelState.js`
8. `bootstrap.js`

## 5.2 `apps/desktop-live2d/renderer/layout.js`

职责：模型布局计算纯函数。

导出：
- `computeModelLayout(input)`
- `clampModelPositionToViewport(input)`
- `computeVisibleModelBounds(input)`

调用方：`bootstrap.applyAdaptiveLayout`

实现方法要点：
- 输入：stage 尺寸、模型 bounds、布局参数
- 输出：`scale` `positionX/Y` `pivotX/Y` + debug
- 当前主路径使用 `anchorXRatio/anchorYRatio + offsetX/offsetY` 直控位置
- oversized 模型不再强制居中，而是按最小可见比例 clamp
- 提供 `minScale/maxScale` 限制

## 5.3 `apps/desktop-live2d/renderer/chatPanelState.js`

职责：聊天面板状态机（纯函数）。

导出：
- `createInitialState(config)`
- `normalizeRole(role, fallback)`
- `normalizeMessageInput(input, fallbackRole)`
- `appendMessage(state, input, fallbackRole)`
- `clearMessages(state)`
- `setPanelVisible(state, visible)`

调用方：`bootstrap.js`

实现方法要点：
- `messages` 队列上限受 `maxMessages` 控制
- role 仅允许：`user/assistant/system/tool`

## 5.4 `apps/desktop-live2d/renderer/interaction.js`

职责：交互防抖与浮点比较辅助。

导出：
- `createCooldownGate({ cooldownMs, now })`
- `nearlyEqual(left, right, epsilon)`
- `shouldUpdate2D(currentX, currentY, nextX, nextY, epsilon)`

调用方：`bootstrap.js`

实现方法要点：
- 点击门控：防止短时间重复 toggle
- transform 更新判定：数值未变化时跳过 `set`

## 5.5 `apps/desktop-live2d/renderer/bootstrap.js`

职责：renderer 总控，包含模型渲染、UI 行为、RPC 分发。

主要调用入口：
- 启动入口：`main()`（IIFE 内自动执行）
- RPC 分发：`handleInvoke(payload)`

RPC method -> 实现方法映射：
- `state.get` -> `getState()`
- `param.set` / `model.param.set` -> `setModelParam()`
- `model.param.batchSet` -> `setModelParamsBatch()`
- `model.motion.play` -> `playModelMotion()`
- `model.expression.set` -> `setModelExpression()`
- `chat.show` / `chat.bubble.show` -> `showBubble()`
- `chat.panel.show` -> `setChatPanelVisible(true)`
- `chat.panel.hide` -> `setChatPanelVisible(false)`
- `chat.panel.append` -> `appendChatMessage()`
- `chat.panel.clear` -> `clearChatMessages()`

实现方法要点（关键机制）：
- Pixi 初始化：`initPixi()`，按配置计算 DPR/resolution
- 模型加载：`loadModel(modelRelativePath, modelName)`
- 自适应布局：`applyAdaptiveLayout()` + `scheduleAdaptiveLayout()`
- `Resize Mode`：
  - renderer 决定目标窗口尺寸
  - main 只执行原生窗口 resize / clamp / persist
  - 锁定窗口比例，禁止自由 native resize
- `Layout Tuner`：
  - 直接调 `offsetX` / `offsetY` / `scaleMultiplier`
  - `Reset` 回到共享默认值
  - `Save` 回写 `~/yachiyo/config/desktop-live2d.json`
- 点击切聊天框：`bindModelInteraction()`
  - 人物点击支持聊天框显隐切换（toggle）
  - 拖拽窗口：`bindWindowDragGesture(canvas)` -> IPC `windowDrag`
  - 聊天框显隐：`applyChatPanelVisibility()`
  - 显示：先通知 main 扩窗，再在 resize 后 reveal，减少闪烁
  - 隐藏：先 fade-out，再通知 main 缩窗
- 防闪烁策略：
  - `createCooldownGate` 防重复 toggle
  - focus/visibility 恢复后短时间抑制 model tap，避免“激活点击”误触发
  - transform 数值不变时不重设
  - 布局使用 RAF 合并（避免重复重排）
  - 输入框 Enter 提交增加 IME 组合态保护（`isComposing` / `keyCode=229`），避免中文输入法候选确认时误发送

## 6. 启动与运维脚本模块

## 6.1 `scripts/desktop-up.js`

职责：`npm run desktop:up` 的统一启动入口。

调用方法：
- 直接执行脚本，无参数

实现方法要点：
- 使用 `electron` 包提供的二进制启动 `electronMain.js`
- 继承环境变量和 stdio

## 6.2 `scripts/live2d-import.js`

职责：导入 Live2D 模型资源到项目 assets。

调用方法：
- `npm run live2d:import`
- 环境变量：`LIVE2D_IMPORT_SOURCE_DIR`
- 参数：`--no-overwrite`（禁止覆盖）

实现方法要点：
- 调用 `importModelAssets`
- 成功后输出 source/target/model/files/backup/manifest

## 6.3 `scripts/desktop-live2d-smoke.js`

职责：RPC 连通性 smoke 测试。

调用方法：
- `npm run desktop:smoke`

步骤：
1. 读取 `runtime-summary.json`
2. 使用 token 连接桌宠 RPC
3. 调用 `state.get`
4. 调用 `tool.list`
5. 调用 `chat.panel.append`

导出方法（可供测试调用）：
- `DEFAULT_SUMMARY_PATH`
- `loadRuntimeSummary(summaryPath)`
- `buildRpcUrlWithToken(rpcUrl, token)`
- `runSmoke({ summaryPath, timeoutMs, logger })`

## 6.4 `apps/desktop/waitForGateway.js`

职责：网关健康检查等待器。

导出：
- `waitForGateway(baseUrl, options)`
- `probeGatewayHealth(healthUrl, requestTimeoutMs)`

实现方法要点：
- 轮询 `<baseUrl>/health`
- 超时抛错，供 `GatewaySupervisor` 上层处理

## 7. 配置与调用示例

### 7.1 关键配置文件

`~/yachiyo/config/desktop-live2d.json` 关键项：
- `window.*`：窗口尺寸、紧凑模式、锚点
- `render.*`：清晰度参数
- `layout.offsetX` / `layout.offsetY` / `layout.scaleMultiplier`：用户可保存的布局覆盖
- `chat.panel.*`：聊天框开关、默认显隐、容量
- `chat.bubble.mirrorToPanel`

配置层优先级：
1. `apps/desktop-live2d/shared/defaultUiConfig.js`
2. `~/yachiyo/config/desktop-live2d.json`
3. `~/yachiyo/data/desktop-live2d/window-state.json`（仅窗口尺寸记忆）

### 7.2 RPC 调用示例

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "model.motion.play",
  "params": { "group": "TapBody", "index": 0 }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "chat.panel.append",
  "params": { "role": "assistant", "text": "你好", "timestamp": 1730000000000 }
}
```

### 7.3 Tool Calling 示例

```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tool.invoke",
  "params": {
    "name": "desktop_model_set_param",
    "arguments": { "name": "ParamAngleX", "value": 12 }
  }
}
```

## 8. 测试映射（模块 -> 测试）

- `config.js` -> `test/desktop-live2d/config.test.js`
- `desktopSuite.js` -> `test/desktop-live2d/desktopSuite.test.js`
- `gatewayRuntimeClient.js` -> `test/desktop-live2d/gatewayRuntimeClient.test.js`
- `gatewaySupervisor.js` -> `test/desktop-live2d/gatewaySupervisor.test.js`
- `ipcBridge.js` -> `test/desktop-live2d/ipcBridge.test.js`
- `layout.js` -> `test/desktop-live2d/layout.test.js`
- `chatPanelState.js` -> `test/desktop-live2d/chatPanelState.test.js`
- `interaction.js` -> `test/desktop-live2d/interaction.test.js`
- `modelAssets.js` -> `test/desktop-live2d/modelAssets.test.js`
- `rpcServer.js` -> `test/desktop-live2d/rpcServer.test.js`
- `rpcRateLimiter.js` -> `test/desktop-live2d/rpcRateLimiter.test.js`
- `rpcValidator.js` -> `test/desktop-live2d/rpcValidator.test.js`
- `toolRegistry.js` -> `test/desktop-live2d/toolRegistry.test.js`
- `trayController.js` -> `test/desktop-live2d/trayController.test.js`
- `desktop-live2d-smoke.js` -> `test/desktop-live2d/desktopSmokeScript.test.js`

## 9. 维护约定

1. 新增/变更 RPC 方法时，必须同时更新：
- `constants.js` `RPC_METHODS_V1`
- `rpcValidator.js` schema
- `renderer/bootstrap.js` 分发映射
- 本文档（方法总览 + 模块章节）

2. 新增 Tool Calling 能力时，必须同时更新：
- `toolRegistry.js`
- `desktopSuite.handleDesktopRpcRequest`
- 本文档 tool 示例

3. 任何窗口交互改动（拖拽、显隐、缩放）必须补充对应测试。
