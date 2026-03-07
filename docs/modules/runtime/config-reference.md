# Runtime Config Reference

本文档覆盖当前代码里最核心的运行时配置文件，并标注每个参数的真实生效文件、相关函数和所在链路。

当前覆盖范围：

- `desktop-live2d.json`
- `voice-policy.yaml`
- `providers.yaml`
- `tools.yaml`

## 1. 配置文件总表

| 文件 | 默认路径 | 可覆盖方式 | 主要消费模块 | 备注 |
| --- | --- | --- | --- | --- |
| `desktop-live2d.json` | `~/yachiyo/config/desktop-live2d.json` | `DESKTOP_LIVE2D_CONFIG_PATH` | `apps/desktop-live2d/*`, `apps/runtime/tooling/adapters/voice.js` | 详细参数表见 [desktop-live2d-config-reference.md](/Users/okonfu/.openclaw/workspace/open-yachiyo/docs/modules/desktop-live2d/desktop-live2d-config-reference.md) |
| `providers.yaml` | `~/yachiyo/config/providers.yaml` | `PROVIDER_CONFIG_PATH` | `apps/runtime/config/*`, `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/voice/*` | LLM 与 TTS 共用，但控制面不同 |
| `tools.yaml` | `config/tools.yaml` | 仅构造 `ToolConfigStore({ configPath })` 时显式覆盖 | `apps/runtime/tooling/*`, `apps/runtime/executor/*`, `apps/runtime/loop/toolLoopRunner.js` | 默认不是 runtime configDir，而是仓库内配置 |
| `voice-policy.yaml` | `config/voice-policy.yaml` | `VOICE_POLICY_PATH` | `apps/gateway/server.js`, `apps/runtime/tooling/voice/policy.js`, `apps/runtime/tooling/adapters/voice.js` | 会被 session 级 `/voice on|off` 覆盖 |

补充事实：

- 这四份配置的默认路径并不统一。
- `providers.yaml` 与 `desktop-live2d.json` 默认走 runtime home 下的 `~/yachiyo/config/`。
- `tools.yaml` 和 `voice-policy.yaml` 当前默认仍走仓库内 `config/`。

## 2. 管理接口与写盘链

### 2.1 Gateway 管理入口

| 文件 | 读取接口 | 写入接口 | 实际写盘链 |
| --- | --- | --- | --- |
| `providers.yaml` | `/api/config/providers/config`, `/api/config/providers/raw` | `/api/config/providers/config`, `/api/config/providers/raw` | `server.js -> LlmProviderManager -> ProviderConfigStore` |
| `tools.yaml` | `/api/config/tools/config`, `/api/config/tools/raw` | `/api/config/tools/raw` | `server.js -> ToolConfigStore.saveRawYaml()` |
| `voice-policy.yaml` | `/api/config/voice-policy/raw` | `/api/config/voice-policy/raw` | `server.js -> fs.writeFileSync(voicePolicyPath)` |
| `desktop-live2d.json` | `/api/config/desktop-live2d/raw` | 无统一 raw PUT；主要靠 desktop main 调参链回写 | `desktopSuite.js -> persist*Overrides() -> config.js` |

### 2.2 路径一致性说明

这里有两个当前代码中的事实，文档必须明确：

- `providers.yaml` 的 Gateway 读写路径和默认运行时路径一致，都是 `~/yachiyo/config/providers.yaml`
- `tools.yaml` 与 `voice-policy.yaml` 的 Gateway 编辑接口默认写的是仓库内 `config/` 文件
- 但 `server.js` 里的 config git 仓库固定在 `getRuntimePaths().configDir`，因此它和 `tools.yaml` / `voice-policy.yaml` 的默认加载路径不是同一个目录

这意味着：

- `providers.yaml` 的 raw/config 编辑和运行时读取默认是一致的
- `tools.yaml` / `voice-policy.yaml` 的 raw 编辑链与 config git 快照链默认不一致

## 3. `desktop-live2d.json`

这部分已经单独展开，直接看：

- [desktop-live2d-config-reference.md](/Users/okonfu/.openclaw/workspace/open-yachiyo/docs/modules/desktop-live2d/desktop-live2d-config-reference.md)

这里只补两条跨模块事实：

