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
| TC-LLM-010 | headers / extra_body / max_tokens_field / developer 角色兼容 | integration | 本地 mock HTTP | `OpenAIReasoner.decide` | 请求头、请求体字段符合配置 | test/runtime/config/llmCompat.test.js「headers, extra_body…」 |
| TC-LLM-011 | 无密钥本地 provider；reasoning 模型不发默认 temperature | integration | mock | `requireApiKey:false`、`reasoning:true` | 无 Authorization；无 temperature | 同上「no api key required…」 |
| TC-LLM-012 | deepseek-reasoner 流式 `reasoning_content` 不污染输出，历史剥离 | integration | mock SSE | `decideStream` | output 仅含 content；`onReasoningDelta` 收到思考；历史消息不含 reasoning_content | 同上「deepseek-reasoner stream…」 |
| TC-LLM-013 | `strip_reasoning_in_history=false` 保留 reasoning | integration | mock | `decide` | assistantMessage 带 reasoning_content，历史原样发送 | 同上「strip_reasoning_in_history=false…」 |
| TC-LLM-014 | 回退链：首模型 503 → 次模型成功并报告 fallback | integration | 两个 mock，`fallback_models` | `manager.getReasoner({onFallback})` | 返回次模型输出；回调含 from/to/status | 同上「fallback chain…」 |
| TC-LLM-015 | 不可重试错误（401）不触发回退 | integration | 同上 | `decide` | 抛出 401，次模型零请求 | 同上「fallback does not trigger…」 |
| TC-LLM-016 | `model_ref` 覆盖与未知 ref 报错；provider 选项进入请求 | integration | 两个 mock | `getReasoner({modelRef})` | 使用指定模型；未知 ref 抛 `Unknown model_ref` | 同上「model_ref override…」 |
| TC-LLM-017 | Runner 透传 modelRef 并在 bus 发布 `llm.fallback` | unit | stub reasoner | `ToolLoopRunner.run({modelRef})` | getReasoner 收到 modelRef/sessionId；bus 收到 llm.fallback | 同上「ToolLoopRunner forwards modelRef…」 |
