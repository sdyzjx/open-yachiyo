# Real-time TTS + LipSync 分阶段施工方案（主线基线）

- 基线分支：`main`
- 基线提交：`eef52c5`
- 目标：接入阿里云实时流式 TTS，并与当前桌宠口型链路兼容，不回退现有稳定能力
- 约束：优先使用 HTTP 接口能力；保留现有非流式链路作为兜底

## 1. 当前链路（基线复盘）

当前主线已具备如下关键能力：

1. Runtime 工具层通过 `voice.tts_aliyun_vc` 触发语音请求。
2. `voice.path = electron_native` 时，Runtime 发布 `voice.requested` 事件，不在 Runtime 内合成音频。
3. Desktop main 监听 `voice.requested`，调用 `QwenTtsClient.synthesizeNonStreaming()`（HTTP）拿到 `audioUrl`。
4. Desktop main 通过 IPC 分发到 renderer：
   - `desktop:voice:play-remote`（默认）
   - `desktop:voice:play-memory`（回退）
5. Renderer 使用 `systemAudio` 播放，并基于 `AudioContext + AnalyserNode` 做 viseme 口型计算，写入 `ParamMouthOpenY/ParamMouthForm`。
6. 已有 lipsync 与 expression 冲突修复与 telemetry 观测能力。

结论：当前口型与播放链路耦合点是 `systemAudio`。实时 TTS 接入应优先复用这条播放与分析路径。

## 2. 设计原则（兼容优先）

1. 不重写口型核心：`lipsyncViseme.js` 与 renderer 口型主循环保持不变。
2. 只替换“音频来源”：从非流式 `audioUrl` 扩展到实时流式输入。
3. 口型驱动源必须与实际播放源一致：继续从本地播放链路做频谱分析，避免口型与声音漂移。
4. 保留非流式兜底：任一实时阶段失败可回退到当前 `synthesizeNonStreaming`。
5. 全链路 request fence：沿用 `request_id`、新请求抢占旧请求，保证 lipsync 清理一致。

## 3. 分阶段施工

## Phase 0：冻结契约与开关（0.5 天）

目标：先把接口和灰度开关冻结，避免并行开发互相踩。

改动点：
- `config/desktop-live2d.json`
- `apps/desktop-live2d/main/config.js`
- 文档与事件约定

新增配置建议：
- `voice.transport`: `non_streaming | realtime`
- `voice.realtime.prebuffer_ms`: 默认 `160`
- `voice.realtime.idle_timeout_ms`: 默认 `8000`
- `voice.fallback_on_realtime_error`: 默认 `true`

验收：
- 配置可读写，默认行为与当前主线一致（`non_streaming`）。

---

## Phase 1：音色复刻 HTTP 工具化（0.5~1 天）

目标：先稳定“音色资产来源”，为实时 TTS 固定 voice id。

改动点：
- 新增 `scripts/aliyun_voice_clone_http.py`
- 新增 `docs/VOICE_CLONE_HTTP_SOP.md`

脚本能力：
1. 输入参考音频路径、目标模型、音色名。
2. 音频校验与预处理（时长/采样率/声道/大小，不合格时 ffmpeg 转换）。
3. 通过 HTTP 调用复刻接口（create/query）。
4. 输出 `voice_id`（json），可选写回 `~/yachiyo/config/providers.yaml` 的 `providers.qwen3_tts.tts_voice`。

验收：
- 给定参考音频可稳定产出可用 `voice_id`。
- 不影响现有非流式播放链路。

---

## Phase 2：Desktop main 实时 TTS 客户端（1~1.5 天）

目标：在 main 进程新增实时客户端，但暂不替换现有播放入口。

改动点：
- 新增 `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js`
- 轻量改动 `apps/desktop-live2d/main/desktopSuite.js`

职责：
1. 建立实时会话（HTTP/WS，按阿里云 realtime 协议）。
2. 发送文本并接收增量音频事件。
3. 输出统一事件：`start/chunk/end/error`。
4. 暂不直接驱动 renderer，先完成可观测与稳定性验证。

验收：
- 在本地可看到稳定 chunk 流（含 request_id、chunk 序号、字节统计）。
- `error/timeout/cancel` 分类明确。

---

## Phase 3：流式播放桥接（兼容口型核心）（1.5~2 天）

目标：把实时 chunk 接入 renderer 播放，同时保持 lipsync 逻辑不改。

