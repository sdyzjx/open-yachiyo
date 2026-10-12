# Qwen TTS Web-Native 改造方案（非流式，复用当前音色）

- 仓库：`desktop-ai-native-runtime`
- 目标 Issue：`#30`
- 方案版本：v0.1（先行方案）
- 范围约束：**先不做流式**，只实现非流式链路；保持当前音色复用能力。

---

## 1. 背景与目标

当前语音链路主要依赖：

1. runtime 侧工具调用 `voice.tts_aliyun_vc`
2. Python 脚本请求 DashScope
3. 本地产生音频文件（ogg）
4. ffmpeg 转 wav
5. 通过事件触发 electron 播放本地文件

现状问题：

- 子进程（python/ffmpeg）依赖重，时序与错误传播复杂。
- 音频产物依赖本地文件，链路可观测性差。
- 在桌面端联调时，业务事件与音频生成/播放生命周期分离。

本次改造目标（MVP）：

- 保留「tool 暴露说话能力」的交互方式。
- runtime/gateway 仅承担“语音请求事件透传”。
- **electron main 直接调用 Qwen TTS 非流式 API** 获取音频。
- 不落磁盘（内存 Buffer/Blob），直接在 renderer 播放。
- 复用当前音色配置（`tts_model + tts_voice` / voiceId 映射）。

---

## 2. 参考 API 规范（Qwen TTS 非流式）

依据阿里云百炼 Qwen TTS 文档（qwen3-tts 系列）可用能力：

- 模型可选：`qwen3-tts-vc-*` / `qwen3-tts-flash` / `qwen3-tts-instruct-flash` 等。
- 非流式返回：服务返回音频 URL（有效期通常为 24h）。
- 关键输入字段：
  - `model`
  - `input.text`
  - `input.voice`（系统音色或复刻音色标识）
  - 可选：`language_type`、指令控制参数（本期可不启用）
- 地域注意：北京与新加坡 endpoint/API Key 独立。

本方案不强绑定 SDK，可选两种实现：

1. **HTTP 直连 REST（推荐）**：electron 端直接 `fetch` 百炼接口。
2. Node SDK（可选）：若后续需要统一重试与鉴权，可切 SDK。

---

## 3. 目标架构（非流式）

```text
LLM/tool call
   -> runtime tool adapter (voice.speak.request)
   -> gateway ws event forward (voice.*)
   -> electron main (qwen tts client)
   -> renderer (audio playback, memory blob)
```

### 3.1 分层职责

- runtime
  - 仅负责工具协议与策略（鉴权、限流、参数校验）
  - 不再负责真正 TTS 合成与 ffmpeg 转码
- gateway
  - 继续透传 `voice.*` 事件，无业务耦合
- electron main
  - 新增 QwenTtsClient（非流式）
  - 拿到 `audio_url` 后下载为 Buffer
  - 转为 base64/data URL 或 IPC 二进制传给 renderer
- renderer
  - 用 `Audio` 元素播放内存资源
  - 播放结束后释放对象 URL（如使用 Blob URL）

---

## 4. 与当前实现的差异点

## 4.1 保留

- 继续保留 `voice` 工具入口（如 `voice.tts_aliyun_vc` 或新增 `voice.speak`）。
- 保留 voice policy（冷却、频率、文本长度限制等）。
- 保留 gateway 的 `voice.*` 事件广播机制。

## 4.2 替换

