# Electron 语音对话系统施工方案（Qwen ASR + Qwen3-TTS-VC，暂不含 Live2D）

Last Updated: 2026-02-26  
Owner: runtime  
Related Requirement: `REQ-20260226-009`（异步语音工具链）

---

## 1. 目标与边界

## 1.1 目标

构建 Electron 端自然语音对话系统，核心链路如下：
- 用户麦克风输入音频。
- 音频经 `voice.asr.aliyun` 转写后进入 **标准 Session 回路**。
- 模型正常生成文本回复。
- 在 policy 允许时触发 `voice.tts.aliyun_vc` 生成语音并播放。

## 1.2 本版边界（明确不做）

- 不做 Live2D 口型/动作同步。
- 不新增语音专用会话语义。
- 不绕开现有 `tool.call.requested/result` 总线。

## 1.3 核心原则

1. 语音输入与文本输入同级（统一 session 主链路）。
2. ASR/TTS 完全 Tool 化（可替换 Provider）。
3. 先契约后实现（schema/error/timeout/cancel 先冻结）。
4. 任一语音步骤失败时，文本主回复不受影响。

---

## 2. 端到端链路

```text
Electron Mic
 -> voice.asr.aliyun
 -> session.user_message(text)
 -> runtime normal loop (text reply)
 -> (optional) voice.tts.aliyun_vc
 -> Electron player
```

---

## 3. 分层设计

## 3.1 Contract 层（稳定）

- `voice.asr.aliyun`
- `voice.tts.aliyun_vc`

> 本版不引入 `voice.plan`，避免额外时延与复杂度。可在后续作为 explain-only 观测工具补充。

## 3.2 Orchestrator / Policy 层（可控）

- 语音触发判定（must/may/must-not）
- 冷却与频率限制
- 取消、超时、重试、降级

## 3.3 Adapter 层（可替换）

- `AsrAdapterAliyun`
- `TtsAdapterAliyunVc`
- `AudioOutputAdapterElectron`

## 3.4 Event 层（统一）

- `tool.call.requested`
- `tool.call.result`
- `voice.policy.checked`
- `voice.job.started|completed|failed|cancelled`
- `voice.output.published`

---

## 4. Tool Contract v1（冻结草案）

## 4.1 `voice.asr.aliyun`

### Input
```json
{
  "version": "1.0",
  "requestId": "uuid",
  "idempotencyKey": "session-turn-hash",
  "audioRef": "obj://... or file://...",
  "format": "wav|mp3|ogg|webm|m4a",
  "lang": "zh|en|auto",
  "sampleRate": 16000,
  "hints": ["optional", "phrases"]
}
```

### Output
```json
{
  "text": "string",
  "confidence": 0.93,
  "segments": [
    {"startMs": 0, "endMs": 850, "text": "你好"}
  ],
  "providerMeta": {
    "provider": "aliyun_dashscope",
    "latencyMs": 780
  }
}
```

### Error Codes
- `ASR_BAD_AUDIO`
- `ASR_TIMEOUT`
- `ASR_PROVIDER_DOWN`
- `ASR_UNSUPPORTED_FORMAT`
- `ASR_RATE_LIMITED`
- `ASR_CANCELLED`

## 4.2 `voice.tts.aliyun_vc`

### Input
```json
{
  "version": "1.0",
  "requestId": "uuid",
  "idempotencyKey": "session-turn-hash",
  "text": "string",
  "voiceId": "qwen-tts-vc-...",
  "model": "qwen3-tts-vc-2026-01-22",
  "voiceTag": "zh|jp|en",
  "speed": 1.0,
  "maxDurationSec": 45,
  "sessionId": "string",
  "turnId": "string"
}
```

### Output
```json
{
  "audioRef": "obj://voice/2026/.../x.ogg",
  "format": "ogg",
  "durationMs": 6120,
  "sampleRate": 48000,
  "expiresAt": "2026-02-27T12:00:00Z"
}
```

### Error Codes
- `TTS_POLICY_REJECTED`
- `TTS_TEXT_TOO_LONG`
- `TTS_MODEL_VOICE_MISMATCH`
- `TTS_TIMEOUT`
- `TTS_PROVIDER_DOWN`
- `TTS_RATE_LIMITED`
- `TTS_CANCELLED`

---

## 5. Qwen3-TTS-VC 参考音频约束（按现有 skills 规则）

以下约束直接纳入系统校验与文档，不满足即拒绝创建/更新音色：

1. 格式：`WAV(16bit)` / `MP3` / `M4A`
2. 时长：推荐 `10~20 秒`，最长 `60 秒`
3. 文件大小：`< 10MB`
4. 采样率：`>= 24kHz`
5. 声道：单声道（mono）
6. 内容质量：至少 `3 秒`连续清晰朗读
7. 禁止项：背景音乐、明显噪声、人声重叠

