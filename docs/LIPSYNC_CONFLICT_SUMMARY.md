# 嘴形同步与表情动作冲突问题 - 调查总结

> 历史文档。主要记录 2026-03-01 左右的旧冲突调查，不代表当前主线 lipsync/face mixer 实现。现状请看 `docs/VOICE_LIPSYNC_DEBUG_GUIDE.md`。

## 问题描述

当 yachiyo 说完话后，可能由于嘴形和动作的冲突，yachiyo 不会响应其他表情动作（如笑、哭）。

## 根本原因分析

通过代码分析，我发现了以下问题：

### 问题 1：嘴形同步钩子未完全清理 ⚠️

**位置**：`apps/desktop-live2d/renderer/bootstrap.js:464-467`

**原始代码**：
```javascript
function stopLipSync() {
  stopLipSyncFrame();
  teardownLipSyncPlaybackListeners();
  // ❌ 缺失：未移除 detachLipSyncTicker
  // ❌ 缺失：未移除 detachLipSyncModelHook
}
```

**问题**：
- `bindLipSyncTicker()` 绑定的 Pixi ticker 钩子未被移除
- `bindLipSyncModelHook()` 绑定的 `beforeModelUpdate` 钩子未被移除
- 即使语音播放结束，`applyLipSyncForCurrentFrame()` 仍在每帧执行

### 问题 2：嘴形参数持续覆盖表情参数 ⚠️

**位置**：`apps/desktop-live2d/renderer/bootstrap.js:304-340`

**问题**：
- `applyLipSyncForCurrentFrame()` 通过 `beforeModelUpdate` 钩子在每帧执行
- 使用 `addParameterValueById` 持续更新嘴部参数
- 在表情设置参数后，嘴形钩子仍然会覆盖这些参数

### 问题 3：缺少 RAF 激活状态检查 ⚠️

**问题**：
- `applyLipSyncForCurrentFrame()` 没有检查 `lipsyncRafId` 是否激活
- 即使 RAF 循环已停止，钩子仍然会尝试更新参数

## 已实施的修复

### 修复 1：完全清理嘴形同步钩子 ✅

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

**效果**：
- 确保语音播放结束后，所有嘴形同步钩子被完全移除
- 防止嘴形参数更新继续干扰后续的表情动作

### 修复 2：添加 RAF 激活状态检查 ✅

```javascript
function applyLipSyncForCurrentFrame() {
  // 新增：检查 RAF 是否激活
  if (!lipsyncRafId) {
    // RAF 已停止，不应该继续更新参数
    return;
  }

  if (lipsyncCurrentMouthOpen <= 0 && Math.abs(lipsyncCurrentMouthForm) <= 1e-4) {
    return;
  }

  // ... 现有逻辑
}
```

**效果**：
- 即使钩子没有被移除，也不会在 RAF 停止后继续更新参数
- 提供双重保护，确保嘴形同步完全停止

### 修复 3：添加详细的调试日志 ✅

在关键位置添加了调试日志：
- 语音播放开始/结束
- 嘴形同步启动/停止
- 钩子清理状态
- 表情/动作执行时的嘴形状态
- 帧更新状态

**效果**：
- 可以实时观察嘴形同步和表情动作的执行流程
- 快速诊断问题是否解决
- 便于后续维护和调试

## 验证方法

### 方法 1：使用 Desktop 开发者工具（推荐）

1. 启动 Desktop：`npm run desktop:up`
2. 打开开发者工具：`Cmd+Option+I` (macOS) 或 `Ctrl+Shift+I` (Windows/Linux)
3. 在 Console 中过滤：`lipsync live2d`
4. 让 yachiyo 说话，然后尝试设置表情
5. 观察日志输出

### 方法 2：使用测试脚本

1. 启动 Desktop：`npm run desktop:up`
2. 打开开发者工具
3. 运行测试：`node scripts/test-lipsync-expression-conflict.js`
4. 观察日志输出

## 预期结果

### 修复前（异常情况）