- 移除 runtime 中 `python3 scripts/qwen_voice_reply.py` 与 `ffmpeg` 强依赖路径（MVP 可通过 feature flag 保留回退）。
- 播放链路由 “文件路径(file://)” 改为 “内存音频”。

---

## 5. 详细改造设计

## 5.1 统一事件契约（非流式版本）

建议新增/规范以下事件：

1. `voice.requested`
   - 含文本、voice 配置、requestId、sessionId
2. `voice.synthesis.started`
3. `voice.synthesis.completed`
   - 含 `audio_url`（仅 main 内部可见，不直接透给模型层）
4. `voice.playback.started`
5. `voice.playback.ended`
6. `voice.synthesis.failed`
7. `voice.playback.failed`

> 注：用户可见文本中不暴露音频 URL/路径。

### 5.2 runtime（tool adapter）

- 文件：`apps/runtime/tooling/adapters/voice.js`
- 处理策略：
  - 工具收到 `text` 后，不直接调用 DashScope。
  - 发布 `voice.requested` 事件（包含最小必要参数）。
  - 立即返回工具成功（例如 `{"status":"accepted"}`）。

建议参数结构：

```json
{
  "text": "...",
  "voiceId": "optional",
  "voiceTag": "zh|jp|en",
  "model": "optional",
  "turnId": "optional",
  "idempotencyKey": "optional"
}
```

### 5.3 electron main（核心）

新增模块建议：

- `apps/desktop-live2d/main/voice/qwenTtsClient.js`
- `apps/desktop-live2d/main/voice/voicePlaybackOrchestrator.js`

职责：

1. 监听来自 gateway 的 `voice.requested`。
2. 解析配置优先级：
   - request 参数 > providers.yaml 的 `qwen3_tts` 配置 > 默认值
3. 调用 DashScope 非流式接口。
4. 从返回 `audio_url` 下载音频到内存 Buffer。
5. 通过 IPC 发给 renderer 播放。

最小请求体（REST）示意：

```json
{
  "model": "qwen3-tts-vc-2026-01-22",
  "input": {
    "text": "你好，今天我们继续推进 issue 30。",
    "voice": "<CURRENT_VOICE_ID>",
    "language_type": "Chinese"
  }
}
```

### 5.4 renderer 播放

当前已有 `server_event_forward` 与 `systemAudio`；建议扩展：

- 新 method：`voice.play.base64` 或 `voice.play.buffer`
- 若用 base64：`audio.src = data:audio/ogg;base64,...`
- 若用 Blob URL：
  - `const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/ogg' }))`
  - 播放后 `URL.revokeObjectURL(url)`

### 5.5 配置复用（音色）

复用现有 provider 配置：

- `config/providers.yaml` 中 `qwen3_tts`：
  - `base_url`
  - `api_key`
  - `tts_model`
  - `tts_voice`

复用策略：

- 默认使用 `tts_model + tts_voice`
- 工具入参带 `voiceId/model` 时按白名单覆盖
- 不允许任意外部传入未注册 voice（防滥用）

---

## 6. 错误码与回退策略

## 6.1 错误码建议

- `TTS_CONFIG_MISSING`
- `TTS_PROVIDER_AUTH_FAILED`
- `TTS_PROVIDER_DOWN`
- `TTS_AUDIO_FETCH_FAILED`
- `TTS_PLAYBACK_FAILED`
- `TTS_TIMEOUT`
- `TTS_CANCELLED`（为下一阶段预留）

## 6.2 回退策略（建议保留 feature flag）

新增配置：

- `voice.path = electron_native | runtime_legacy`

行为：

- `electron_native`：走新链路（推荐默认）
- `runtime_legacy`：走旧 python+ffmpeg 链路

这样可以在异常时一键回退，降低上线风险。

---

## 7. 安全与合规

- API Key 仅保存在受控配置，不透传到 renderer。
- renderer 不直接访问 DashScope，避免 key 暴露。
- 日志中脱敏：禁止打印完整 `audio_url` / `api_key`。
- 对文本做长度上限与基础清洗，避免超大 payload。

---

## 8. 验收标准（非流式 MVP）

1. 指定文本可稳定合成并播放（>= 30 次，成功率 >= 99%）。
2. 全链路无磁盘缓存依赖（不写本地音频文件）。
3. 音色与当前配置一致（主观听感 + 配置核对）。
4. 异常路径可观测（统一错误码 + 关键事件日志）。
5. feature flag 可切回旧链路并通过回归。

---

## 9. 实施顺序建议

1. 定义事件契约与 feature flag。
2. runtime 工具改为“请求发布模式”。
3. electron main 接入 Qwen 非流式调用 + 下载音频 Buffer。
4. renderer 增加内存音频播放。
5. 完成日志、错误码、回退路径。
6. 联调 + 压测 + 文档补齐。

---

## 10. 下一步（进入开发前）

建议先确认 3 个决策：

1. DashScope 调用落在 electron main（推荐）还是 gateway（可选）。
2. renderer 音频承载格式：base64 dataURL（实现快）还是 Blob/ArrayBuffer（更高效）。
3. feature flag 默认值：新链路默认开还是灰度开。

确认后可直接拆任务进入实现。