## 5.1 模型一致性硬规则（必须）

创建音色时的 `target_model` 必须与后续 TTS 合成 `model` 完全一致，否则拒绝执行并返回 `TTS_MODEL_VOICE_MISMATCH`。

示例：
- create: `qwen3-tts-vc-2026-01-22` → synth: `qwen3-tts-vc-2026-01-22` ✅
- create: `qwen3-tts-vc-realtime-2026-01-15` → synth: `qwen3-tts-vc-2026-01-22` ❌

---

## 6. Policy 机制

建议配置文件：`config/voice-policy.yaml`

```yaml
voice_policy:
  must_speak_if:
    - input_type == audio && reply_complexity == low

  may_speak_if:
    - sentence_count <= 4
    - no_code_block == true

  must_not_speak_if:
    - contains_code == true
    - contains_table == true
    - contains_many_links == true
    - is_troubleshooting == true

  limits:
    max_chars: 220
    max_duration_sec: 45
    cooldown_sec_per_session: 20
    max_tts_calls_per_minute: 3
```

执行语义：
1. 模型请求 `voice.tts.aliyun_vc`。
2. Policy Middleware 判定 `allow|deny|rewrite`。
3. deny 时返回结构化原因，继续文本路径。
4. allow 时执行 TTS。

---

## 7. 状态机与并发

每个 turn：
`IDLE -> ASR_RUNNING -> TEXT_READY -> TTS_RUNNING -> PLAYING -> DONE`

抢占规则：
- 新输入到达时，取消当前 TTS/播放：`CANCELLED_BY_NEW_INPUT`。
- 旧任务晚到结果，若 `turnId < latestTurnId`，直接丢弃（防止错播）。

幂等要求：
- 以 `idempotencyKey` 去重。
- 同 key 重试必须返回同一逻辑结果（或可解释拒绝）。

---

## 8. 代码落点（建议）

## 8.1 Runtime
- `apps/runtime/tooling/voice/contracts.js`
- `apps/runtime/tooling/voice/policy.js`
- `apps/runtime/tooling/voice/jobManager.js`
- `apps/runtime/tooling/voice/adapters/asr/aliyun.js`
- `apps/runtime/tooling/voice/adapters/tts/aliyunVc.js`
- `apps/runtime/tooling/voice/adapters/channel/electron.js`
- `apps/runtime/executor/toolRegistry.js`
- `apps/runtime/loop/toolLoopRunner.js`

## 8.2 Gateway
- `apps/gateway/*`（音频上传、鉴权、TTL、清理）

## 8.3 Electron
- `apps/desktop/*`（录音采集、播放、打断、状态反馈）

## 8.4 Tests
- `test/runtime/voice/*.test.js`
- `test/e2e/voice-session-flow.test.js`

---

## 9. 施工计划

## Phase 0（0.5~1 天）
- 冻结 Tool schema、错误码、事件名、参考音频校验规则。
- 产出：`docs/VOICE_API_CONTRACT.md`

## Phase 1（2~3 天）
- 打通 `voice.tts.aliyun_vc` + policy + cooldown + fallback。

## Phase 2（2~3 天）
- 打通 `voice.asr.aliyun`，并接入 session.user_message。

## Phase 3（1~2 天）
- 并发/打断/重试/幂等/资源清理。

## Phase 4（1~2 天）
- 监控、审计、回归测试。

---

## 10. 验收标准

1. 同一 session 中，语音输入与文本输入共享上下文。
2. 语音输出仅通过 tool call 触发，不绕过 loop。
3. TTS 失败不影响文本主回复。
4. 支持会话级打断：
   - Player stop P95 < 200ms
   - 端到端可感知停止 P95 < 500ms
5. 冷却与频率上限生效。
6. 可观测：每次语音决策、执行与结果可追踪。
7. 参考音频不合规时，创建音色被明确拒绝并给原因。

---

## 11. 主要风险与应对

1. **Provider 延迟波动**
   - timeout + retry(1) + 文本兜底。

2. **异步竞态导致重复播报**
   - `turnId + idempotencyKey + latestTurnFence`。

3. **音色与模型错配**
   - 调用前硬校验 + 统一错误码。

4. **资源泄漏（临时音频堆积）**
   - `expiresAt` + 定时清理任务。

5. **策略不透明**
   - `voice.policy.checked` 记录 deny reason（结构化）。

---

## 12. 下一步（立即执行）

1. 将本方案登记为 `REQ-20260226-009` 的实施子计划。
2. 先冻结 `voice.tts.aliyun_vc` contract + 参考音频校验规则。
3. 先打通 “文本回复 + 可选语音输出（TTS）” MVP，再接 ASR。

> 先把稳定性做对，再做体验增强。