# Desktop Live2D 配置参考

本文档只覆盖 `desktop-live2d.json` 这一份 UI/runtime 配置。

如果你要看当前项目的全部运行时配置总表，另见：

- `docs/modules/runtime/config-reference.md`

核查范围基于当前代码：
- 运行时配置文件：`~/yachiyo/config/desktop-live2d.json`
- 首次启动模板：`config/desktop-live2d.json`
- 配置加载入口：`apps/desktop-live2d/main/config.js`

## 1. 真实生效文件与加载链

### 1.1 文件位置

- 真正运行时读取的是 `~/yachiyo/config/desktop-live2d.json`
- 仓库内的 `config/desktop-live2d.json` 只是首次启动复制模板
- gateway 的只读配置接口 `/api/config/desktop-live2d/raw` 现在也返回运行时文件，而不是模板

### 1.2 加载链

1. `apps/desktop-live2d/main/config.js`
   - `resolveDesktopLive2dConfig()`
   - `loadDesktopLive2dUiConfig()`
   - `parseJsonWithComments()`
   - `normalizeUiConfig()`
2. `apps/desktop-live2d/main/desktopSuite.js`
   - `startDesktopSuite()` 读取 `config.uiConfig`
   - 创建 avatar/chat/bubble 窗口
   - 通过 `ipcMain.handle(CHANNELS.getRuntimeConfig, ...)` 把 `uiConfig` 发给 renderer
3. `apps/desktop-live2d/main/preload.js`
   - `getRuntimeConfig()`
4. `apps/desktop-live2d/renderer/bootstrap.js`
   - `bridge.getRuntimeConfig()`
   - `runtimeUiConfig = runtimeConfig.uiConfig || null`
   - 后续 renderer 逻辑从 `runtimeUiConfig` 取配置

补充事实：

- `DESKTOP_LIVE2D_CONFIG_PATH` 可以覆盖默认路径；默认仍是 `~/yachiyo/config/desktop-live2d.json`
- `normalizeUiConfig()` 只保留当前 schema 已定义字段；额外字段不会进入运行时 `uiConfig`
- layout/drag zone 写回链会先读取原始 JSON，再只改目标字段，所以未知字段通常会继续保留在文件里

### 1.3 语音链单独说明

`voice.path` 不只影响 desktop main，也会影响 runtime tool adapter：

1. `apps/runtime/tooling/adapters/voice.js`
   - `resolveDesktopLive2dConfigPath()`
   - `loadVoicePathMode()`
2. 当 `voice.path = electron_native`
   - `ttsAliyunVc()` 发布 `voice.requested`
3. `apps/gateway/server.js`
   - 透传 `voice.*` 事件
4. `apps/desktop-live2d/main/desktopSuite.js`
   - 在 gateway notification 分发中接 `voice.requested`
   - `processVoiceRequestedEvent()` 决定 `realtime` / `non_streaming`
5. `apps/desktop-live2d/renderer/bootstrap.js`
   - 监听 `desktop:voice:stream-*` 或 `desktop:voice:play-*`

## 2. 兼容性与格式规则

- 配置文件允许 JSON 注释
  - `apps/desktop-live2d/main/config.js`
    - `stripJsonComments()`
    - `parseJsonWithComments()`
  - `apps/runtime/tooling/adapters/voice.js`
    - `stripJsonComments()`
    - `loadVoicePathMode()`
- `voice` 段兼容以下旧字段别名：
  - `voice.fallback_on_realtime_error`
  - `voice.realtime.prebuffer_ms`
  - `voice.realtime.idle_timeout_ms`
- 未在当前 schema 中声明的字段：
  - 读取阶段会被 `normalizeUiConfig()` 丢弃，不会进入 main/renderer 运行时对象
  - 但若后续触发 layout/drag zone 写回，原始字段通常仍会保留在文件中

## 3. 参数总览

