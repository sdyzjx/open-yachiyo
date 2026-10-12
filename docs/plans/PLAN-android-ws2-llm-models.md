# WS2 施工文档：模型配置 v2（多 provider / 多模型 / DeepSeek 等）

> 类型: plan
> 状态: active
> 负责人: sonnet-ws2
> 更新: 2026-10-12
> 关联: PLAN-android-companion-contracts.md §C4

## 1. 目标

提高 API 通用性：支持 DeepSeek、Kimi、GLM、SiliconFlow、OpenRouter、Ollama、Anthropic、Gemini 等；一个 provider 多个模型；用户可启用多个模型并切换；按用途（chat / vision / summary）分配模型；失败回退链；电脑端配置页可视化配置；为 pi 核心（WS1）与手机配置界面提供统一的 Model Catalog。

## 2. 负责路径

- `apps/runtime/config/providerConfigStore.js`（schema v2 校验，兼容 v1）
- `apps/runtime/config/modelCatalog.js`（统筹者已提交 v1 兼容桩，你负责完整实现，**保持导出签名不变**）
- `apps/runtime/config/providerPresets.js`（新增）
- `apps/runtime/config/llmProviderManager.js`（legacy 路径：按 catalog 解析 active 模型、`model_ref` 覆盖、回退链）
- `apps/runtime/llm/openaiReasoner.js`（headers、extra_body、compat：`max_tokens_field`、`supports_developer_role`、`reasoning_content` 处理——流式中忽略/收集 `delta.reasoning_content`，历史消息中按 `strip_reasoning_in_history` 剥离）
- `apps/gateway/routes/modelConfig.js`（新增 Express Router，契约 C4.4）；`apps/gateway/server.js` 仅增加一行挂载
- `apps/gateway/public/config-v2.*`（新增「模型」标签页：预设选择、provider 编辑、模型列表与发现、多选启用、角色分配、回退链、连通性测试）
- `config/providers.yaml`（模板改为 v2 示例，含 deepseek）
- `docs/guides/PROVIDER_CONFIGURATION_GUIDE.md`（更新）
- `test/runtime/config/**`

不得修改：`apps/runtime/agent-pi/**`、`apps/gateway/deviceHub/**`、`apps/android/**`。

## 3. 任务与提交点

| # | 任务 |
|---|---|
| 1 | schema v2 校验 + v1 兼容规范化（`normalizeProviderConfig`）；新增类型 `anthropic`、`google`、`asr_openai_compatible`、`asr_dashscope`；测试 v1 原样可读 |
| 2 | `providerPresets.js`（契约 C4.3 全部预设） + `modelCatalog.js` 完整实现（契约 C4.2 全部 API） |
| 3 | `openaiReasoner` 通用性增强 + `llmProviderManager` 使用 catalog、回退链（仅在可重试错误时切换下一个模型，发 bus 事件 `llm.fallback`）、`model_ref` 覆盖 |
| 4 | 网关路由 `modelConfig.js`（C4.4 全部接口；`api_key` 永不回传，只给 `has_api_key`；`test` 与 `discover` 设超时；保存后写入 config git 仓库 `commitConfigChange`） |
| 5 | 会话级模型覆盖：`PUT /api/sessions/:id/settings` 支持 `model_ref`（与现有 settings 合并，校验 ref 存在）；`runtime.run` 的 `params.model_ref` 透传到 runtime（legacy 路径实现，pi 路径由 WS1 读取同一字段） |
| 6 | 配置页 UI（config-v2 新增「模型」页） |
| 7 | 文档：`docs/features/FEAT-llm-model-config-v2.md`、`docs/testing/TC-llm-model-config-v2.md`（`TC-LLM-001…`）、更新 Provider 指南、`npm run docs:index` |

每项完成即 commit（代码 + 测试 + 文档）。

## 4. 测试要求

- DeepSeek 预设生成的 descriptor 正确；`deepseek-reasoner` 流式 `reasoning_content` 不污染输出文本；历史剥离生效
- 回退：mock 服务器第一个模型 503 → 第二个模型成功，事件 `llm.fallback` 发出
- `headers`、`extra_body`、`max_tokens_field` 生效（断言请求体）
- 路由：GET 不泄露 key；PUT 选择校验未知 ref → 400
- `npm run test:ci` 全绿

## 5. 待统筹决策