改动点：
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/preload.js`
- `apps/desktop-live2d/renderer/bootstrap.js`
- 新增 `apps/desktop-live2d/renderer/realtimeVoicePlayer.js`

推荐实现：
1. main 向 renderer 新增 IPC：
   - `desktop:voice:stream-start`
   - `desktop:voice:stream-chunk`
   - `desktop:voice:stream-end`
   - `desktop:voice:stream-error`
2. renderer 引入 `RealtimeVoicePlayer`：
   - 负责 chunk 缓冲与有序播放。
   - 对外统一回调：`onFirstAudio`, `onEnded`, `onError`, `onInterrupted`。
3. lipsync 触发规则：
   - `onFirstAudio` -> `startLipsync(systemAudioLikeOutput)`
   - `onEnded/onError/onInterrupted` -> `stopLipsync(...)`
4. 若实时播放通道异常，自动切到现有 `play-remote` 或 `play-memory`。

兼容要求：
- 继续复用当前 request 抢占逻辑（`activeVoiceRequestId`）。
- 保证 expression/motion 在 stop 后不被嘴型残留覆盖。

验收：
- 实时播放期间口型正常驱动。
- 打断后 lipsync 清理完整，无“说完后动作失效”回归。

---

## Phase 4：Runtime 侧策略并轨（0.5~1 天）

目标：Runtime 只做策略，不做播放细节，避免双栈分叉。

改动点：
- `apps/runtime/tooling/adapters/voice.js`
- `config/voice-policy.yaml`

策略要求：
1. 保持 `voice.requested` 为统一下发事件。
2. 新增 `transport_hint`（`realtime|non_streaming`）但不在 Runtime 决定具体播放器实现。
3. 继续复用 cooldown、rate limit、idempotency 与 supersede fence。

验收：
- Runtime 行为与现有工具协议兼容。
- 桌面端可按配置/能力选择实时或非流式执行。

---

## Phase 5：压测、回归与灰度（1 天）

目标：以可量化指标评估实时链路上线风险。

测试矩阵：
1. 正常播放：短句/长句/多语种。
2. 高频打断：连续 10 次快速输入。
3. 网络抖动：延迟、丢包、短断连。
4. 冲突回归：语音结束后 expression/motion 可正常触发。

观测指标（建议阈值）：
- `first_audio_latency_ms` P95 < 600ms
- `playback_start_success_rate` > 99%
- `lipsync_active_rate_during_playback` > 98%
- `interrupt_stop_latency_ms` P95 < 300ms
- `fallback_trigger_rate`（可监控，不设硬阈值）

灰度步骤：
1. 默认 `non_streaming`。
2. 内部灰度 `realtime`（10%/30%/100%）。
3. 任何阶段异常可一键回退 `voice.transport=non_streaming`。

## 4. 事件契约（建议）

主链路事件（Desktop 内部）：

1. `voice.requested`
- `request_id, session_id, text, model, voiceId, timeoutSec`

2. `voice.stream.started`
- `request_id, codec, sample_rate, chunk_ms`

3. `voice.stream.chunk`
- `request_id, seq, payload(bytes/base64), duration_ms`

4. `voice.stream.completed`
- `request_id, total_chunks, total_ms`

5. `voice.stream.failed`
- `request_id, code, error`

说明：
- `voice.playback.started/ended/failed` 保持现有上报语义，方便与非流式统一看板。

## 5. 风险与规避

1. 实时 chunk 编码与 renderer 可播格式不一致
- 规避：Phase 2 先做协议探针；Phase 3 落地前固定 codec（优先可直接播的容器/编码）。

2. lipsync 与播放源不同步
- 规避：口型只跟随“实际播放链路”分析，禁止直接消费服务端能量值驱嘴。

3. 抢占清理不彻底导致动作冲突回归
- 规避：沿用并强化 `stopLipsync` 与 hook 清理校验，新增自动化回归用例。

4. 实时链路稳定性不足
- 规避：保留 `non_streaming` 兜底 + 配置级快速回退。

## 6. 交付清单（按阶段）

1. 配置与契约冻结文档。
2. `aliyun_voice_clone_http.py` + 复刻 SOP。
3. `qwenTtsRealtimeClient.js` + Desktop debug 观测。
4. `RealtimeVoicePlayer` + renderer 流式播放接入。
5. 回归测试与灰度报告。

## 7. 本方案的落地边界

1. 本轮优先“实时 TTS + 口型兼容”，不扩展 Live2D 语义动作编排。
2. 先保证稳定，再优化“更低首包时延”和“更细粒度 viseme 质量”。
3. 若 realtime API 能力或编码格式限制超出预期，优先保证用户可用（自动回退非流式）。

## 8. 当前进展（2026-03-04）

1. Phase 0 已完成：`voice.transport / voice.realtime.prebuffer_ms / voice.realtime.idle_timeout_ms / voice.fallback_on_realtime_error` 已落地配置与解析。
2. Phase 1 已完成：`scripts/aliyun_voice_clone_http.py` 可通过 HTTP 复刻音色；支持写回 `tts_voice` 或 `tts_realtime_voice`。
3. Phase 2 已完成：`QwenTtsRealtimeClient` 已按 realtime 协议接入（`/api-ws/v1/realtime`、`session.update`、`input_text_buffer.*`），Desktop main 已具备 realtime probe 与 chunk 级观测。
4. 实测结论：默认 realtime 配置（`tts_realtime_model + tts_realtime_voice`）可稳定返回 chunk 流与完成事件；异常时可回退非流式链路。
5. Phase 3（基础版）已落地：Desktop main 已通过 IPC 下发 `stream-start/chunk/end/error`，renderer 已新增 `RealtimeVoicePlayer` 播放 PCM chunk，并用同一 analyser 驱动现有 lipsync 核心。
6. 下一步：补充 Phase 3 的端到端手工回归与稳态参数调优（prebuffer/idle timeout），再进入 Phase 4 策略并轨。
