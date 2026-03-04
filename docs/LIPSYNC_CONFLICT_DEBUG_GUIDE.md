# 嘴形同步与表情动作冲突调试指南

> 历史文档。主要记录 2026-03-01 左右的旧排查过程，不代表当前主线实现。当前 lipsync 链路、face mixer、waveform recorder，请以 `docs/VOICE_LIPSYNC_DEBUG_GUIDE.md` 和 `docs/process/desktop-live2d-lipsync-waveform-tuning-log.md` 为准。

## 已添加的调试日志

我已经在 `apps/desktop-live2d/renderer/bootstrap.js` 中添加了以下调试日志：

### 1. 嘴形同步生命周期

- **`[lipsync] playAudioWithLipSync start`** - 语音播放开始
- **`[lipsync] stopLipSync called`** - 嘴形同步停止被调用
  - 关键字段：`hasTickerHook`, `hasModelHook`, `currentMouthOpen`, `hasRafId`
- **`[lipsync] detaching ticker hook`** - 移除 ticker 钩子
- **`[lipsync] detaching model hook`** - 移除模型更新钩子
- **`[lipsync] apply frame`** - 嘴形帧更新（每秒1次）
  - 关键字段：`hasRafId`, `target`, `current`
- **`[lipsync] apply frame skipped - no RAF`** - 帧更新被跳过（每5秒1次）

### 2. 表情和动作执行

- **`[live2d] setModelExpression start`** - 表情设置开始
  - 关键字段：`name`, `hasLipsyncActive`, `hasTickerHook`, `hasModelHook`
- **`[live2d] setModelExpression completed`** - 表情设置完成
- **`[live2d] playModelMotion start`** - 动作播放开始
  - 关键字段：`group`, `index`, `hasLipsyncActive`, `hasTickerHook`, `hasModelHook`
- **`[live2d] playModelMotion completed`** - 动作播放完成

## 如何调试

### 方法 1：使用 Desktop 开发者工具（推荐）

1. **启动 Desktop**
   ```bash
   npm run desktop:up
   ```

2. **打开开发者工具**
   - 在 Desktop 窗口中按 `Cmd+Option+I` (macOS) 或 `Ctrl+Shift+I` (Windows/Linux)
   - 或者在代码中添加 `webContents.openDevTools()` 到 `apps/desktop-live2d/main/desktopSuite.js`

3. **切换到 Console 标签**

4. **过滤日志**
   - 在 Console 的过滤框中输入：`lipsync live2d`
   - 这样只会显示相关的调试日志

5. **触发问题场景**
   - 让 yachiyo 说话（通过聊天或语音输入）
   - 等待语音播放结束
   - 尝试设置表情或播放动作

6. **观察日志输出**

### 方法 2：使用测试脚本

1. **启动 Desktop**
   ```bash
   npm run desktop:up
   ```

2. **打开开发者工具**（同上）

3. **运行测试脚本**
   ```bash
   node scripts/test-lipsync-expression-conflict.js
   ```

4. **在开发者工具的 Console 中观察日志**

## 预期的日志流

### 正常情况（无冲突）

```
[lipsync] playAudioWithLipSync start {...}
[lipsync] apply frame {"hasRafId":true,"target":0.45,...}
[lipsync] apply frame {"hasRafId":true,"target":0.52,...}
[lipsync] stopLipSync called {"hasTickerHook":true,"hasModelHook":true,...}
[lipsync] detaching ticker hook
[lipsync] detaching model hook
[live2d] setModelExpression start {"name":"smile","hasLipsyncActive":false,"hasTickerHook":false,"hasModelHook":false}
[live2d] setModelExpression completed {"name":"smile","ok":true}
```

### 异常情况（有冲突）