1. **server.js 触点超过「单行挂载」**（均为最小改动，均已提交）：
   - 挂载：`app.use(require('./routes/modelConfig').createModelConfigRouter({ llmManager, sessionStore, commitConfigChange }))`，位于 `const sessionStore = ...` 之后（必须早于 `/api/sessions/:id/settings` 路由，路由器内含该路径的前置校验中间件，随后 `next()` 交给原处理器）。
   - `ToolLoopRunner` 的 `getReasoner: (opts) => llmManager.getReasoner(opts)`（转发 `{sessionId, modelRef, onFallback}`）。
   - `buildRunContext` 返回值增加 `model_ref: existingSettings?.model_ref || null`（会话级覆盖）。
   WS3 合并时若冲突，请保留这三处。
2. 还触及了非自有路径（均为小改动）：`apps/runtime/loop/toolLoopRunner.js`（getReasoner 传参、`run({modelRef})`、发 `llm.fallback`）、`apps/runtime/rpc/runtimeRpcWorker.js`（`params.model_ref` → `runtimeContext.model_ref` 与 `runner.run({modelRef})`）、`apps/runtime/session/sessionPermissions.js`（会话设置支持 `model_ref`，仅设置时才出现该键）。WS1 若重写 runner/worker，请保留 `modelRef` 透传；pi 路径读取 `runtimeContext.model_ref` / `run({modelRef})`。
3. 契约补充（建议统筹者写入 C4）：路由额外提供 `PUT/DELETE /api/config/models/providers/:key`（配置页使用）；`GET /api/config/models` 的 `active`/`enabled` 为 ref 字符串，另含 `providers{}`；`/test`、`/discover` 返回 `{ok,latency_ms,status,error}` / `{ok,models[]}`（上游失败时 HTTP 200 且 `ok:false`）；Catalog 描述符 `name` 现为 `model.name || id`（不再回落到 provider display_name）；`ProviderConfigStore#loadNormalized()`、`normalizeProviderConfig`、`splitModelRef` 为新增导出。
4. 描述符 `timeout_ms` 默认仍为 20000（契约示例为 60000，各 provider/预设可覆盖；DeepSeek 模板设了 60000）。

## 6. 交付记录

### 交付记录（sonnet-ws2，2026-10-12）

**已完成（任务 1–7）与提交**

| 任务 | 提交 |
|---|---|
| 1 schema v2 校验 + v1 规范化 | cd863a1 |
| 2 预设 + 完整 Model Catalog | d977510 |
| 3 openaiReasoner 通用性、回退链、`model_ref`、`llm.fallback` | 5a5002a |
| 4 + 5 网关路由（C4.4）与会话级 `model_ref` | 57e8f87 |
| 6 配置页「models」标签页 + v2 `config/providers.yaml` 模板 | 4b4bb81 |
| 7 Provider 指南 v2 + `docs:index` | fc758fb |

文档：`docs/features/FEAT-llm-model-config-v2.md`、`docs/testing/TC-llm-model-config-v2.md`（TC-LLM-001…027）。`npm run test:ci`：536 通过（基线 509 + 27 新增）。

**未完成 / 限制**

- legacy 循环只能调用 `openai-completions`；`anthropic`/`google` 模型仅由 Catalog 描述，legacy 下会抛出明确错误，需由 pi（WS1）消费。
- `asr_*` 类型只做校验和 Catalog 暴露（`catalog.asr`），尚无 ASR 调用方（WS3 设备音频接入）。
- 回退仅在尚未向客户端流出文本时切换；已流出后失败直接报错。
- 配置页仅做了浏览器手工冒烟（TC-LLM-027），无自动化前端测试。
- `GET /api/config/providers/config`（v1 既有接口）仍会返回内联 api_key，不在本工作流范围，未改。

**风险**

- server.js / toolLoopRunner / runtimeRpcWorker 的小改动可能与 WS1/WS3 冲突（见上）。
- 校验现在拒绝引用不存在模型的 `enabled_models/roles/fallback_models/active_model`，手写 YAML 若引用失效会在保存/加载时报错。

**验证方式**

- `cd` 到 worktree 后 `npm run test:ci`（全绿）。
- 手工：用 `providers.yaml`（`preset: deepseek` + `DEEPSEEK_API_KEY`）启动网关，打开 `/config-v2.html` 的 models 页，勾选/切换并保存、点「测试连接」；`curl localhost:3000/api/config/models` 不含 api_key；`PUT /api/config/models/selection` 传未知 ref 返回 400。