### 3.1 `window.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `window.width` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `createMainWindow()` | 启动窗口链 | avatar 主窗口展开态默认宽度 |
| `window.height` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `createMainWindow()` | 启动窗口链 | avatar 主窗口展开态默认高度 |
| `window.minWidth` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `createMainWindow()`, `resolveAspectLockedWindowSize()` | 启动/resize 链 | avatar 窗口最小宽度约束 |
| `window.minHeight` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `createMainWindow()`, `resolveAspectLockedWindowSize()` | 启动/resize 链 | avatar 窗口最小高度约束 |
| `window.maxWidth` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `createMainWindow()`, `resolveAspectLockedWindowSize()` | 启动/resize 链 | avatar 窗口最大宽度约束 |
| `window.maxHeight` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `createMainWindow()`, `resolveAspectLockedWindowSize()` | 启动/resize 链 | avatar 窗口最大高度约束 |
| `window.compactWhenChatHidden` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `resolveWindowSizeForChatPanel()` | 聊天面板显隐链 | `chat panel` 隐藏时是否切到 compact 尺寸 |
| `window.compactWidth` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `resolveWindowSizeForChatPanel()` | 聊天面板显隐链 | compact 态宽度 |
| `window.compactHeight` | `apps/desktop-live2d/main/desktopSuite.js` | `resolveWindowMetrics()`, `resolveWindowSizeForChatPanel()` | 聊天面板显隐链 | compact 态高度 |
| `window.placement.anchor` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()` | 首次启动定位链 | 支持 `bottom-right/top-left/top-right/bottom-left/center/custom` |
| `window.placement.marginRight` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()`, `computeRightBottomWindowBounds()` | 首次启动定位链 | 右边距 |
| `window.placement.marginBottom` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()`, `computeRightBottomWindowBounds()` | 首次启动定位链 | 下边距 |
| `window.placement.marginLeft` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()` | 首次启动定位链 | 兼容支持字段，模板未显式写出 |
| `window.placement.marginTop` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()` | 首次启动定位链 | 兼容支持字段，模板未显式写出 |
| `window.placement.x` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()` | 首次启动定位链 | 仅在 `anchor = custom` 时生效 |
| `window.placement.y` | `apps/desktop-live2d/main/desktopSuite.js` | `createMainWindow()`, `computeWindowBounds()` | 首次启动定位链 | 仅在 `anchor = custom` 时生效 |

### 3.2 `render.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `render.resolutionScale` | `apps/desktop-live2d/renderer/bootstrap.js` | `initPixi()` | renderer 初始化链 | 与 `window.devicePixelRatio` 相乘后再做上限裁剪 |
| `render.maxDevicePixelRatio` | `apps/desktop-live2d/renderer/bootstrap.js` | `initPixi()` | renderer 初始化链 | renderer resolution 上限 |
| `render.antialias` | `apps/desktop-live2d/renderer/bootstrap.js` | `initPixi()` | renderer 初始化链 | PIXI renderer 抗锯齿开关 |

### 3.3 `interaction.dragZone.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `interaction.dragZone.centerXRatio` | `apps/desktop-live2d/renderer/bootstrap.js` | `getCurrentDragZoneValues()`, `normalizeDragZoneValues()`, `syncWindowInteractivityFromPointer()` | 窗口穿透/拖拽链 | 定义可拖拽热区中心 X |
| `interaction.dragZone.centerYRatio` | `apps/desktop-live2d/renderer/bootstrap.js` | `getCurrentDragZoneValues()`, `normalizeDragZoneValues()`, `syncWindowInteractivityFromPointer()` | 窗口穿透/拖拽链 | 定义可拖拽热区中心 Y |
| `interaction.dragZone.widthRatio` | `apps/desktop-live2d/renderer/bootstrap.js` | `getCurrentDragZoneValues()`, `normalizeDragZoneValues()`, `syncWindowInteractivityFromPointer()` | 窗口穿透/拖拽链 | 热区宽度比例 |
| `interaction.dragZone.heightRatio` | `apps/desktop-live2d/renderer/bootstrap.js` | `getCurrentDragZoneValues()`, `normalizeDragZoneValues()`, `syncWindowInteractivityFromPointer()` | 窗口穿透/拖拽链 | 热区高度比例 |

说明：

- 热区命中判断没有单独命名成 `isPointInsideDragZone()`；当前实现是 `syncWindowInteractivityFromPointer()` 内部的几何判断
- `resize mode` 打开时，这条链会切回整窗可交互，不受 drag zone 限制

拖拽框调参链额外经过：

- `apps/desktop-live2d/renderer/bootstrap.js`
  - `setDragZonePanelOpen()`
  - `applyDragZoneValues()`
  - `saveDragZoneValues()`
- `apps/desktop-live2d/main/desktopSuite.js`
  - `persistDragZoneOverrides()`
- `apps/desktop-live2d/main/config.js`
  - `upsertDesktopLive2dDragZoneOverrides()`

