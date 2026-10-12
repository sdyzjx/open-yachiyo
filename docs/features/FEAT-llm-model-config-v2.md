# 模型配置 v2（多 provider / 多模型）

> 类型: feature
> 状态: active
> 负责人: sonnet-ws2
> 更新: 2026-10-12
> 关联: docs/plans/PLAN-android-companion-contracts.md §C4, docs/plans/PLAN-android-ws2-llm-models.md, docs/testing/TC-llm-model-config-v2.md

## 1. 概述

`providers.yaml` 升级为 schema v2：一个 provider 可含多个模型，用户可启用多个模型并切换，按用途（chat/vision/summary）分配模型，并配置失败回退链；内置 DeepSeek、Kimi、GLM、SiliconFlow、OpenRouter、Ollama、Anthropic、Gemini 等预设。v1 配置无需迁移即可继续使用。

## 2. 行为说明

- `providerConfigStore.normalizeProviderConfig(config)` 把 v1/v2 配置规范化为统一 v2 视图（不修改输入）：`model` → `models[]`，`preset` 提供缺省字段，`active_provider`+`model` → `active_model`。
- 模型引用 `ref` = `<provider_key>/<model_id>`，model id 可含 `/`。
- `validateConfig` 校验类型、必填字段、`active_model`/`enabled_models`/`fallback_models`/`roles` 引用必须存在。`ollama` 预设（或 `auth: none` / `requires_api_key: false`）无需密钥。

## 3. 接口与协议

见契约 C4（`PLAN-android-companion-contracts.md`）。本功能新增导出：`normalizeProviderConfig`、`splitModelRef`、`ProviderConfigStore#loadNormalized()`。

### 3.1 预设与 Model Catalog

- `providerPresets.js`：`listPresets()`、`getPreset(id)`；预设 id：openai、deepseek、qwen、moonshot、zhipu、siliconflow、openrouter、ollama、anthropic、gemini、custom。provider 写 `preset: <id>` 即继承 type/base_url/api_key_env/models/compat。
- `modelCatalog.loadModelCatalog({store})`：返回 `models/enabled/active/resolve/forRole/fallbackChain/tts/asr`（契约 C4.2）。描述符的 `headers/compat/extra_body/temperature` 为 provider 与模型级字段合并（模型级优先）；`api_key` 由 `api_key` 或 `api_key_env` 解析。

### 3.2 运行时（legacy 循环）

- `OpenAIReasoner` 新选项：`headers`、`extraBody`（合并进请求体）、`compat.{max_tokens_field,supports_developer_role,reasoning_content_field,strip_reasoning_in_history}`、`temperature`、`maxTokens`、`reasoning`、`requireApiKey`。流式 `delta.reasoning_content` 不进入输出文本，通过 `onReasoningDelta` 与 `decision.reasoning_content` 提供；历史消息默认剥离 reasoning 字段。
- `LlmProviderManager.getReasoner({ modelRef, onFallback })`：按 catalog 解析 active 模型（或 `modelRef` 覆盖），并在配置了 `fallback_models` 时返回 `FallbackReasoner`。仅当错误可重试（网络/408/409/429/5xx，`error.retriable`）且尚未向消费者流出文本时切换下一个模型。
- 回退时 runner 发出 runtime 事件 `llm.fallback` 并在 bus 发布 topic `llm.fallback`：`{session_id, trace_id, from, to, error, status}`。
- `runtime.run` 的 `params.model_ref` → `RuntimeRpcWorker` → `runtimeContext.model_ref` 与 `runner.run({modelRef})`（pi 路径读取同一字段）。
- legacy 循环仅能调用 `openai-completions`；anthropic/google 模型在 legacy 下会报明确错误。

### 3.3 HTTP（`apps/gateway/routes/modelConfig.js`，响应均为 `{ok, data}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config/models` | `{active, enabled, roles, fallback_models, models[], providers{}}`；`active`/`enabled` 为 ref 字符串；`models[]` 为描述符去掉 `api_key`，附 `has_api_key`、`enabled`；`providers` 为可编辑的 provider 概要（同样无 key） |
| PUT | `/api/config/models/selection` | `{active_model?, enabled_models?, roles?, fallback_models?}`，引用不存在返回 400；成功后写 `providers.yaml` 并 `commitConfigChange` |
| GET | `/api/config/models/presets` | 预设列表 |
| POST | `/api/config/models/test` | `{ref}` 或 `{provider: <key|临时配置>, provider_key?, model?, timeout_ms?}` → 发送最小请求，返回 `{ok, latency_ms, status, error}`（默认超时 15s，上限 60s；错误文本脱敏） |
| POST | `/api/config/models/discover` | `{provider: <key|临时配置>, provider_key?}` → 调 `GET {base_url}/models`（anthropic 为 `/v1/models`，gemini 解析 `models[].name`），返回 `{ok, models:[{id,name}]}` |
| PUT | `/api/config/models/providers/:key` | （增量，供配置页）新增/更新 provider；`api_key` 缺省或为空则保留原值，`clear_api_key:true` 清除 |
| DELETE | `/api/config/models/providers/:key` | 删除 provider 并清理 enabled/fallback/roles/active 引用 |
| PUT | `/api/sessions/:id/settings` | 路由层前置校验 `settings.model_ref`（null/空串清除；未知 ref → 400），随后由原有处理器持久化 |

会话 `model_ref` 优先级：`runtime.run params.model_ref` > 会话设置 `model_ref` > `active_model`。

### 3.4 配置页

`/config-v2.html` 新增 **models** 标签页（`config-v2-models.js/.css`）：模型选择（启用/当前/按用途/回退链）、provider 列表与编辑器（预设添加、模型列表、headers/compat/extra_body JSON、发现模型、测试连接、保存/删除）。所有动态文本使用 `textContent` 渲染；API Key 输入框不回显。

## 4. 配置项

支持的 `type`：`openai_compatible`、`anthropic`、`google`、`tts_dashscope`、`asr_openai_compatible`、`asr_dashscope`。完整 schema 见契约 C4.1。

## 5. 限制与已知问题

- `anthropic`/`google` 类型当前仅由 Model Catalog 描述，legacy 循环尚不直接调用，由 pi 核心（WS1）消费。

## 6. 测试用例

TC-LLM-001 ~ TC-LLM-027，见 `docs/testing/TC-llm-model-config-v2.md`。