- `voice.path` 不只影响 desktop-live2d，也会被 `apps/runtime/tooling/adapters/voice.js` 读取，用来决定发 `voice.requested` 还是 `voice.playback.electron`
- `desktop-live2d.json` 的默认路径与 `providers.yaml` 一样，都在 `~/yachiyo/config/`

## 4. `voice-policy.yaml`

### 4.1 加载链

1. `apps/gateway/server.js`
   - `voicePolicyPath`
   - `buildRunContext()`
2. `apps/runtime/tooling/voice/policy.js`
   - `loadVoicePolicy()`
   - `evaluateVoicePolicy()`
3. `apps/runtime/tooling/adapters/voice.js`
   - `ttsAliyunVc()`
   - `enforceRateLimit()`

### 4.2 会话优先级链

真实生效顺序：

1. session `voice_auto_reply_mode = force_on`
2. session `voice_auto_reply_mode = force_off`
3. `voice-policy.yaml -> voice_policy.auto_reply.enabled`

对应代码：

- `apps/gateway/server.js`
  - `parseVoiceAutoReplySlashCommand()`
  - `handleSlashCommand()`
  - `buildRunContext()`
- `apps/runtime/session/sessionPermissions.js`
  - `normalizeVoiceAutoReplyMode()`

### 4.3 参数表

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `voice_policy.auto_reply.enabled` | `apps/gateway/server.js`, `apps/runtime/tooling/voice/policy.js` | `loadVoicePolicy()`, `buildRunContext()` | session voice auto-reply 开关链 | 只在 session mode 为 `policy` 时生效 |
| `voice_policy.limits.max_chars` | `apps/runtime/tooling/voice/policy.js` | `loadVoicePolicy()`, `evaluateVoicePolicy()` | TTS 文本策略链 | 超过阈值直接拒绝 TTS |
| `voice_policy.limits.max_duration_sec` | `apps/runtime/tooling/voice/policy.js` | `loadVoicePolicy()` | 当前无主链消费 | 目前会被解析，但未发现后续使用点 |
| `voice_policy.limits.cooldown_sec_per_session` | `apps/runtime/tooling/voice/policy.js`, `apps/runtime/tooling/adapters/voice.js` | `loadVoicePolicy()`, `enforceRateLimit()` | session 频控链 | 限制同一 session 的最小 TTS 间隔 |
| `voice_policy.limits.max_tts_calls_per_minute` | `apps/runtime/tooling/voice/policy.js`, `apps/runtime/tooling/adapters/voice.js` | `loadVoicePolicy()`, `enforceRateLimit()` | session 频控链 | 限制最近一分钟内的 TTS 次数 |

### 4.4 已写入 YAML 但当前未接线的字段

当前样例文件中有这些段：

- `voice_policy.must_speak_if`
- `voice_policy.may_speak_if`
- `voice_policy.must_not_speak_if`

但现状是：

- `loadVoicePolicy()` 不会把它们读进返回值
- `evaluateVoicePolicy()` 也不会解析表达式字符串
- 当前实际逻辑是写死在 `evaluateVoicePolicy()` 里的：
  - `inputType === 'audio' && sentenceCount <= 4` 视为 `mustSpeak`
  - `sentenceCount <= 4` 视为 `maySpeak`
  - `containsCode / containsTable / containsManyLinks / isTroubleshooting` 直接拒绝

结论：

- 这几个表达式列表现在只是 YAML 样例，不是运行时可配置规则

## 5. `providers.yaml`

### 5.1 加载链

#### LLM 链

1. `apps/runtime/config/providerConfigStore.js`
   - `ProviderConfigStore.load()`
2. `apps/runtime/config/llmProviderManager.js`
   - `getActiveProviderSnapshot()`
   - `getReasoner()`
3. `apps/runtime/loop/toolLoopRunner.js`
   - 通过构造参数 `getReasoner` 间接拿到当前 provider
4. `apps/runtime/llm/openaiReasoner.js`
   - 用 `baseUrl/model/apiKey/timeout/retry` 发起模型请求

#### TTS 非流式链

1. `apps/runtime/tooling/adapters/voice.js`
   - `loadTtsProviderConfig()`
   - `callDashscopeTts()`
2. `apps/desktop-live2d/main/voice/qwenTtsClient.js`
   - `loadProviderConfig()`
   - `synthesizeNonStreaming()`

