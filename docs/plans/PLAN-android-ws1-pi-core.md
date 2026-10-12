# WS1 施工文档：Agent 核心迁移到 pi

> 类型: plan
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: PLAN-android-companion.md, PLAN-android-companion-contracts.md §C4 §C5

## 1. 目标

用 `@earendil-works/pi-coding-agent`（v1.1.x，依赖 `pi-agent-core`、`pi-ai`）替换现有自研 `ToolLoopRunner`，由 pi 负责 agent 循环、上下文管理（含自动压缩）、技能、会话持久化；本项目的工具、事件总线、设备 RPC、音频能力全部以 pi 自定义工具的形式注册；现有 prompt 迁移到 pi。对外协议（`/ws` 的 `runtime.run`、bus 事件、`/api/sessions*`）保持不变，桌面端/网页端/手机端无需感知。

## 2. 负责路径

- 新增：`apps/runtime/agent-pi/**`、`test/runtime/agent-pi/**`
- 修改：`apps/gateway/server.js`（仅 agent 装配段：根据 `AGENT_CORE` 选择 pi / legacy）、`package.json`（依赖）
- 只读参考：`apps/runtime/loop/toolLoopRunner.js`、`apps/runtime/rpc/runtimeRpcWorker.js`、`apps/runtime/persona/**`、`apps/runtime/skills/**`、`apps/runtime/session/**`、`apps/runtime/executor/**`
- **不得修改**：`apps/runtime/config/**`（WS2）、`apps/gateway/deviceHub/**`（WS3）、`apps/desktop-live2d/**`、`apps/android/**`

## 3. 前置调研（第一步，产出文档）

阅读 `node_modules/@earendil-works/pi-coding-agent/docs/`（`sdk.md`、`sessions.md`、`compaction.md`、`skills.md`、`extensions.md`、`models.md`、`custom-provider.md`、`message-types.md`）与 `examples/sdk/*.ts`，产出 `docs/research/RESEARCH-pi-agent-integration.md`：

