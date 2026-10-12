# pi 到手机与桌面的实时 TTS 路由计划

> 类型: plan
> 状态: draft
> 负责人: codex（agent/realtime-tts）
> 更新: 2026-10-13
> 关联: REALTIME_TTS_LIPSYNC_PHASED_PLAN.md, PLAN-android-companion-contracts.md, ../features/FEAT-device-hub.md, ../../apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js

## 目标

让 pi 的 `voice.tts_aliyun_vc` 工具可选择实时或非实时 TTS，并把实时 PCM 流投递给当前 avatar host。桌面与 Android 继续复用现有实时播放器和口型分析链路，不新增第二套播放器。

模型与 TTS provider 配置只保存在电脑端。Android 是播放与采集客户端，只接收电脑端生成或转发的 PCM，并保留本地播放音量、麦克风模式等设备侧设置；手机不保存模型、地域、音色或 API 凭据。

## 已核实的现状

- Runtime 已统一发布 `voice.requested`。
- Desktop main 已有 `QwenTtsRealtimeClient`、实时 PCM IPC 和 renderer `RealtimeVoicePlayer`。
- Android Web 已消费 C1.4 的 `voice.stream.start/chunk/end/error`，默认 24 kHz PCM s16le，并用实际播放的 analyser 驱动口型。
- Gateway 的手机 host 路径目前只执行非实时 `QwenTtsClient.synthesizeNonStreaming()`，再发布 `voice.play`。
- `config/desktop-live2d.json` 已支持 `voice.transport` 和实时失败回退配置。

2026-10-13 核对阿里云官方正文，而不是搜索摘要：

- [语音合成概述](https://help.aliyun.com/zh/model-studio/tts-model) 将 `qwen3-tts-flash` 标为 HTTP，将 `qwen3-tts-flash-realtime` 标为 WebSocket。
- [实时语音合成](https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide) 在北京和新加坡地域均列出 `qwen3-tts-flash-realtime` 稳定版；示例端点为 `/api-ws/v1/realtime?model=qwen3-tts-flash-realtime`。
- 官方 Qwen-TTS 示例使用 `session.update`，字段包含 `mode`、`voice`、`language_type`、`response_format: "pcm"`、`sample_rate: 24000`；文本使用 `input_text_buffer.append/commit`，音频由 `response.audio.delta` 返回。
- [Qwen-TTS 音色列表](https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list) 明确 `Cherry` 支持该实时模型。
- `qwen3-tts-flash-realtime` 不支持声音复刻、声音设计或指令控制。不能把旧 VC 音色 ID 直接当作该模型的音色，也不能继续把仓库旧的 `qwen3-tts-vc-realtime-2026-01-15` 当成当前稳定模型。

## 拟议接口

`voice.tts_aliyun_vc` 增加可选参数：

```json
{
  "transport_hint": "auto | realtime | non_streaming"
}
```

- `auto` 为默认值，消费者按本地配置与能力选择；实时失败时允许回退非实时。
- `realtime` 是显式要求。失败时返回清晰的实时错误，不能静默改成非实时。
- `non_streaming` 显式走现有完整音频路径。
- 只有 `auto` 可以回退，而且仅在尚未向播放器发送任何 PCM chunk 时回退。已经播放部分 PCM 后禁止用同一 request 再播放整段非实时音频。
- Runtime 继续只发布统一的 `voice.requested`，并透传 `transport_hint`；播放实现留在 desktop/gateway consumer。
- Gateway 从电脑端配置创建实时 TTS 会话，再把 PCM 转发给手机；Device Hub 事件不携带 provider 凭据或模型配置。

实时设备事件沿用 C1.4：

```text
voice.stream.start { request_id, sample_rate: 24000, format: "pcm_s16le" }
voice.stream.chunk { request_id, seq, data_b64 }
voice.stream.end   { request_id }
voice.stream.error { request_id, error }
```

`start` 必须先于第一块，`seq` 从 0 单调递增，`end/error` 使用同一 `request_id` 并终止流。host 变更后丢弃旧请求的后续块。

## 预计改动范围

- `config/tools.yaml`：暴露 `transport_hint` 枚举并更新工具说明。
- `apps/runtime/tooling/adapters/voice.js`：把选择提示透传到 `voice.requested`，不负责 WebSocket 或播放。
- `apps/desktop-live2d/main/desktopSuite.js`：显式 hint 覆盖本地 transport；实施上述回退语义。
- `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js`：更新官方稳定模型默认值与当前 session 字段，继续复用现有客户端。
- `apps/gateway/deviceHub/voiceRelay.js`：手机 host 复用同一实时客户端，把 chunk 映射到现有 Device Hub 事件。
- `config/providers.yaml` 与 onboarding 默认值：只在确认不会破坏旧声音复刻工作流后更新；不盲设未验证模型。
- 对应 feature、module、TC 文档及离线 mock 测试。

不修改 `apps/runtime/config/**` 的模型/认证实现；该区域由并行工作流负责。

## 验证计划

1. Realtime client mock：验证稳定模型 URL、官方 `session.update` 字段、append/commit、chunk 与完成事件。
2. Runtime adapter：验证三种 hint 的事件透传和默认 `auto`。
3. Gateway relay：验证 start→有序 chunk→end、显式非实时、auto 首块前回退、显式实时失败、首块后禁止回退、host 切换和 request 去重。
4. Desktop consumer：验证显式 hint 优先级和相同回退边界。
5. 运行隔离 HOME 的 `npm run test:ci`；不在自动化中访问真实 API。
6. 代码合并后由设备工作流协调锁，在用户另行授权时只进行一次真实实时播放验收；本计划不自行触发付费请求。

## Checkpoint（2026-10-13）

- 已完成仓库现状梳理、官方模型与协议核验、跨端字段确认。
- 统筹者已同意 `transport_hint` 方向及严格回退语义；Android UI 工作流确认现有播放器字段和时序兼容，无需新增 UI 代码。
- 尚未修改实时 TTS 代码、配置或唯一契约。
- 因背景/UI/60 FPS/抽动修复优先级更高，本工作流按统筹要求暂停在设计 checkpoint；后续从 `agent/realtime-tts` 分支继续。