### 3.4 `layout.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `layout.targetWidthRatio` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | 模型目标占宽比例 |
| `layout.targetHeightRatio` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | 模型目标占高比例 |
| `layout.anchorXRatio` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | 模型在窗口中的锚点 X |
| `layout.anchorYRatio` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | 模型在窗口中的锚点 Y |
| `layout.offsetX` | `apps/desktop-live2d/renderer/layout.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/main/desktopSuite.js` | `computeModelLayout()`, `applyLayoutTunerValues()`, `persistLayoutOverrides()` | 模型自动布局链 / resize mode 调参链 | 主调参项之一 |
| `layout.offsetY` | `apps/desktop-live2d/renderer/layout.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/main/desktopSuite.js` | `computeModelLayout()`, `applyLayoutTunerValues()`, `persistLayoutOverrides()` | 模型自动布局链 / resize mode 调参链 | 主调参项之一 |
| `layout.marginX` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型可见区域约束链 | 横向安全边距 |
| `layout.marginY` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型可见区域约束链 | 纵向安全边距 |
| `layout.minVisibleRatioX` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()`, `clampModelPositionToViewport()` | 模型可见区域约束链 | 横向最小可见比例 |
| `layout.minVisibleRatioY` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()`, `clampModelPositionToViewport()` | 模型可见区域约束链 | 纵向最小可见比例 |
| `layout.pivotXRatio` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | 模型 bounds 内部 pivot X |
| `layout.pivotYRatio` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | 模型 bounds 内部 pivot Y |
| `layout.scaleMultiplier` | `apps/desktop-live2d/renderer/layout.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/main/desktopSuite.js` | `computeModelLayout()`, `applyLayoutTunerValues()`, `persistLayoutOverrides()` | 模型自动布局链 / resize mode 调参链 | 主调参项之一 |
| `layout.minScale` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | fit scale 下限 |
| `layout.maxScale` | `apps/desktop-live2d/renderer/layout.js` | `computeModelLayout()` | 模型自动布局链 | fit scale 上限 |
| `layout.lockScaleOnResize` | `apps/desktop-live2d/renderer/bootstrap.js` | `applyAdaptiveLayout()` | resize mode / 窗口尺寸变化链 | `false` 时窗口变化跟随重新缩放 |
| `layout.lockPositionOnResize` | `apps/desktop-live2d/renderer/bootstrap.js` | `applyAdaptiveLayout()` | resize mode / 窗口尺寸变化链 | `true` 时普通模式优先保持已稳定位置 |

layout 调参保存只会回写这三个字段：

- `offsetX`
- `offsetY`
- `scaleMultiplier`

对应函数：
- `apps/desktop-live2d/main/config.js`
  - `upsertDesktopLive2dLayoutOverrides()`

### 3.5 `chat.panel.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `chat.panel.enabled` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `resolveWindowMetrics()`, `initChatPanel()` | 聊天面板链 | 控制 chat panel 是否启用；avatar renderer 收到的是 `avatarUiConfig`，其中 `panel.enabled` 会被强制改成 `false` |
| `chat.panel.defaultVisible` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `resolveWindowMetrics()`, `startDesktopSuite()`, `initChatPanel()` | 聊天面板链 | 控制默认显示状态 |
| `chat.panel.width` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `createChatWindow()`, `initChatPanel()` | 聊天窗口创建链 | 决定独立 chat 窗口尺寸；avatar 页内 panel 也会套同尺寸样式 |
| `chat.panel.height` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `createChatWindow()`, `initChatPanel()` | 聊天窗口创建链 | 决定独立 chat 窗口尺寸；avatar 页内 panel 也会套同尺寸样式 |
| `chat.panel.maxMessages` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/chatPanelState.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `startDesktopSuite()`, `syncChatStateSummary()`, `createInitialState()` | 聊天消息保留链 | chat 历史截断上限 |
| `chat.panel.inputEnabled` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/renderer/chat.js` | `startDesktopSuite()`, `initChatPanel()`, `applyStateSync()` | 聊天输入链 | 控制输入框、发送按钮、图片上传可用性 |

### 3.6 `chat.bubble.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `chat.bubble.mirrorToPanel` | `apps/desktop-live2d/renderer/bootstrap.js` | `showBubble()` | bubble 渲染链 | assistant bubble 是否镜像写入 chat panel |
| `chat.bubble.width` | `apps/desktop-live2d/main/desktopSuite.js` | `startDesktopSuite()`, `createBubbleWindow()`, `computeBubbleWindowBounds()` | bubble 窗口创建链 | bubble 独立窗口宽度 |
| `chat.bubble.height` | `apps/desktop-live2d/main/desktopSuite.js` | `startDesktopSuite()`, `createBubbleWindow()`, `computeBubbleWindowBounds()` | bubble 窗口创建链 | bubble 独立窗口高度 |
| `chat.bubble.stream.lineDurationMs` | `apps/desktop-live2d/main/desktopSuite.js` | `startDesktopSuite()`, `showBubble()` | 非 streaming bubble 展示链 | 非流式输出时传给 `showBubble({ durationMs })` 的显示时长 |
| `chat.bubble.stream.launchIntervalMs` | `apps/desktop-live2d/main/desktopSuite.js` | `startDesktopSuite()`, `ensureStreamingLaunchTimer()`, `launchNextStreamingSentence()`, `ensureStreamingDrainTimer()` | bubble streaming 链 | streaming 句子出队与尾部 drain 的基准节奏 |