```
[lipsync] stopLipSync called {"hasTickerHook":true,"hasModelHook":true,...}
❌ 缺少钩子清理日志
[live2d] setModelExpression start {"hasLipsyncActive":true,"hasTickerHook":true,...}
[lipsync] apply frame {...}  ← 仍在运行！
```

### 修复后（正常情况）

```
[lipsync] stopLipSync called {"hasTickerHook":true,"hasModelHook":true,...}
[lipsync] detaching ticker hook  ✅
[lipsync] detaching model hook  ✅
[live2d] setModelExpression start {"hasLipsyncActive":false,"hasTickerHook":false,...}  ✅
[live2d] setModelExpression completed {"ok":true}  ✅
```

## 验收标准

修复后应满足：

1. ✅ 语音播放结束后，`stopLipSync` 被调用
2. ✅ `detachLipSyncTicker` 和 `detachLipSyncModelHook` 被执行
3. ✅ 表情设置时，`hasLipsyncActive` 为 `false`
4. ✅ 表情设置时，`hasTickerHook` 和 `hasModelHook` 为 `false`
5. ✅ 表情动作正常显示，不受嘴形参数干扰
6. ✅ 再次播放语音时，嘴形同步可以正常启动

## 文件清单

### 修改的文件

- `apps/desktop-live2d/renderer/bootstrap.js` - 添加钩子清理逻辑和调试日志

### 新增的文件

- `docs/LIPSYNC_EXPRESSION_CONFLICT_INVESTIGATION.md` - 详细的调查方案
- `docs/LIPSYNC_CONFLICT_DEBUG_GUIDE.md` - 调试指南
- `scripts/test-lipsync-expression-conflict.js` - 测试脚本
- `scripts/investigate-lipsync-conflict.sh` - 调查工具脚本
- `docs/LIPSYNC_CONFLICT_SUMMARY.md` - 本文档

## 下一步

1. **重启 Desktop** 以应用代码更改
2. **验证修复** 使用上述方法之一
3. **确认表情动作正常响应**
4. **如果问题仍然存在**，提供完整的日志输出以便进一步分析

## 技术细节

### 嘴形同步的生命周期

```
语音播放开始
  ↓
startLipSyncWithAudio()
  ↓
bindLipSyncTicker() - 绑定 Pixi ticker 钩子
bindLipSyncModelHook() - 绑定 beforeModelUpdate 钩子
  ↓
RAF 循环开始 (lipsyncRafId)
  ↓
每帧：applyLipSyncForCurrentFrame()
  ↓
语音播放结束
  ↓
stopLipSync()
  ↓
stopLipSyncFrame() - 停止 RAF，重置参数
teardownLipSyncPlaybackListeners() - 移除音频监听
detachLipSyncTicker() - 移除 ticker 钩子 ✅ 新增
detachLipSyncModelHook() - 移除模型钩子 ✅ 新增
```

### 参数更新机制

Live2D 模型参数更新有两种方式：

1. **`setParameterValueById(id, value)`** - 直接设置参数值
   - 表情动作使用这种方式
   - 会覆盖之前的值

2. **`addParameterValueById(id, value, weight)`** - 累加参数值
   - 嘴形同步使用这种方式
   - 会与现有值混合

**冲突原因**：
- 表情设置参数后，`beforeModelUpdate` 事件触发
- 嘴形同步的钩子在事件中执行 `addParameterValueById`
- 嘴形参数覆盖或混合了表情参数

**解决方案**：
- 确保语音结束后，嘴形同步的钩子被完全移除
- 添加 RAF 激活检查，防止意外的参数更新

## 相关资源

- [Live2D Cubism SDK 文档](https://docs.live2d.com/)
- [Pixi.js Ticker 文档](https://pixijs.download/release/docs/PIXI.Ticker.html)
- [嘴形同步研究文档](./LIVE2D_LIPSYNC_RESEARCH.md)
- [Desktop Live2D 模块文档](./modules/desktop-live2d/module-reference.md)
