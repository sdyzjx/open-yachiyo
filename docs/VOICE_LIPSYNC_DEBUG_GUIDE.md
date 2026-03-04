# Voice Lipsync 调试指南

本文档只描述当前主线可执行的 lipsync 调试方式。

如果你要看最近一轮嘴形调参与 waveform recorder 的开发经过，另见：
- `docs/process/desktop-live2d-lipsync-waveform-tuning-log.md`

## 1. 当前链路

### 1.1 入口

1. runtime
   - `apps/runtime/tooling/adapters/voice.js`
   - `ttsAliyunVc()`
   - 当 `voice.path = electron_native` 时发布 `voice.requested`
2. desktop main
   - `apps/desktop-live2d/main/desktopSuite.js`
   - `processVoiceRequestedOnDesktop()`
3. renderer
   - `apps/desktop-live2d/renderer/bootstrap.js`
   - `playVoiceFromRemote()`
   - `playVoiceFromBase64()`
   - `startRealtimeVoicePlayback()`
   - `startLipsync()`

### 1.2 嘴形内部链

1. `lipsyncViseme.js`
   - `resolveVisemeFrame()`
   - 生成 `raw_mouth_open` / `raw_mouth_form`
2. `bootstrap.js`
   - `enhanceMouthParams()`
   - speaking 增益、低能量豁免、face mixer 输入
3. `lipsyncMouthTransition.js`
   - `stepMouthTransition()`
   - attack / release / neutral 过渡
4. `bootstrap.js`
   - 最终写入 `ParamMouthOpenY` / `ParamMouthForm`

## 2. 当前推荐的调试方式

### 2.1 开启 Debug Stream

```bash
curl -s -X PUT http://127.0.0.1:3000/api/debug/mode \
  -H "content-type: application/json" \
  -d '{"debug":true}'
```

### 2.2 订阅关键 topic

优先看这组：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.electron.notification.received,chain.renderer.voice_memory.received,chain.renderer.voice_remote.received,chain.renderer.voice_stream.start_received,chain.renderer.voice_stream.chunk,chain.renderer.mouth.frame_sample,chain.renderer.lipsync.frame_applied"
```

必要时再补：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.renderer.voice_memory.playback_started,chain.renderer.voice_remote.playback_started,chain.renderer.voice_stream.playback_started,chain.renderer.voice_memory.lipsync_started,chain.renderer.voice_remote.lipsync_started,chain.renderer.voice_stream.lipsync_started"
```

### 2.3 当前最重要的两个 topic

- `chain.renderer.mouth.frame_sample`
  - 观察目标嘴形
  - 字段：
    - `raw_mouth_open`
    - `raw_mouth_form`
    - `mouth_open`
    - `mouth_form`
    - `voice_energy`
    - `confidence`

- `chain.renderer.lipsync.frame_applied`
  - 观察最终回读值
  - 字段：
    - `target_mouth_open`
    - `target_mouth_form`
    - `applied_mouth_open`
    - `applied_mouth_form`
    - `apply_mode`

调试顺序：

1. 先看 `mouth.frame_sample`
   - 确认上游有没有输出有效 `open/form`
2. 再看 `frame_applied`
   - 确认最终落模值是否和目标值一致
3. 如果两者不一致
   - 问题在 final write / mixer / 模型覆盖
4. 如果两者一致但视觉仍不明显
   - 问题更偏模型资源、参数映射或 motion 干扰

## 3. 逐帧 waveform 记录

### 3.1 配置

`desktop-live2d.json`：

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

### 3.2 输出目录

- `~/yachiyo/data/desktop-live2d/mouth-waveforms`

文件格式：
- 每次 voice request 生成一份 `<timestamp>-<request_id>.jsonl`

每行一条事件，当前主要有：
- `chain.renderer.mouth.frame_sample`
- `chain.renderer.lipsync.frame_applied`

### 3.3 为什么推荐用 waveform 文件

SSE 更适合在线追踪。  
如果要看完整波形、做图、比对 `target/applied`，应优先看 JSONL 文件。

## 4. 常见定位路径

### 4.1 有声音但嘴几乎不动

优先检查：

1. `chain.renderer.mouth.frame_sample`
   - `mouth_open` 是否长期接近 `0`
2. `voice_energy`
   - 是否长期极低
3. `confidence`
   - 是否长期偏低，导致 `resolveVisemeFrame()` 太保守

常见根因：
- `resolveVisemeFrame()` 的 speaking blend 太保守
- speaking 弱音节被过早回落
- 最终 transition 把目标值吃掉

### 4.2 目标值有变化，但最后模型还是闭嘴

优先检查：

1. `chain.renderer.lipsync.frame_applied`
2. 比较：
   - `target_mouth_open`
   - `applied_mouth_open`
   - `target_mouth_form`
   - `applied_mouth_form`

如果明显不一致：
- 优先怀疑 face mixer
- `beforeModelUpdate` 写入顺序
- expression / motion 对同参数的覆盖

### 4.3 嘴形和表情互相打架

当前主线已引入最小版 face mixer。  
如果仍出现冲突，先确认：

1. speaking 时 `target_mouth_form` 正常
2. `applied_mouth_form` 是否被顶到极值
3. 是否正好叠了 `greet` / `smile` / `param_batch`

### 4.4 realtime 和 non-streaming 表现不一样

这是正常现象，先分链路看：

- `desktop:voice:play-memory`
- `desktop:voice:play-remote`
- `desktop:voice:stream-start/chunk/end`

realtime 额外要看：
- chunk 边界
- prebuffer
- idle timeout
- speaking 判定是否过早掉线

## 5. 手工检查建议

### 5.1 先跑一轮语音

```bash
npm run desktop:up
```

然后通过 WebUI 或 `/ws` 触发一段固定文案。

### 5.2 再看最新 waveform 文件

```bash
ls -lt ~/yachiyo/data/desktop-live2d/mouth-waveforms | head
```

### 5.3 再做图

如果已经有逐帧 JSONL，后续分析优先基于文件画图，而不是只看抽样日志。

## 6. 相关文件

- `apps/runtime/tooling/adapters/voice.js`
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/config.js`
- `apps/desktop-live2d/renderer/bootstrap.js`
- `apps/desktop-live2d/renderer/lipsyncViseme.js`
- `apps/desktop-live2d/renderer/lipsyncMouthTransition.js`
- `scripts/test-voice-lipsync.js`

## 7. 历史文档说明

以下文档仍可参考调查思路，但不代表当前主线实现：
- `docs/LIPSYNC_CONFLICT_DEBUG_GUIDE.md`
- `docs/LIPSYNC_CONFLICT_SUMMARY.md`
- `docs/LIPSYNC_EXPRESSION_CONFLICT_INVESTIGATION.md`
