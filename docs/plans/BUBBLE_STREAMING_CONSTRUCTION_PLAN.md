# Desktop Live2D 气泡流式输出施工计划

## 1. 需求概述

为桌面端回复消息气泡添加流式输出能力，让用户实时看到 LLM 生成回复的过程，提升交互体验。

## 2. 技术方案

**方案选择**：方案 A - 增量追加模式 + 节流优化

**核心机制**：
- 监听 `message.delta` 事件，实时追加文本
- 使用节流（50ms）避免过于频繁的 IPC 通信
- 流式期间延长气泡显示时间，避免自动隐藏
- 兼容无 delta 的旧流程（仅 `runtime.final`）

## 3. 架构设计

### 3.1 数据流

```
Runtime (LLM生成)
  ↓ message.delta 事件
GatewayRuntimeClient (WebSocket)
  ↓ desktopEvent
desktopSuite.js (Main Process)
  ↓ updateBubbleStreaming()
  ↓ IPC: bubbleStateSync
bubble.js (Renderer Process)
  ↓ applyBubbleState()
DOM 更新
```

### 3.2 状态管理

```javascript
streamingState = {
  active: false,           // 是否正在流式输出
  sessionId: null,         // 当前会话ID
  traceId: null,           // 当前追踪ID
  accumulatedText: '',     // 累积的文本
  lastUpdateTime: 0        // 最后更新时间
}
```

## 4. 施工阶段

### Phase 1: 基础架构 - 流式状态管理

**目标**：在 `desktopSuite.js` 中添加流式状态管理和 delta 事件监听

**改动文件**：
- `apps/desktop-live2d/main/desktopSuite.js`

**实现内容**：
1. 添加 `streamingState` 状态对象
2. 添加 `bubbleStreamingThrottle` 节流定时器
3. 在 `gatewayRuntimeClient.onNotification` 中添加 `message.delta` 分支处理
4. 实现 `updateBubbleStreaming(delta)` 函数
5. 修改 `runtime.final` 处理逻辑，支持流式结束

**验收标准**：
- ✅ 能接收并累积 delta 事件
- ✅ 节流机制生效（50ms 内多次 delta 只触发一次更新）
- ✅ 流式结束后正确重置状态

### Phase 2: 气泡渲染增强

**目标**：让气泡窗口支持流式更新和视觉反馈

**改动文件**：
- `apps/desktop-live2d/renderer/bubble.js`
- `apps/desktop-live2d/renderer/bubble.html`

**实现内容**：
1. `bubble.js` 的 `applyBubbleState()` 支持 `streaming` 标志
2. 添加 `.streaming` CSS 类，可选添加打字机光标效果
3. 流式期间禁用自动隐藏计时器

**验收标准**：
- ✅ 流式期间气泡持续显示
- ✅ 文本实时更新
- ✅ 气泡尺寸自动调整

### Phase 3: 向后兼容处理

**目标**：确保无 delta 的旧流程仍然正常工作

**改动文件**：
- `apps/desktop-live2d/main/desktopSuite.js`

**实现内容**：
1. 在 `runtime.final` 处理中检查 `streamingState.active`
2. 如果未启用流式，走原有逻辑
3. 如果启用流式，使用 final 的 output 作为最终文本

**验收标准**：
- ✅ 有 delta 时流式显示
- ✅ 无 delta 时一次性显示
- ✅ 两种模式都能正确显示气泡

### Phase 4: 测试覆盖

**目标**：编写单元测试和集成测试

**新增文件**：
- `test/desktop-live2d/bubbleStreaming.test.js`

**测试用例**：
1. 流式状态初始化和重置
2. delta 事件累积文本
3. 节流机制验证
4. runtime.final 结束流式
5. 无 delta 的兼容性
6. 多会话隔离

**验收标准**：
- ✅ 所有测试用例通过
- ✅ 测试覆盖率 > 80%

### Phase 5: 文档和调试工具

**目标**：补充文档和调试辅助

**改动文件**：
- `docs/modules/desktop-live2d/module-reference.md`
- `README.md`

**实现内容**：
1. 更新模块文档，说明流式输出机制
2. 添加调试日志（通过 `emitDesktopDebug`）
3. 更新 README 的功能清单