#### TTS Realtime 链

1. `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js`
   - `loadProviderConfig()`
   - `streamSynthesis()`

### 5.2 根参数

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `active_provider` | `apps/runtime/config/providerConfigStore.js`, `apps/runtime/config/llmProviderManager.js` | `validateConfig()`, `getActiveProviderSnapshot()`, `getReasoner()` | LLM provider 选择链 | 只控制 LLM 活跃 provider，不控制 TTS provider |
| `providers` | `apps/runtime/config/providerConfigStore.js` | `validateConfig()` | provider 注册表链 | provider 名到配置对象的总映射 |

关键事实：

- TTS 链默认不会读取 `active_provider`
- TTS 固定读取 `qwen3_tts`，或由环境变量 `TTS_PROVIDER_KEY` 覆盖

### 5.3 `providers.<name>.*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `providers.<name>.type` | `apps/runtime/config/providerConfigStore.js`, `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/voice/qwenTtsClient.js`, `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `validateConfig()`, `loadTtsProviderConfig()`, `loadProviderConfig()` | provider 分流链 | 当前支持 `openai_compatible` 和 `tts_dashscope` |
| `providers.<name>.display_name` | `apps/gateway/public/config.js` | `cloneProvider()`, `renderActiveProviderSelect()` | Gateway provider UI 展示链 | 仅用于配置页展示，不进入实际请求参数 |
| `providers.<name>.base_url` | `apps/runtime/config/llmProviderManager.js`, `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/voice/qwenTtsClient.js`, `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `getReasoner()`, `callDashscopeTts()`, `loadProviderConfig()`, `deriveRealtimeWsBaseUrl()` | LLM / TTS 连接链 | LLM 走 HTTP；Realtime TTS 还会据此推导 websocket 地址 |
| `providers.<name>.model` | `apps/runtime/config/providerConfigStore.js`, `apps/runtime/config/llmProviderManager.js` | `validateConfig()`, `getReasoner()` | LLM 请求链 | 仅 `openai_compatible` provider 使用 |
| `providers.<name>.api_key` | `apps/runtime/config/llmProviderManager.js`, `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/voice/qwenTtsClient.js`, `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `getReasoner()`, `callDashscopeTts()`, `resolveApiKey()` | LLM / TTS 认证链 | inline key，优先于 env key |
| `providers.<name>.api_key_env` | `apps/runtime/config/providerConfigStore.js`, `apps/runtime/config/llmProviderManager.js`, `apps/desktop-live2d/main/voice/qwenTtsClient.js`, `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `validateConfig()`, `getReasoner()`, `resolveApiKey()` | LLM / TTS 认证链 | 环境变量名；inline key 不存在时才读取 |
| `providers.<name>.timeout_ms` | `apps/runtime/config/llmProviderManager.js` | `getReasoner()` | LLM 请求超时链 | 当前只在 LLM 链直接消费 |
| `providers.<name>.max_retries` | `apps/runtime/config/llmProviderManager.js` | `getReasoner()` | LLM 重试链 | 未在 `validateConfig()` 中强校验，但 `getReasoner()` 会读取 |
| `providers.<name>.retry_delay_ms` | `apps/runtime/config/llmProviderManager.js` | `getReasoner()` | LLM 重试链 | 未在 `validateConfig()` 中强校验，但 `getReasoner()` 会读取 |
| `providers.<name>.tts_model` | `apps/runtime/config/providerConfigStore.js`, `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/voice/qwenTtsClient.js` | `validateConfig()`, `callDashscopeTts()`, `loadProviderConfig()` | 非流式 TTS 模型链 | `tts_dashscope` 必填 |
| `providers.<name>.tts_voice` | `apps/runtime/config/providerConfigStore.js`, `apps/runtime/tooling/adapters/voice.js`, `apps/desktop-live2d/main/voice/qwenTtsClient.js`, `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `validateConfig()`, `callDashscopeTts()`, `loadProviderConfig()` | 非流式 / realtime TTS 默认声线链 | `tts_dashscope` 必填；realtime 也会回退到它 |
| `providers.<name>.tts_realtime_model` | `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `loadProviderConfig()` | Realtime TTS 模型链 | realtime 模型主字段 |
| `providers.<name>.tts_realtime_voice` | `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `loadProviderConfig()` | Realtime TTS 声线链 | realtime 声线主字段 |
| `providers.<name>.realtime_model` | `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `loadProviderConfig()` | Realtime TTS 兼容别名链 | `tts_realtime_model` 的兼容别名 |
| `providers.<name>.realtime_voice` | `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `loadProviderConfig()` | Realtime TTS 兼容别名链 | `tts_realtime_voice` 的兼容别名 |
| `providers.<name>.realtime_ws_url` | `apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js` | `loadProviderConfig()`, `buildRealtimeWsUrl()` | Realtime TTS websocket 链 | 不填时会从 `base_url` 或 `DASHSCOPE_REALTIME_WS_URL` 推导 |