```
[lipsync] playAudioWithLipSync start {...}
[lipsync] apply frame {"hasRafId":true,"target":0.45,...}
[lipsync] stopLipSync called {"hasTickerHook":true,"hasModelHook":true,...}
❌ 缺少：[lipsync] detaching ticker hook
❌ 缺少：[lipsync] detaching model hook
[live2d] setModelExpression start {"name":"smile","hasLipsyncActive":true,"hasTickerHook":true,"hasModelHook":true}
[lipsync] apply frame {"hasRafId":false,"target":0,...}  ← 仍在运行！
[live2d] setModelExpression completed {"name":"smile","ok":true}
```

## 关键诊断点

### 1. 检查钩子是否被清理

在 `stopLipSync called` 日志中查看：
- `hasTickerHook`: 应该在停止后变为 `false`
- `hasModelHook`: 应该在停止后变为 `false`

如果这两个值在停止后仍然是 `true`，说明钩子没有被清理。

### 2. 检查表情执行时的嘴形状态

在 `setModelExpression start` 日志中查看：
- `hasLipsyncActive`: 应该是 `false`（语音已结束）
- `hasTickerHook`: 应该是 `false`（钩子已清理）
- `hasModelHook`: 应该是 `false`（钩子已清理）

如果这些值是 `true`，说明嘴形同步仍在干扰表情。

### 3. 检查帧更新是否继续

在表情设置后，如果仍然看到 `[lipsync] apply frame` 日志，说明：
- 嘴形同步的钩子没有被完全清理
- 参数更新仍在覆盖表情参数

## 已实施的修复

我已经在代码中实施了以下修复：

### 修复 1：完全清理嘴形同步钩子

在 `stopLipSync()` 函数中添加了钩子清理逻辑：

```javascript
function stopLipSync() {
  console.log('[lipsync] stopLipSync called', {...});
  stopLipSyncFrame();
  teardownLipSyncPlaybackListeners();

  // 新增：清理 ticker 钩子
  if (detachLipSyncTicker) {
    console.log('[lipsync] detaching ticker hook');
    detachLipSyncTicker();
  }

  // 新增：清理模型更新钩子
  if (detachLipSyncModelHook) {
    console.log('[lipsync] detaching model hook');
    detachLipSyncModelHook();
  }
}
```

### 修复 2：在 applyLipSyncForCurrentFrame 中添加 RAF 检查

```javascript
function applyLipSyncForCurrentFrame() {
  // 新增：检查 RAF 是否激活
  if (!lipsyncRafId) {
    // RAF 已停止，不应该继续更新参数
    return;
  }
  // ... 现有逻辑
}
```

这样即使钩子没有被移除，也不会在 RAF 停止后继续更新参数。

## 下一步

1. **重启 Desktop** 以应用代码更改
   ```bash
   # 停止当前的 Desktop
   # 然后重新启动
   npm run desktop:up
   ```

2. **打开开发者工具**

3. **重现问题**
   - 让 yachiyo 说话
   - 等待语音结束
   - 尝试设置表情

4. **检查日志**
   - 确认钩子是否被清理
   - 确认表情执行时嘴形是否仍然激活
   - 确认帧更新是否停止

5. **报告结果**
   - 如果问题解决，表情应该正常显示
   - 如果问题仍然存在，请提供完整的日志输出

## 故障排除

### 问题：看不到日志

**原因**：开发者工具可能没有打开，或者日志被过滤了。

**解决**：
1. 确保开发者工具已打开
2. 清除 Console 的过滤器
3. 检查日志级别设置（应该包括 `Info` 和 `Log`）

### 问题：日志太多

**原因**：`[lipsync] apply frame` 每秒输出一次。

**解决**：
- 使用 Console 的过滤功能
- 输入 `-"apply frame"` 来排除这些日志
- 或者只关注关键的 `start` 和 `completed` 日志

### 问题：表情仍然不响应

**原因**：可能还有其他问题。

**解决**：
1. 检查日志中的 `hasTickerHook` 和 `hasModelHook` 值
2. 如果它们仍然是 `true`，说明钩子清理逻辑有问题
3. 提供完整的日志输出以便进一步分析
