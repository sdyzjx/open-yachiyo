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
| TC-LLM-018 | `GET /api/config/models` 不泄露 api_key，返回 has_api_key | integration | 含内联 key 的配置 | GET | 响应不含 key 字符串；`has_api_key` 正确；`enabled` 标记 | test/runtime/config/modelConfigRoutes.test.js「GET /api/config/models never leaks…」 |
| TC-LLM-019 | `PUT /selection` 未知 ref 返回 400；成功则持久化并提交 config git | integration | 同上 | PUT 非法/合法选择 | 400 且无提交；成功后 GET 反映新选择，key 未丢失，`commitConfigChange('providers.yaml')` 被调用 | 同上「PUT selection validates refs…」 |
| TC-LLM-020 | `GET /presets` | integration | — | GET | 至少 11 个预设 | 同上「GET presets…」 |
| TC-LLM-021 | provider 增删改：省略 api_key 保留原值；删除清理引用 | integration | 同上 | PUT/DELETE `/providers/:key` | 保留 key；非法 key 400；删除后 fallback/roles 清理；重复删除 404 | 同上「provider upsert…」 |
| TC-LLM-022 | `POST /test` 成功/失败/草稿继承 key，错误中 key 被脱敏 | integration | mock 上游 | POST | 成功含 latency；401 时 `ok:false,status:401` 且不含 key；未知 ref 400 | 同上「POST test: success…」 |
| TC-LLM-023 | `POST /test` 超时不挂起 | integration | 永不响应的上游 | POST `timeout_ms:150` | 返回 `ok:false`，error 含 timeout | 同上「POST test times out…」 |
| TC-LLM-024 | `POST /discover`（openai 风格与 gemini 风格） | integration | mock 上游 | POST | 返回模型 id 列表；未知 provider 400 | 同上「POST discover…」 |
| TC-LLM-025 | 会话级 `model_ref`：未知 ref 400；合法/清除/缺省放行；merge 持久化 | integration | — | `PUT /api/sessions/:id/settings` | 400 / 放行；`mergeSessionSettings` 保留与清除 model_ref | 同上「session settings…」 |
| TC-LLM-026 | 随仓库发布的 `config/providers.yaml` 模板是合法 v2 配置 | unit | — | 校验并加载 Catalog | active=qwen35_plus/qwen3.5-plus；含 deepseek-reasoner（reasoning）；enabled 3 个；tts 保留 | test/runtime/config/providerConfigSchemaV2.test.js「shipped config/providers.yaml…」 |
| TC-LLM-027 | 配置页 models 标签页：渲染、勾选启用并保存、编辑 provider、测试连接 | manual-device | 启动网关，打开 `/config-v2.html` | 1) 打开 models 页 2) 勾选/切换当前模型并保存 3) 编辑 provider，点击「发现模型」「测试连接」4) 保存 provider | 状态栏显示「已保存 ✓」；密钥框留空不丢失原密钥；测试失败时显示状态码与脱敏后的错误 | manual |
| TC-LLM-028 | `params.model_ref` 优先于会话 `model_ref`，均以 `model_ref` 透传给 runner | integration | stub runner | `runtime.run` 带/不带 `params.model_ref` | runner 收到 `modelRef` 与 `runtimeContext.model_ref`：参数优先，否则取会话设置 | test/runtime/config/llmCompat.test.js「RuntimeRpcWorker: params.model_ref…」 |