### 5.4 当前行为限制

有两个事实需要特别写出来：

- Gateway 图形化 provider 配置页 `apps/gateway/public/config.js` 目前只建模了 `openai_compatible` 风格字段
- `tts_model`、`tts_voice`、`tts_realtime_model`、`tts_realtime_voice`、`realtime_ws_url` 这类 TTS 专用字段不会被这个图形页完整建模

因此：

- 想改 TTS provider，更可靠的入口是 `/api/config/providers/raw`

## 6. `tools.yaml`

### 6.1 加载链

1. `apps/runtime/tooling/toolConfigStore.js`
   - `load()`
   - `validateToolsConfig()`
2. `apps/runtime/config/toolConfigManager.js`
   - `buildRegistry()`
3. `apps/runtime/tooling/toolRegistry.js`
   - `new ToolRegistry({ config })`
4. `apps/runtime/executor/toolExecutor.js`
   - `new ToolExecutor(registry, { policy, exec })`
5. `apps/runtime/tooling/middlewares/*`
   - `resolveTool`
   - `validateSchema`
   - `enforcePolicy`
6. `apps/runtime/loop/toolLoopRunner.js`
   - `listTools()`
   - 并行/串行调度时读取 `side_effect_level` 与 `requires_lock`
7. `apps/runtime/llm/openaiReasoner.js`
   - 把 `description` 与 `input_schema` 暴露给模型的工具 schema

### 6.2 根参数

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `version` | 未发现运行时消费点 | 无 | 当前未接线 | 样例文件有该字段，但 `validateToolsConfig()` 不校验它 |
| `policy.allow` | `apps/runtime/tooling/middlewares/enforcePolicy.js` | `mergePolicy()`, `enforcePolicy()` | tool allowlist 链 | 非空时形成 allowlist |
| `policy.deny` | `apps/runtime/tooling/middlewares/enforcePolicy.js` | `mergePolicy()`, `enforcePolicy()` | tool denylist 链 | deny 优先于 allow |
| `policy.byProvider` | `apps/runtime/tooling/middlewares/enforcePolicy.js` | `mergePolicy()` | provider 级策略覆盖链 | 依赖 `ctx.meta.provider`；当前标准 gateway/runtime 主链未见稳定生产者 |
| `exec.security` | `apps/runtime/executor/toolExecutor.js`, `apps/runtime/tooling/adapters/shell.js` | `execute()`, `runExec()` | shell 安全模式链 | 当前主要使用 `allowlist` |
| `exec.safeBins` | `apps/runtime/executor/toolExecutor.js`, `apps/runtime/tooling/adapters/shell.js` | `execute()`, `runExec()` | shell allowlist 链 | 仅在未提供 `permission_level` 的上下文里作为 bin allowlist 生效 |
| `exec.timeoutSec` | `apps/runtime/executor/toolExecutor.js`, `apps/runtime/tooling/adapters/shell.js` | `execute()`, `runExec()`, `runProcess()` | shell 超时链 | shell 工具默认超时 |
| `exec.maxOutputChars` | `apps/runtime/executor/toolExecutor.js`, `apps/runtime/tooling/adapters/shell.js` | `execute()`, `runProcess()` | shell 输出截断链 | stdout/stderr 合并后截断 |
| `exec.workspaceOnly` | `apps/runtime/executor/toolExecutor.js` | `execute()` | 当前无下游消费 | 会透传到 adapter context，但当前 shell adapter 未读取 |
| `tools` | `apps/runtime/tooling/toolConfigStore.js`, `apps/runtime/tooling/toolRegistry.js` | `validateToolsConfig()`, `ToolRegistry` 构造函数 | 工具注册表链 | 工具定义数组 |

