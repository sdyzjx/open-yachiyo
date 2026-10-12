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

## 4. 配置项

支持的 `type`：`openai_compatible`、`anthropic`、`google`、`tts_dashscope`、`asr_openai_compatible`、`asr_dashscope`。完整 schema 见契约 C4.1。

## 5. 限制与已知问题

- `anthropic`/`google` 类型当前仅由 Model Catalog 描述，legacy 循环尚不直接调用，由 pi 核心（WS1）消费。

## 6. 测试用例

TC-LLM-001 ~ TC-LLM-009，见 `docs/testing/TC-llm-model-config-v2.md`。
