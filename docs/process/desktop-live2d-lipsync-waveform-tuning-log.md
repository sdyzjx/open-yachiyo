# Desktop Live2D Lipsync Waveform Tuning Log

日期范围：2026-03-04  
适用分支基线：`main`

## 1. 目的

这篇文档记录当前 `desktop-live2d` 嘴形链路的实际开发结果，而不是早期方案。

重点覆盖：
- 默认闭嘴基线统一
- 说话态 `mouthOpen` / `mouthForm` 调参与 face mixer 的关系
- 逐帧 waveform 采集落盘
- 当前已知问题与下一步观察方式

## 2. 当前链路

### 2.1 语音到嘴形

1. `apps/runtime/tooling/adapters/voice.js`
   - `ttsAliyunVc()`
   - 当 `voice.path = electron_native` 时发 `voice.requested`
2. `apps/desktop-live2d/main/desktopSuite.js`
   - `processVoiceRequestedOnDesktop()`
   - 根据 `voice.transport` 走 `realtime` 或 `non_streaming`
3. `apps/desktop-live2d/renderer/bootstrap.js`
   - `playVoiceFromRemote()`
   - `playVoiceFromBase64()`
   - `startRealtimeVoicePlayback()`
   - `startLipsync()`
4. `apps/desktop-live2d/renderer/lipsyncViseme.js`
   - `resolveVisemeFrame()`
5. `apps/desktop-live2d/renderer/bootstrap.js`
   - `enhanceMouthParams()`
   - face mixer / final param write
6. `apps/desktop-live2d/renderer/lipsyncMouthTransition.js`
   - `stepMouthTransition()`

### 2.2 当前关键分层

- `lipsyncViseme.js`
  - 从频谱与能量推断 `raw_mouth_open` / `raw_mouth_form`
- `bootstrap.js`
  - 做 speaking 态增益、低能量豁免、默认嘴形回落、face mixer
- `lipsyncMouthTransition.js`
  - 做 attack / release / neutral 过渡
- 最终写入
  - `ParamMouthOpenY`
  - `ParamMouthForm`
  - 以及少量表情相关参数

## 3. 这轮落地的改动

### 3.1 默认嘴形统一

当前默认闭嘴嘴形被统一成同一来源，不再在多个阶段各写一套：
- 模型加载后
- idle fallback 后
- 说话前预播等待
- 说话停止后的 release 回落

目标是保证“默认闭嘴”和“说话结束后的闭嘴”一致。

### 3.2 face mixer

当前主线已经加入最小版 face mixer，作用是把这些输入统一到最终写参数前：
- 默认基线
- emotion / expression 目标
- lipsync 目标
- debug override

这样可以避免：
- `greet` / `smile` 把 `mouthForm` 顶满
- 说话时表情和嘴形互相抢

### 3.3 lipsync 调参

当前主线不是简单整包搬 `Tune` 老分支，而是只借用了调参思路：
- 元音目标嘴形更分散
- speaking 态 `mouthOpen` / `mouthForm` 做增益
- 低能量帧避免过早掉成 `0/0`

实际调整点主要在：
- `apps/desktop-live2d/renderer/lipsyncViseme.js`
- `apps/desktop-live2d/renderer/bootstrap.js`
- `apps/desktop-live2d/renderer/lipsyncMouthTransition.js`

## 4. 逐帧 waveform 采集

### 4.1 为什么需要新 recorder

之前只有 SSE 抽样日志，最多每 30 帧采一次，无法还原完整嘴形波形。  
现在为每次语音请求新增了逐帧 JSONL 记录。

### 4.2 记录内容

renderer 持续发两类 debug marker：
- `chain.renderer.mouth.frame_sample`
- `chain.renderer.lipsync.frame_applied`

main 进程在 `apps/desktop-live2d/main/desktopSuite.js`
- `createMouthWaveformRecorder()`
中订阅 renderer console debug，按 `request_id` 落盘。

### 4.3 文件位置

默认输出目录：
- `~/yachiyo/data/desktop-live2d/mouth-waveforms`

文件名格式：
- `<timestamp>-<request_id>.jsonl`

### 4.4 当前配置