### 6.3 `tools[].*`

| 参数 | 生效文件 | 相关函数 | 所在线路 | 说明 |
| --- | --- | --- | --- | --- |
| `tools[].name` | `apps/runtime/tooling/toolConfigStore.js`, `apps/runtime/tooling/toolRegistry.js`, `apps/runtime/tooling/middlewares/enforcePolicy.js` | `validateToolsConfig()`, `get()`, `enforcePolicy()` | 工具寻址链 | 工具唯一键，policy 也按它匹配 |
| `tools[].type` | `apps/runtime/tooling/toolRegistry.js`, `apps/runtime/executor/toolExecutor.js` | `list()` | 工具暴露链 | 当前主要用于列表/展示，实际执行仍由 `adapter` 决定 |
| `tools[].adapter` | `apps/runtime/tooling/toolConfigStore.js`, `apps/runtime/tooling/toolRegistry.js` | `validateToolsConfig()`, `ToolRegistry` 构造函数 | adapter 绑定链 | 必须能在 `ADAPTERS` 映射里找到实现 |
| `tools[].description` | `apps/runtime/tooling/toolRegistry.js`, `apps/runtime/llm/openaiReasoner.js` | `list()`, OpenAI tool schema 组装 | LLM 工具提示链 | 暴露给模型作为工具描述 |
| `tools[].side_effect_level` | `apps/runtime/tooling/toolRegistry.js`, `apps/runtime/executor/toolExecutor.js`, `apps/runtime/loop/toolLoopRunner.js` | `list()`, `execute()`, 调度并行判断 | tool 并行调度链 | `none/read/write`；当前并行化只放行 `none` |
| `tools[].requires_lock` | `apps/runtime/tooling/toolRegistry.js`, `apps/runtime/executor/toolExecutor.js`, `apps/runtime/loop/toolLoopRunner.js` | `list()`, `execute()`, 调度并行判断 | tool 并行调度链 | `true` 时当前不会进入并行 chunk |
| `tools[].input_schema` | `apps/runtime/tooling/toolConfigStore.js`, `apps/runtime/tooling/middlewares/validateSchema.js`, `apps/runtime/llm/openaiReasoner.js` | `validateToolsConfig()`, `validateSchema()`, OpenAI tool schema 组装 | schema 校验链 / LLM tool contract 链 | 既约束运行时入参，也暴露给模型 |

### 6.4 `policy.byProvider` 现状

中间件实现支持这两种 key：

- 精确 key：`byProvider[provider]`
- 通配 key：`byProvider["prefix/*"]`

对应代码：

- `apps/runtime/tooling/middlewares/enforcePolicy.js`
  - `mergePolicy()`

但当前主链路现状是：

- `ToolCallDispatcher` 会把 `payload.meta` 合并进执行上下文
- `enforcePolicy()` 读取 `ctx.meta.provider`
- 但当前标准 gateway/runtime 调用路径没有看到稳定写入 `meta.provider` 的生产者

结论：

- `policy.byProvider` 在中间件层已实现
- 但在当前主路径里应视为“预留能力”，不要假设已经稳定生效

### 6.5 `exec.*` 与 session permission 的关系

实际优先级如下：

1. 如果执行上下文里带 `permission_level`
   - `shell.exec` 先走 `sessionPermissionPolicy.getShellPermissionProfile()`
   - 并额外做路径边界检查
2. 如果没有 `permission_level`
   - 才退回 `tools.yaml -> exec.security + exec.safeBins`

对应代码：

- `apps/runtime/tooling/adapters/shell.js`
  - `runExec()`
  - `enforcePermissionPathPolicy()`
- `apps/runtime/security/sessionPermissionPolicy.js`
  - `getShellPermissionProfile()`

## 7. 建议阅读顺序

1. 先看本页第 1 节，确认每份配置的默认路径是不是同一个目录
2. 改 UI/桌宠相关参数时，看 [desktop-live2d-config-reference.md](/Users/okonfu/.openclaw/workspace/open-yachiyo/docs/modules/desktop-live2d/desktop-live2d-config-reference.md)
3. 改 TTS/LLM 接入时，看本页第 4、5 节
4. 改工具开关和 shell 安全策略时，看本页第 6 节