补充事实：

- `lineDurationMs` 当前没有参与 streaming 字幕逐句生命周期；它只用于最终整段 `showBubble()` 的展示时长
- `launchIntervalMs` 会先进入 `bubbleRuntimeConfig`，再被 streaming 定时器读取

### 3.7 `actionQueue.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `actionQueue.maxQueueSize` | `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/renderer/live2dActionQueuePlayer.js` | `ensureActionQueuePlayer()`, `enqueue()` | Live2D action 队列链 | 动作队列容量 |
| `actionQueue.overflowPolicy` | `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/renderer/live2dActionQueuePlayer.js` | `ensureActionQueuePlayer()`, `enqueue()` | Live2D action 队列链 | 支持 `drop_oldest/drop_newest/reject` |
| `actionQueue.idleFallbackEnabled` | `apps/desktop-live2d/renderer/bootstrap.js` | `ensureActionQueuePlayer()` | Live2D action idle 回退链 | `false` 时不注入 idleAction |
| `actionQueue.idleAction.type` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `normalizeUiConfig()`, `ensureActionQueuePlayer()` | Live2D action idle 回退链 | 支持 `motion` 或 `expression` |
| `actionQueue.idleAction.name` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `normalizeUiConfig()`, `ensureActionQueuePlayer()` | Live2D action idle 回退链 | idle action 名称 |
| `actionQueue.idleAction.args.group` | `apps/desktop-live2d/main/config.js` | `normalizeUiConfig()` | Live2D action idle 回退链 | `type = motion` 时 motion group |
| `actionQueue.idleAction.args.index` | `apps/desktop-live2d/main/config.js` | `normalizeUiConfig()` | Live2D action idle 回退链 | `type = motion` 时 motion index |

### 3.8 `voice.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `voice.path` | `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/config.js` | `loadVoicePathMode()`, `normalizeUiConfig()` | runtime TTS 路由链 | `electron_native` 走 `voice.requested`；`runtime_legacy` 走 `voice.playback.electron` |
| `voice.transport` | `apps/desktop-live2d/main/desktopSuite.js` | `processVoiceRequestedEvent()` | desktop main 语音播放链 | `realtime` 或 `non_streaming` |
| `voice.fallbackOnRealtimeError` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/main/config.js` | `processVoiceRequestedEvent()`, `normalizeUiConfig()` | realtime TTS 容错链 | realtime 失败后是否回落到 non-streaming |
| `voice.realtime.prebufferMs` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/renderer/realtimeVoicePlayer.js` | `processVoiceRequestedEvent()`, `startRealtimeVoicePlayback()`, `startSession()` | realtime TTS 播放链 | 首包播放前预缓冲毫秒数 |
| `voice.realtime.idleTimeoutMs` | `apps/desktop-live2d/main/desktopSuite.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/renderer/realtimeVoicePlayer.js` | `processVoiceRequestedEvent()`, `startRealtimeVoicePlayback()`, `startSession()` | realtime TTS 播放链 | realtime chunk 超时自动结束 |

### 3.9 `debug.*`

