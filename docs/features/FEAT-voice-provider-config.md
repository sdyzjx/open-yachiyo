# 语音 Provider 配置（TTS / ASR 可切换）

> 类型: feature
> 状态: active
> 负责人: agent/v2-voice-providers
> 更新: 2026-10-13
> 关联: docs/plans/PLAN-desktop-companion-v2.md §2 (C8), apps/runtime/voice/, apps/runtime/config/providerConfigStore.js, apps/runtime/config/modelCatalog.js, docs/testing/TC-voice-provider-config.md

## 1. 概述

TTS 与 ASR 不再硬编码 provider key `qwen3_tts`：`providers.yaml` 可声明多个语音 provider，并通过顶层 `voice.active_tts` / `voice.active_asr` 选择当前使用的一个。桌面端播放、手机端播放（gateway voiceRelay）与手机语音输入（asrService）都走同一套 `apps/runtime/voice/` 抽象。

## 2. 行为说明

provider 解析顺序（`modelCatalog.tts` / `modelCatalog.asr`）：

1. TTS：`voice.active_tts` → 环境变量 `TTS_PROVIDER_KEY`（仅 TTS，最低优先级的兼容入口）→ 第一个 `tts_*` provider。
2. ASR：`voice.active_asr` → 第一个 `asr_*` provider。

候选 key 不存在或类型不匹配时跳过，继续下一级。无 `voice` 段的 v1/v2 配置保持有效，旧 key `qwen3_tts`（`tts_dashscope`）无需迁移即可使用。

| 类型 | 协议 | 实时 TTS |
|---|---|---|
| `tts_dashscope` | `POST {base_url}/services/aigc/multimodal-generation/generation`，返回音频 URL 后下载 | 配置了 `tts_realtime_model` 时支持 |
| `tts_openai_compatible` | `POST {base_url}/audio/speech`，`{model, voice, input, response_format}` | 否（自动走非流式） |
| `asr_dashscope` | `{base_url 的 compatible-mode}/chat/completions` 内联 WAV | - |
| `asr_openai_compatible` | multipart `POST {base_url}/audio/transcriptions` | - |

桌面端：实时传输（`voice.transport=realtime`）仅在当前 TTS provider `supportsRealtime` 时启用，否则自动回退非流式。

## 3. 接口与协议

```js
const { createTtsClient, createAsrClient, describeVoiceConfig } = require('apps/runtime/voice');
createTtsClient({ store, providerKey?, fetchImpl? })
  // → { providerKey, type, supportsRealtime, synthesize({text, voice?, model?, timeoutMs?}) → {buffer, mime, model, voice, audioUrl?} }
createAsrClient({ store, providerKey?, fetchImpl? })
  // → { providerKey, type, transcribe({buffer, mime, lang}) → {text} }
describeVoiceConfig({ store })
  // → { active_tts, active_asr, providers:[{key,type,display_name,base_url,api_key_env,has_api_key,...}] }（无密钥）
```

错误码：`TTS_CONFIG_MISSING`、`TTS_INVALID_PARAMS`、`TTS_PROVIDER_AUTH_FAILED`、`TTS_PROVIDER_DOWN`、`TTS_TIMEOUT`、`TTS_AUDIO_FETCH_FAILED`；ASR：`ASR_CONFIG_MISSING`、`ASR_HTTP_ERROR`、`ASR_EMPTY`。

## 4. 配置项

```yaml
voice:
  active_tts: qwen_tts      # 可选
  active_asr: aliyun_asr    # 可选
providers:
  qwen_tts:  { type: tts_dashscope, base_url, api_key_env, tts_model, tts_voice, tts_realtime_model?, tts_realtime_voice? }
  openai_tts: { type: tts_openai_compatible, base_url, api_key|api_key_env, tts_model, tts_voice, format? }  # format: mp3|wav|opus|aac|flac|pcm，默认 mp3
  aliyun_asr: { type: asr_dashscope | asr_openai_compatible, base_url, api_key_env, model }  # 旧字段 asr_model 仍可读
```

校验错误示例：`voice.active_tts references unknown provider: x`、`voice.active_tts provider chat must be a tts_* type (got openai_compatible)`、`provider oai_tts must define tts_voice`。

## 5. 限制与已知问题

- `apps/runtime/tooling/adapters/voice.js`（Agent 的 voice 工具）仍读取 `TTS_PROVIDER_KEY || qwen3_tts`，不在本次改造范围。
- 实时 TTS 客户端（`qwenTtsRealtimeClient.js`）按同一解析顺序选择 provider，仅支持 DashScope 协议。
- `tts_openai_compatible` 不返回音频 URL，桌面端以内存/`data:` URL 播放。

## 6. 测试用例

见 `docs/testing/TC-voice-provider-config.md`：TC-VOC-001 … TC-VOC-005（schema 与解析）、TC-VOC-010 … TC-VOC-016（运行时客户端）、TC-VOC-020 … TC-VOC-023（消费方切换）。
