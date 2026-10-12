# Gateway 配置 WebUI 重构交接

> 类型: plan
> 状态: draft
> 负责人: config_ui_rebuild agent
> 更新: 2026-10-13
> 关联: `apps/gateway/public/config-v2.html`、`apps/gateway/public/config-v2.js`、`apps/gateway/public/config-v2-models.js`、`apps/gateway/routes/modelConfig.js`、`docs/features/FEAT-llm-model-config-v2.md`、`docs/plans/PLAN-voice-realtime-tts-routing.md`

## 停止点

2026-10-13 收到统筹者停止指令后，仅保存本交接文档，不再修改产品代码。页面重构尚未开始写入，仓库中的现有配置页仍保持原状。

| 项目 | 当前值 |
|---|---|
| worktree | `/Volumes/data/Users/Programming/yachiyo-wt/config-ui-rebuild` |
| branch | `agent/config-ui-rebuild` |
| 起点 | `d2d606bd3c5c0adb4349dc61225ecbc5b9b6049c` |
| dirty paths（写本文前） | 无 |
| 已修改产品代码 | 无 |
| 真机 / 用户服务 | 未使用、未启动、未修改 |
| 测试 | 未运行；没有产品代码变更可验证 |

相关并行 worktree 的只读观察：

- UI 审查：`/Volumes/data/Users/Programming/yachiyo-wt/ui-review`，branch `agent/ui-review`，观察时 HEAD `5969e933d6301823275c3f84f9b1e9a8b8c8b875`，无 dirty path。
- Desktop UI：`/Volumes/data/Users/Programming/yachiyo-wt/ui-refresh`，branch `agent/ui-transfer-controls`，观察时 HEAD `3bd034404c89bbe575df6cfdda7d6f29102d510a`；该 worktree 有 Android avatar owner 相关未提交改动，与本工作流无关，不得触碰。

## 已完成的只读盘点

### 现有入口与用户体验

- `/config-v2.html` 默认显示模型配置，但仍在 header 链接 `/config.html` 的旧 Provider 表单，形成两套可写入口。
- `config-v2` 的模型页已调用真实 API，支持模型选择、用途路由、回退链、provider 增删、连接测试和模型发现；provider 表单只覆盖 chat 类型。
- TTS 与 ASR 没有结构化页面，只能通过 `providers.yaml` 原始编辑器修改。
- tools、skills、persona、voice policy、desktop-live2d、Git 历史和配置 Agent 同时占据主要界面，常用设置与高级维护混杂。
- 视觉仍是通用后台样式，没有复用 Android 夜景玻璃 tokens。可复用来源为 `apps/android/app/src/main/assets/web/css/settings.css` 与 `app.css`：深蓝 `#090b20`、玻璃面 `rgba(23,23,50,.76)`、薰衣草 `#b6a1ff`、金色 `#efd09d`。

### 已批准的信息架构

主导航分为四页：

1. **概览**：当前模型、TTS、ASR、本机管理边界和常用任务。
2. **模型与路由**：服务商、通用 API endpoint、write-only key、模型发现、连接测试、启用模型、默认模型、roles 与 fallback。
3. **语音**：TTS 与 ASR 分区，直接编辑实际 provider 字段；展示当前 desktop voice path/transport，但不把尚未统一实现的 realtime/auto 宣称为可用功能。
4. **高级配置**：tools、skills、persona、voice-policy、desktop-live2d；Git 历史与配置 Agent 默认折叠。

`providers.yaml` 不应继续出现在通用 raw 编辑器。模型和语音应使用结构化 API；`/config.html` 应迁移到 `/config-v2.html`，不能继续保留另一套过时表单。

## 真实配置流

### Chat 模型

`GET /api/config/models` 来自 `ProviderConfigStore` + `modelCatalog`。运行时真实字段是：

- `active_model`
- `enabled_models`
- `roles`
- `fallback_models`
- `providers.<key>.type/base_url/models/...`

`PUT /api/config/models/selection` 写回上述路由字段。`POST /api/config/models/test` 会对 chat completions / Anthropic messages / Gemini generateContent 发最小真实请求；`POST /api/config/models/discover` 会请求 provider 模型目录。自动化测试必须用 mock fetch，禁止使用用户真实凭据。

DeepSeek、Qwen、OpenRouter 等 OpenAI-compatible 服务应通过 preset + 通用 endpoint 表达，不能硬编码成专用 provider 类型。ChatGPT OAuth 可预留只读状态卡，但不得依赖尚未合并的 OAuth 后端，也不得读取 Codex token。

### TTS

真实 provider 由 `TTS_PROVIDER_KEY || 'qwen3_tts'` 选择，`type: tts_dashscope`，运行字段是：

- `tts_model`
- `tts_voice`
- `tts_realtime_model`
- `tts_realtime_voice`
- `base_url`
- `api_key` 或 `api_key_env`