**验收标准**：
- ✅ 文档清晰描述流式输出流程
- ✅ 调试日志可通过 SSE debugger 观察

## 5. 技术细节

### 5.1 节流策略

```javascript
if (bubbleStreamingThrottle) {
  clearTimeout(bubbleStreamingThrottle);
}

bubbleStreamingThrottle = setTimeout(() => {
  showBubble({
    text: streamingState.accumulatedText,
    durationMs: 30000, // 流式期间保持显示
    streaming: true
  });
}, 50); // 50ms 节流
```

### 5.2 流式结束处理

```javascript
if (desktopEvent.type === 'runtime.final') {
  if (streamingState.active) {
    // 流式模式：使用 final 的完整 output
    const output = String(desktopEvent.data?.output || '').trim();
    showBubble({
      text: output || streamingState.accumulatedText,
      durationMs: 5000,
      streaming: false
    });
    streamingState.active = false;
    streamingState.accumulatedText = '';
  } else {
    // 兼容模式：原有逻辑
    const output = String(desktopEvent.data?.output || '').trim();
    if (output) {
      showBubble({ text: output, durationMs: 5000 });
    }
  }
}
```

### 5.3 会话隔离

```javascript
if (desktopEvent.type === 'message.delta') {
  const currentSessionId = desktopEvent.data?.session_id;
  const currentTraceId = desktopEvent.data?.trace_id;

  // 新会话/新追踪：重置流式状态
  if (streamingState.active &&
      (streamingState.sessionId !== currentSessionId ||
       streamingState.traceId !== currentTraceId)) {
    streamingState.active = false;
    streamingState.accumulatedText = '';
  }

  streamingState.sessionId = currentSessionId;
  streamingState.traceId = currentTraceId;
}
```

## 6. 风险和缓解

### 6.1 性能风险

**风险**：高频 delta 事件导致 IPC 通信过载

**缓解**：
- 使用 50ms 节流
- 气泡窗口使用 `requestAnimationFrame` 批量更新 DOM

### 6.2 气泡闪烁

**风险**：频繁调整气泡尺寸导致视觉闪烁

**缓解**：
- 使用 CSS `transition` 平滑过渡
- `ResizeObserver` 已有延迟机制（60ms）

### 6.3 会话混淆

**风险**：多会话并发时 delta 事件混淆

**缓解**：
- 通过 `session_id` 和 `trace_id` 隔离
- 新会话开始时重置流式状态

## 7. 验收标准

### 7.1 功能验收

- ✅ 用户发送消息后，气泡实时显示 LLM 生成的回复
- ✅ 流式期间气泡不会自动隐藏
- ✅ 流式结束后气泡显示 5 秒后自动隐藏
- ✅ 无 delta 的旧流程仍然正常工作

### 7.2 性能验收

- ✅ IPC 通信频率 < 20 次/秒（50ms 节流）
- ✅ 气泡更新延迟 < 100ms
- ✅ CPU 占用无明显增加

### 7.3 测试验收

- ✅ 单元测试覆盖率 > 80%
- ✅ 所有测试用例通过
- ✅ 手动测试通过（发送消息观察气泡流式显示）

## 8. 施工顺序

1. **Phase 1**：基础架构（30 分钟）→ Commit + Test
2. **Phase 2**：气泡渲染（20 分钟）→ Commit + Test
3. **Phase 3**：向后兼容（15 分钟）→ Commit + Test
4. **Phase 4**：测试覆盖（30 分钟）→ Commit
5. **Phase 5**：文档更新（15 分钟）→ Commit

**总计**：约 2 小时

## 9. 回滚计划

如果出现严重问题，可以通过以下方式回滚：

```bash
# 回滚到实施前的提交
git revert <commit-hash>

# 或者禁用流式输出（配置开关）
# 在 config/desktop-live2d.json 中添加：
{
  "bubble": {
    "streaming": false
  }
}
```

## 10. 后续优化

- 添加打字机光标动画
- 支持 Markdown 渲染
- 支持代码块语法高亮
- 添加流式速度配置（节流时间可调）