- SDK 关键 API（`createAgentSession`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`、自定义工具定义方式、事件类型）
- ESM-only 包在本项目 CommonJS 中的加载方式（建议 `await import()` 封装在异步工厂内）
- 自定义 OpenAI 兼容 provider（DeepSeek 等）如何注册到 pi（`models.json` 等价的编程式注册 / provider extension）
- 旧 `ToolLoopRunner` 事件 ↔ pi 事件映射表
- 风险与对策

## 4. 任务与提交点

每个任务完成即 commit（代码 + 测试 + 文档）。

| # | 任务 | 提交信息示例 |
|---|---|---|
| 1 | 调研文档 + 安装依赖（`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`，锁定精确版本） | `docs(pi): research pi agent integration` |
| 2 | `agent-pi/loadPi.js`：ESM 动态加载与缓存；`agent-pi/modelAdapter.js`：Model Catalog descriptor（契约 C4.2）→ pi 模型；支持 `fallbackChain()`、`model_ref` 覆盖、`reasoning` / `compat` / `headers` / `extra_body` | `feat(pi): map model catalog to pi models` |
| 3 | `agent-pi/toolBridge.js`：把 `ToolExecutor` 注册表全部工具包装为 pi 工具（JSON Schema 参数直通；执行经 `executor.execute()` 以保留权限中间件、会话权限级别、`publishEvent` 上下文、trace）；工具结果文本化；错误转为 pi 工具错误 | `feat(pi): bridge runtime tools into pi` |
| 4 | 设备与总线工具：`deviceHub.listToolMethods()` 动态注册、`tools.changed` 时刷新；`bus_publish`、`avatar_transfer`、`avatar_status` 工具（契约 C5） | `feat(pi): expose device hub and bus tools` |
| 5 | `agent-pi/promptBuilder.js`：迁移 persona（`PersonaContextBuilder`）、memory SOP、长期记忆 bootstrap、语音自动回复上下文、会话权限说明、技能提示 → pi system prompt / context；与旧核心逐段对比测试 | `feat(pi): migrate prompts to pi system prompt` |
| 6 | `agent-pi/sessionBridge.js`：`session_id` ↔ pi 会话文件（`~/yachiyo/data/pi-sessions/`）；继续写 `FileSessionStore` 以保持 `/api/sessions*` 与 UI 历史不变；压缩策略配置 | `feat(pi): persist sessions via pi session manager` |
| 7 | 技能：`skills/` 与运行时技能目录作为 pi 技能来源，遵循 `config/skills.yaml` 启用规则 | `feat(pi): load skills through pi resource loader` |
| 8 | `agent-pi/piRuntime.js`：`createPiRuntime(deps)` 提供与 `ToolLoopRunner` 相同的 `run()` 语义；事件映射到 bus（`runtime.start`、`message.delta`、`llm.stream.*`、`tool_call.*`、`runtime.final`、`runtime.error`），字段与旧实现一致；图片输入；音频输入（先走现有 `transcribeAudio` 再提示） | `feat(pi): pi runtime with legacy-compatible events` |
| 9 | 网关装配：`AGENT_CORE=pi|legacy`（默认 `pi`），legacy 路径保留可回滚；`test/integration/gateway.e2e.test.js` 在两种模式下都通过（用 mock LLM 服务器，pi 指向它） | `feat(gateway): switch agent core to pi with legacy fallback` |
| 10 | 功能文档 `docs/features/FEAT-runtime-pi-agent-core.md`、测试用例 `docs/testing/TC-runtime-pi-agent-core.md`、更新 `docs/architecture/ARCHITECTURE.md` 相关段落、`npm run docs:index` | `docs(pi): feature doc and test cases` |

## 5. 测试要求

- 全部离线、确定性：pi 必须指向本地 mock OpenAI 兼容服务器（参考现有 e2e 测试中的 mock LLM）。
- 新增至少：模型映射（含 DeepSeek reasoning / compat）、工具桥（权限拒绝路径）、设备工具动态刷新（用假 deviceHub）、事件映射（逐事件断言字段）、prompt 迁移（关键段落存在）、会话恢复（第二轮能看到第一轮上下文）、`AGENT_CORE=legacy` 回滚。
- `npm run test:ci` 全绿（基线 507）。
- 用例编号 `TC-PI-001…`。

## 6. 约束

- 不提交任何密钥；不得修改契约文件，需要变更写在本文档「待统筹决策」。
- pi 内置的 `read/bash/edit/write` 工具**默认禁用**（本项目已有带权限控制的 fs/shell 工具）。
- 代码风格：CommonJS、2 空格、单引号；ESM 依赖只通过 `loadPi.js` 引入。

## 7. 待统筹决策

- 范围说明：第 1、10 项明确列出的研究/功能/测试/架构文档、`docs/README.md` 索引及本文按任务要求维护；`package-lock.json` 未列入负责路径，本工作流只锁定 package.json 精确版本，合并时请统筹统一更新锁文件（安装使用 `--package-lock=false`）。
- 已分工（统筹 2026-10-12 补充 C5）：WS2 负责 RPC 透传与 settings 持久化；WS1 同时接受 model_ref/modelRef，并保留当前桩的装配兼容层。原问题：现有 `RuntimeRpcWorker` 不传递 `params.model_ref`，会话 settings 的规范化也不保留 `model_ref`。WS1 将在 agent 装配适配层转送每次请求覆盖；持久 settings 支持需要 WS2/统筹补齐，不修改只读 RPC/session 文件。
- 已解决（统筹 2026-10-12 补充 C5）：服务端使用 `requestAvatarTransfer(to, { reason })`；WS1 已按此装配。原问题：Hub 契约只规定设备 `invoke(device_id, method, ...)`，未规定服务端 Avatar transfer API。WS1 将支持显式注入 avatar 控制器；请统筹与 WS3 确认生产装配接口，禁止将未定义的 gateway device_id 当成契约。

- **统筹答复（2026-10-12）**：①锁文件由统筹合并时统一生成，同意。②`model_ref` 透传与 settings 持久化归 WS2，WS1 读取 `params.model_ref`（优先）与会话 settings 的 `model_ref` 即可。③Avatar 服务端 API 已写入契约 C5「Device Hub 服务端 API」：使用 `getDeviceHub().requestAvatarTransfer(to)`、`getAvatarHost()`、`listDevices()`、`invoke('avatar-host', ...)`，空实现已在 `apps/gateway/deviceHub/index.js` 提供；不需要另行注入 avatar 控制器（可保留注入点用于测试）。

## 进度记录

- 开始前完整阅读四份约束文档；Node v24.10.0，分支 `agent/ws1-pi-core`，工作区干净。
- 基线 `npm run test:ci`：509 / 509 通过；测试临时目录和 YACHIYO_HOME 隔离在本 worktree 的 node_modules 下。

## 8. 交付记录

（完成后追加：完成项、提交哈希、未完成项、风险）

### 任务 1

研究文档、1.1.0 精确依赖与版本验证用例完成；`npm run test:ci` 510 / 510 通过。

### 任务 2

loadPi 缓存加载、Model Catalog 映射与隔离 provider 注册完成；模型选择、DeepSeek compat/request body 测试通过。`npm run test:ci` 513 / 513 通过。

### 任务 3

全注册表工具桥、权限/参数失败与截图附件完成；`npm run test:ci` 518 / 518 通过（含下一任务准备的两个设备用例）。

### 任务 4

设备快照动态刷新、总线前缀与 policy 检查、可注入 Avatar 控制器完成；`npm run test:ci` 518 / 518 通过。生产 Avatar transfer 装配仍等待统筹确认 WS3 服务端入口。

### 任务 5

提示词迁移完成，与真实旧 ToolLoopRunner 生成的 system 段落逐段比对；`npm run test:ci` 520 / 520 通过。

### 任务 6

SessionManager 持久化、稳定安全路径、旧历史单次导入、同会话串行、UI 镜像开关及压缩配置完成；`npm run test:ci` 522 / 522 通过。

### 任务 7

pi resource loader、skills.yaml 过滤、目录优先级和重新加载完成；`npm run test:ci` 523 / 523 通过。

### 任务 8

实际 pi AgentSession 循环、旧事件映射、图片/音频、恢复、无副作用回退与步数上限完成；`npm run test:ci` 529 / 529 通过。本地 SSE mock 验证真实 provider 请求。为兼容旧端点，纯文本 content 数组归一化为字符串，关闭 pi 图片自动缩放，保留网关已校验的原始图片。

### 任务 9

默认 pi / legacy 回滚装配完成；旧 gateway.e2e 五用例分别在两种核心下完整通过；全量 `npm run test:ci` 533 / 533 通过。统筹补充契约后已接入 requestAvatarTransfer，接受新 worker 的 model_ref；未修改或暂存统筹带入的契约 diff。
