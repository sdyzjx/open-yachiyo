# 模型配置 v2 测试用例

> 类型: testcase
> 状态: active
> 负责人: sonnet-ws2
> 更新: 2026-10-12
> 关联: docs/features/FEAT-llm-model-config-v2.md, docs/plans/PLAN-android-ws2-llm-models.md

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-LLM-001 | v1 配置原样可读并规范化为 v2 视图 | unit | 仅含 `active_provider` + `model` 的 v1 配置 | `validateConfig` + `normalizeProviderConfig` | 校验通过；`active_model=<provider>/<model>`；输入对象未被修改 | test/runtime/config/providerConfigSchemaV2.test.js「v1 config stays valid…」 |
| TC-LLM-002 | v2 配置（预设、多模型、roles、fallback）通过校验 | unit | `preset: deepseek` 的 provider | 校验并规范化 | 继承预设 type/base_url/models/compat | 同上「v2 config with preset…」 |
| TC-LLM-003 | 新 provider 类型与无需密钥的 ollama | unit | anthropic/google/asr_*/ollama provider | 校验并规范化 | 通过；anthropic 补默认 base_url | 同上「new provider types…」 |
| TC-LLM-004 | 非法引用 / 空模型 / 缺密钥被拒绝 | unit | 各种错误配置 | `validateConfig` | 抛出对应错误 | 同上「validation rejects…」 |
| TC-LLM-005 | 含 `/` 的模型 id 正确拆分 ref | unit | openrouter 风格 id | `splitModelRef` | provider 取最长前缀 | 同上「splitModelRef…」 |
| TC-LLM-006 | 预设覆盖契约 C4.3 全部 id，且返回副本 | unit | — | `listPresets/getPreset` | 11 个预设齐全；deepseek 字段正确；修改返回值不影响源 | test/runtime/config/providerPresets.test.js |
| TC-LLM-007 | 每个非 custom 预设生成合法 provider | unit | 仅 `preset` + `api_key` | `validateConfig` | 全部通过 | 同上「every non-custom preset…」 |
| TC-LLM-008 | Catalog v2：多模型、enabled 顺序、roles、回退链、asr、密钥解析 | unit | v2 yaml（deepseek/qwen/openrouter/asr） | `loadModelCatalog` | 描述符字段（headers/extra_body/compat/api_key）正确；回退链去重且忽略不存在项 | test/runtime/config/modelCatalog.test.js「catalog v2…」 |
| TC-LLM-009 | Catalog 的 api 映射与 ollama 无密钥 | unit | anthropic/gemini/ollama 预设 | `loadModelCatalog` | api 为 anthropic-messages / google-generative-ai / openai-completions；ollama key 为 null | 同上「catalog maps anthropic/google…」 |
