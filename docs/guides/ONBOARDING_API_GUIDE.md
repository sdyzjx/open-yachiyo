# Onboarding API Guide

本文档记录 onboarding 第一版实现的接口契约、写入规则和验证步骤。

## 1. 接口列表

- `GET /api/onboarding/state`
- `GET /api/onboarding/health`
- `POST /api/onboarding/provider/save`
- `POST /api/onboarding/voice/clone`
- `POST /api/onboarding/voice/save-manual`
- `POST /api/onboarding/preferences/save`
- `POST /api/onboarding/complete`
- `POST /api/onboarding/skip`

## 2. 数据写入规则

### 2.1 LLM Provider

`POST /api/onboarding/provider/save` 会写入 `providers.yaml`：

- provider type 固定为 `openai_compatible`
- `active_provider` 默认切换到本次 provider key

示例请求：

```json
{
  "provider": {
    "key": "qwen35_plus",
    "display_name": "Qwen 3.5 Plus",
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen3.5-plus",
    "api_key": "sk-***",
    "timeout_ms": 20000
  },
  "active_provider": "qwen35_plus"
}
```

### 2.2 Voice Clone 与 TTS

`POST /api/onboarding/voice/clone`：

- 接收 `audio_data_url`（base64）
- 使用 ffprobe 校验，必要时用 ffmpeg 转码为 24k mono mp3
- 调用 DashScope customization API 创建 voice
- 自动写入/更新 `providers.qwen3_tts`

模式映射：

- `target_mode=normal` -> 更新 `tts_model` + `tts_voice`
- `target_mode=realtime` -> 更新 `tts_realtime_model` + `tts_realtime_voice`

注意：为满足现有 `tts_dashscope` 校验，`tts_model` 与 `tts_voice` 仍会保留。

`POST /api/onboarding/voice/save-manual`：

- 不调用百炼
- 直接保存已有 voice id（用于克隆失败兜底）

### 2.3 偏好配置

`POST /api/onboarding/preferences/save` 支持：

- `voice_policy`（auto reply + limits）
- `persona_defaults`
- `skills`

该接口执行“部分字段合并”，不覆盖未提交字段。

### 2.4 完成状态

`POST /api/onboarding/complete` 写入：

- `~/yachiyo/data/onboarding-state.json`
- 字段：`done/version/completed_at/last_step`

`POST /api/onboarding/skip` 写入：

- `~/yachiyo/data/onboarding-state.json`
- 字段：`done/skipped/version/completed_at/last_step`

## 3. 错误码

- `ONBOARDING_DEP_MISSING`
- `ONBOARDING_AUDIO_INVALID`
- `ONBOARDING_DASHSCOPE_AUTH_FAILED`
- `ONBOARDING_DASHSCOPE_TIMEOUT`
- `ONBOARDING_DASHSCOPE_PROVIDER_DOWN`
- `ONBOARDING_CONFIG_SAVE_FAILED`

## 4. 手工验证步骤

1. 启动 gateway + desktop。
2. 首次进入 `/onboarding.html`。
3. Step 1 保存 LLM provider，检查 `/api/config/providers/config`。
4. Step 2：
   - 上传音频，检查返回 `voice_id`
   - 查看 `providers.yaml` 中 `qwen3_tts` 是否写入
5. Step 3 保存偏好，检查 `voice-policy.yaml/persona.yaml/skills.yaml` 变化。
6. 点击完成，检查 `/api/onboarding/state` 的 `done=true`。
7. 重启桌面，确认直接进入主页而不是 onboarding。

## 5. 已知限制

- 当前环境若缺少 `ffmpeg/ffprobe`，voice clone 会失败并返回 `ONBOARDING_DEP_MISSING`。
- 本地开发环境未检测到 `node/npm` 可执行程序，自动化测试尚未在本机执行。
- Desktop Live2D 入口尚未接入 onboarding 首启判定（当前接入点为 `apps/desktop/main.js`）。