`desktop-live2d.json` 中的新字段：

```json
{
  "debug": {
    "waveformCapture": {
      "enabled": true,
      "captureEveryFrame": true,
      "includeApplied": true
    }
  }
}
```

语义：
- `enabled`
  - 是否启用逐帧 recorder
- `captureEveryFrame`
  - `true` 时 renderer 每帧输出 `mouth.frame_sample`
- `includeApplied`
  - `true` 时 renderer 同时输出每帧 `frame_applied`

## 5. 这轮波形观察到的事实

基于已落盘的逐帧文件，可以直接比较：
- `raw_mouth_open`
- `mouth_open`
- `applied_mouth_open`
- `raw_mouth_form`
- `mouth_form`
- `applied_mouth_form`

已经确认的一个关键事实：
- 目标值和最终应用值并不总是一致
- 尤其 `mouthForm` 在某些帧会被别的链路顶到极值

这意味着后续调优不应该只盯 `resolveVisemeFrame()` 的输出，还要看最终落模阶段。

## 6. 当前文档关系

### 6.1 这篇文档负责什么

这篇文档只负责：
- 开发过程
- 调参思路
- 真实运行观测
- 逐帧 waveform 采集方式

### 6.2 其他文档分别负责什么

- `docs/VOICE_LIPSYNC_DEBUG_GUIDE.md`
  - 当前可执行的调试步骤与 topic
- `docs/modules/desktop-live2d/desktop-live2d-config-reference.md`
  - `desktop-live2d.json` 字段参考
- `docs/modules/desktop-live2d/README.md`
  - 模块索引

### 6.3 已重叠且过时的文档

以下文档保留为历史调查材料，但不应再当作当前主线事实来源：
- `docs/LIPSYNC_CONFLICT_DEBUG_GUIDE.md`
- `docs/LIPSYNC_CONFLICT_SUMMARY.md`
- `docs/LIPSYNC_EXPRESSION_CONFLICT_INVESTIGATION.md`

它们的问题是：
- 主要针对 2026-03-01 左右的旧 lipsync 冲突排查
- 没有覆盖当前 face mixer
- 没有覆盖 waveform recorder
- 部分描述以旧实现细节为中心，不适合继续当现状文档

## 7. 2026-03-05：本地音频复现链路补齐与 `start_failed` 修复

### 7.1 背景

在“本地 OGG 直接喂 Live2D”调试中，出现：
- 音频能播
- 嘴形不动
- telemetry 出现 `chain.lipsync.sync.stop`，`reason = start_failed`

### 7.2 直接根因

`renderer/bootstrap.js` 在某些重入路径里会对同一个 `<audio>` 重复创建 `createMediaElementSource(audioElement)`。  
Web Audio 限制同一 media element 只能绑定一次 `MediaElementSourceNode`，因此启动 lipsync 失败。

典型错误特征：
- `createMediaElementSource ... already connected previously to a different MediaElementSourceNode`

### 7.3 代码修复

1. 新增开发态本地播放 RPC：
   - `debug.voice.playLocalFile`
   - 位置：
     - `apps/desktop-live2d/main/constants.js`
     - `apps/desktop-live2d/main/rpcValidator.js`
     - `apps/desktop-live2d/main/desktopSuite.js`
   - 行为：
     - 校验本地文件路径
     - 转换为 `file://` URL
     - 复用现有 `desktop:voice:play-remote` 链路，不新开 lipsync 分支

2. 修复 media source 重复创建：
   - 文件：`apps/desktop-live2d/renderer/bootstrap.js`
   - 核心：
     - 复用 `lipsyncMediaElementSource`
     - 复用 `lipsyncMediaElementAnalyser`
     - 仅在 `audioElement` 变化时重建 source

### 7.4 验证结论

修复后同一测试音频回放可稳定观察到：
- `chain.lipsync.sync.start`
- `chain.renderer.voice_remote.playback_started`
- 连续 `chain.renderer.mouth.frame_sample`
- 连续 `chain.renderer.lipsync.frame_applied`

说明本地文件回放与主链 lipsync 已统一，可用于后续嘴形调参与波形采样。