这一组字段已经接线，且当前主要用于嘴形调试。

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `debug.mouthTuner.visible` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `normalizeUiConfig()`, `getMouthTunerRuntimeConfig()`, `setMouthTunerVisible()` | renderer 调试 UI 链 | 控制 `Mouth Tuner` 按钮和面板是否可见 |
| `debug.mouthTuner.enabled` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `normalizeUiConfig()`, `getMouthTunerRuntimeConfig()`, `setMouthTunerEnabled()` | renderer 调试 override 链 | 启动时是否默认开启嘴形 override |
| `debug.waveformCapture.enabled` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/main/desktopSuite.js` | `normalizeUiConfig()`, `getWaveformCaptureRuntimeConfig()`, `createMouthWaveformRecorder()` | 逐帧波形记录链 | 是否按 `request_id` 落盘完整嘴形波形 |
| `debug.waveformCapture.captureEveryFrame` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js` | `normalizeUiConfig()`, `getWaveformCaptureRuntimeConfig()` | renderer debug marker 链 | `true` 时每帧输出 `chain.renderer.mouth.frame_sample`，而不是只按 30 帧抽样 |
| `debug.waveformCapture.includeApplied` | `apps/desktop-live2d/main/config.js`, `apps/desktop-live2d/renderer/bootstrap.js`, `apps/desktop-live2d/main/desktopSuite.js` | `normalizeUiConfig()`, `getWaveformCaptureRuntimeConfig()`, `createMouthWaveformRecorder()` | 最终落模回读链 | `true` 时同时记录 `chain.renderer.lipsync.frame_applied` |

补充事实：

- 这组字段会进入 `normalizeUiConfig()` 返回的运行时对象。
- renderer 通过 `bridge.getRuntimeConfig()` 读取后，`Mouth Tuner` 和 waveform capture 都会真正生效。
- waveform recorder 的默认落盘目录不由 `desktop-live2d.json` 控制，而是 main 进程环境路径：
  - `~/yachiyo/data/desktop-live2d/mouth-waveforms`
  - 或 `DESKTOP_LIVE2D_MOUTH_WAVEFORM_DIR`

## 4. 已定义但当前未接线的字段

以下字段在 `DEFAULT_UI_CONFIG` 中存在，但当前 app 主链代码扫描未发现消费点：

| 参数 | 定义位置 | 现状 |
| --- | --- | --- |
| `chat.bubble.truncate.enabled` | `apps/desktop-live2d/shared/defaultUiConfig.js` | 未接线 |
| `chat.bubble.truncate.maxLength` | `apps/desktop-live2d/shared/defaultUiConfig.js` | 未接线 |
| `chat.bubble.truncate.mode` | `apps/desktop-live2d/shared/defaultUiConfig.js` | 未接线 |
| `chat.bubble.truncate.suffix` | `apps/desktop-live2d/shared/defaultUiConfig.js` | 未接线 |
| `chat.bubble.truncate.showHintForComplex` | `apps/desktop-live2d/shared/defaultUiConfig.js` | 未接线 |

文档上应把这些字段视为“保留位”，不要当成功能已经落地。

补充事实：

- 仓库里有 `test/desktop-live2d/bubbleTruncate.test.js`
- 这组测试只验证默认值和候选截断算法，并不代表 renderer/main 当前已经把 `chat.bubble.truncate.*` 接进渲染链

## 5. 持久化回写链

### 5.1 layout tuner

1. renderer:
   - `apps/desktop-live2d/renderer/bootstrap.js`
   - `saveLayoutTunerValues()`
2. main:
   - `apps/desktop-live2d/main/desktopSuite.js`
   - `persistLayoutOverrides()`
3. config writer:
   - `apps/desktop-live2d/main/config.js`
   - `upsertDesktopLive2dLayoutOverrides()`

只会写回：
- `layout.offsetX`
- `layout.offsetY`
- `layout.scaleMultiplier`

### 5.2 drag zone tuner

1. renderer:
   - `apps/desktop-live2d/renderer/bootstrap.js`
   - `saveDragZoneValues()`
2. main:
   - `apps/desktop-live2d/main/desktopSuite.js`
   - `persistDragZoneOverrides()`
3. config writer:
   - `apps/desktop-live2d/main/config.js`
   - `upsertDesktopLive2dDragZoneOverrides()`

只会写回：
- `interaction.dragZone.centerXRatio`
- `interaction.dragZone.centerYRatio`
- `interaction.dragZone.widthRatio`
- `interaction.dragZone.heightRatio`

## 6. 推荐维护规则

- 运行时请改 `~/yachiyo/config/desktop-live2d.json`，不要把仓库模板当成当前生效配置
- 想调模型站位，优先改 `layout.offsetX / offsetY / scaleMultiplier`
- 想调可拖拽热区，优先改 `interaction.dragZone.*`
- 想调语音路由，先看 `voice.path`，再看 `voice.transport`
- 碰到字段存在但没效果，先查本文档第 4 章，确认它是不是尚未接线
