# Voice Lipsync 调试指南

## 概述

本指南帮助调试 API 语音播放时的口型同步功能。

## 架构说明

### 数据流

```
Runtime (voice.requested event)
  ↓
Desktop Main (processVoiceRequestedOnDesktop)
  ↓ qwenTtsClient.synthesizeNonStreaming()
  ↓ qwenTtsClient.fetchAudioBuffer()
  ↓ IPC: desktop:voice:play-memory
  ↓
Renderer (playVoiceFromBase64)
  ↓ startLipsync(systemAudio)
  ↓ AudioContext + AnalyserNode
  ↓ requestAnimationFrame loop
  ↓ Live2DVisemeLipSync API
  ↓ Live2D Model Parameters
```

### 关键组件

1. **QwenTtsClient** (`apps/desktop-live2d/main/voice/qwenTtsClient.js`)
   - 调用 DashScope API 获取语音
   - 返回 audioUrl 和 mimeType

2. **processVoiceRequestedOnDesktop** (`apps/desktop-live2d/main/desktopSuite.js`)
   - 处理 `voice.requested` 事件
   - 下载音频并转换为 base64
   - 通过 IPC 发送到渲染进程

3. **playVoiceFromBase64** (`apps/desktop-live2d/renderer/bootstrap.js`)
   - 解码 base64 音频
   - 创建 Blob 和 ObjectURL
   - 调用 startLipsync()
   - 播放音频

4. **startLipsync** (`apps/desktop-live2d/renderer/bootstrap.js`)
   - 创建 AudioContext 和 AnalyserNode
   - 连接音频节点
   - 启动 requestAnimationFrame 循环
   - 使用 Live2DVisemeLipSync API 分析音频
   - 更新 Live2D 模型参数

5. **Live2DVisemeLipSync** (`apps/desktop-live2d/renderer/lipsyncViseme.js`)
   - 提取音频特征
   - 推断口型权重
   - 计算嘴部参数
   - 平滑处理

## 调试步骤

### 1. 启动 Desktop 应用

```bash
cd /Users/doosam/.openclaw/workspace/yachiyo-desktop-dev/desktop-ai-native-runtime-issue30
npm run desktop:up
```

### 2. 打开开发者工具

在 Desktop 窗口中按 `Cmd+Option+I` (macOS) 或 `Ctrl+Shift+I` (Windows/Linux)

### 3. 运行测试脚本

```bash
node scripts/test-voice-lipsync.js
```

### 4. 观察控制台日志

在 DevTools 的 Console 标签中，过滤 `lipsync` 关键字。

## 预期日志流

### 正常情况

```
[lipsync] playVoiceFromBase64 called {hasBase64: true, base64Length: 123456, mimeType: "audio/ogg", hasLipsyncApi: true, hasModel: true}
[lipsync] Audio decoded {binaryLength: 92592, bytesLength: 92592}
[lipsync] Audio source set, starting lipsync
[lipsync] startLipsync called {hasLipsyncApi: true, hasModel: true, hasAudioElement: true, audioSrc: "blob:..."}
[lipsync] AudioContext created {sampleRate: 48000, state: "running"}
[lipsync] Audio nodes connected {fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8}
[lipsync] Runtime state created {state: {...}}
[lipsync] Animation loop started
[lipsync] Audio playback started
[lipsync] frame update {frameCount: 0, features: {energy: "0.234"}, weights: {a: "0.45", i: "0.12", u: "0.23"}, mouthParams: {openY: "0.456", form: "0.123"}, frame: {openY: "0.456", form: "0.123"}}
[lipsync] frame update {frameCount: 30, ...}
[lipsync] frame update {frameCount: 60, ...}
...
[lipsync] stopLipsync called {hasAnimationFrame: true, hasState: true, hasModel: true, hasAudioContext: true}
[lipsync] animation frame cancelled
[lipsync] mouth parameters reset to neutral
```

## 常见问题诊断

### 问题 1: 没有看到任何 [lipsync] 日志

**可能原因:**
- 语音请求没有触发
- IPC 通信失败
- 渲染进程没有收到 `desktop:voice:play-memory` 事件

**检查:**
1. 查看主进程日志（终端输出）
2. 检查是否有 `[desktop-live2d] voice requested process failed` 错误
3. 检查 `DASHSCOPE_API_KEY` 是否配置

### 问题 2: 看到 `hasLipsyncApi: false`

**可能原因:**
- `lipsyncViseme.js` 没有加载
- `window.Live2DVisemeLipSync` 未定义

**检查:**
1. 确认 `apps/desktop-live2d/renderer/index.html` 中有 `<script src="./lipsyncViseme.js"></script>`
2. 在 Console 中输入 `window.Live2DVisemeLipSync` 检查是否存在

### 问题 3: 看到 `hasModel: false`

**可能原因:**
- Live2D 模型还未加载
- 模型加载失败

**检查:**
1. 查看是否有模型加载错误
2. 在 Console 中输入 `live2dModel` 检查模型对象

### 问题 4: AudioContext 创建失败

**可能原因:**
- 浏览器安全策略限制
- 已经创建过 MediaElementSource

**检查:**
1. 查看错误信息
2. 可能需要在用户交互后才能创建 AudioContext

### 问题 5: 看到日志但没有口型动作

**可能原因:**
- Live2D 模型参数名称不匹配
- 参数值范围不正确
- 模型没有嘴部参数

**检查:**
1. 查看 `frame update` 日志中的 `openY` 和 `form` 值
2. 在 Console 中手动设置参数测试:
   ```javascript
   live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 1.0);
   live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthForm', 0.5);
   ```
3. 检查模型是否有这些参数:
   ```javascript
   live2dModel.internalModel.coreModel.getParameterIds();
   ```

### 问题 6: 音频播放但立即停止口型

**可能原因:**
- `stopLipsync()` 被过早调用
- 动画循环被中断

**检查:**
1. 查看 `stopLipsync called` 日志的时间
2. 检查是否有其他代码调用了 `stopLipsync()`

## 手动测试

在 DevTools Console 中执行:

```javascript
// 1. 检查 API 是否可用
console.log('Lipsync API:', window.Live2DVisemeLipSync);
console.log('Model:', live2dModel);

// 2. 测试手动设置参数
live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 1.0);
live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthForm', 0.5);

// 3. 重置参数
live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthForm', 0);

// 4. 查看所有参数
live2dModel.internalModel.coreModel.getParameterIds();
```

## 下一步

如果以上步骤都正常但仍然没有口型，可能需要:

1. 检查 Live2D 模型的参数映射
2. 调整口型参数的计算逻辑
3. 检查是否有其他代码覆盖了嘴部参数
4. 验证音频分析是否正确提取特征

## 相关文件

- `apps/desktop-live2d/main/voice/qwenTtsClient.js` - TTS 客户端
- `apps/desktop-live2d/main/desktopSuite.js` - 主进程事件处理
- `apps/desktop-live2d/renderer/bootstrap.js` - 渲染进程口型同步
- `apps/desktop-live2d/renderer/lipsyncViseme.js` - 口型分析 API
- `scripts/test-voice-lipsync.js` - 测试脚本