desktop 的执行路径另由 `desktop-live2d.json` 中 `voice.path` 与 `voice.transport` 决定。当前 desktop native 有 nonstream 与 realtime 客户端，Android relay 仍是 nonstream；新的统一 realtime TTS 路由尚未完成。因此 UI 可以准确展示当前 desktop 状态及 realtime 预备字段，但 realtime/auto 选择必须 disabled 并解释限制，不能制造一个运行时不消费的 UI-only mode。

阿里云官方资料核实结果：

- `qwen3-tts-flash` 是 HTTP 非实时模型，`Cherry` 是受支持系统音色。
- `qwen3-tts-instruct-flash` 是 HTTP 指令控制模型；仓库历史上曾遇到 404，不能把它设为未经验证的默认值。
- `qwen3-tts-flash-realtime` 与 `qwen3-tts-instruct-flash-realtime` 走 WebSocket。
- `qwen3-tts-vc-2026-01-22` 是 HTTP 声音复刻型号，`qwen3-tts-vc-realtime-2026-01-15` 是对应 realtime 型号。

参考：

- <https://help.aliyun.com/zh/model-studio/tts-model/>
- <https://help.aliyun.com/en/model-studio/qwen-tts-voice-list>
- <https://help.aliyun.com/en/model-studio/non-realtime-tts-user-guide>
- <https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis>

当前确认可用的普通配置是 `qwen3-tts-flash` + `Cherry`。不要把 Aliyun Token 或 Coding Plan 凭据用于 custom backend。

### ASR

`modelCatalog` 与 `apps/gateway/deviceHub/asrService.js` 选择首个 `asr_openai_compatible` 或 `asr_dashscope` provider；ASR 模型读取 `model || asr_model`。结构化 UI 应写 `model`，读取时兼容旧 `asr_model`。

## 必须先完成的后端安全依赖

UI 审查 agent 已确认后续后端合同，继续开发前应从其最终安全 HEAD 开始或 cherry-pick 对应提交，避免重复修改：

1. 整个 `/api/config/**` 必须按 `req.socket.remoteAddress` 做 loopback-only 管理门禁。不得信任 `X-Forwarded-For`；pairing token 也不能放行。
2. Android appassets CORS 仅保留 `/api/device/**`，移除 `/api/config/models*`。Android 即使携带有效 pairing token，访问配置仍必须是 403 且不返回配置 CORS 头。
3. `GET /api/config/models` 的 public provider snapshot 只返回：`key,type,preset,display_name,base_url,api_key_env,has_api_key,requires_api_key,timeout_ms,models`；chat 可返回确认安全的 `compat`。不得返回 `headers` 或 `extra_body` 的值，只能返回 `has_custom_headers` / `has_extra_body`。
4. TTS snapshot 增加四个真实字段；ASR 统一输出 `model`。
5. Provider PUT 改为 patch：未出现字段全部保留；空 `api_key` 保留旧值；只有 `clear_api_key: true` 才清除。普通结构化保存不得抹掉隐藏的 `headers`、`extra_body`、`compat` 或 secret。
6. 所有 response 与错误必须脱敏。任何 key、Authorization header、token 或 `extra_body` 中的秘密都不得回显。

当前 `modelConfig.js` 的 snapshot 只去除了顶层 `api_key`，仍返回 `headers` 与 `extra_body`；这是阻断项，不能在其上直接发布新 UI。

## 后续实施切分

建议恢复后按可独立审查的提交推进：

1. `fix(gateway): restrict config APIs and redact provider snapshots`：安全门禁、safe schema、patch 语义与回归测试。
2. `feat(gateway): rebuild model settings UI`：夜景 shell、概览、模型 provider/route、真实 discover/test、旧入口迁移、FEAT/TC。
3. `feat(voice): add structured TTS and ASR settings`：真实字段、运行状态、限制提示、FEAT/TC。
4. `test(gateway): verify config UI flows`：隔离 gateway fixture + browser/mock API 截图与关键流程。

每个提交都需同步功能文档、`TC-*` 和本交接文档的交付记录。完成前运行隔离后的 `npm run test:ci`，例如设置独立临时 `HOME`、`TMPDIR`、provider/config 路径；不需要 Android build。

## 交付记录

### 2026-10-13 停止 checkpoint

- 完成：仓库规则、C4 契约、模型 route、provider store/presets、TTS/ASR 执行链、现有页面与安全边界的只读盘点；信息架构经统筹者批准；与 UI 审查 agent 对齐 safe snapshot/patch 合同。
- 产品代码：未修改。
- 测试：未运行。
- 未完成：所有 UI、后端安全、自动化、截图与功能/测试文档实现。
- 风险：必须先合入后端 loopback 与脱敏修复，再开放新的结构化配置 UI。
