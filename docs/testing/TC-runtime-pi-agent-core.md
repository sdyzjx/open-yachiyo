# pi Agent 核心测试用例

> 类型: testcase
> 状态: active
> 负责人: Codex (gpt-6-astra)
> 更新: 2026-10-13
> 关联: ../features/FEAT-runtime-pi-agent-core.md, ../../test/runtime/agent-pi/

所有用例离线执行，mock 服务仅监听 127.0.0.1；运行 `npm run test:ci`。

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-PI-001 | pi 精确版本 | unit | 安装依赖 | 比对 package.json 与安装包元数据 | 三个包均为 1.1.0 ESM | dependencies.test.js: TC-PI-001 pi dependency versions are exact and installed |
| TC-PI-002 | DeepSeek 字段与请求映射 | unit | 假 descriptor | 映射并构建请求 | reasoning/compat/headers/body 正确，历史不变 | modelAdapter.test.js: TC-PI-002 maps reasoning, compat, headers and request body without mutating history |
| TC-PI-003 | ESM 缓存与 provider 注册 | integration | 实际 SDK、内存凭证 | 并发加载并注册 | 一次加载，密钥作为字面量处理 | modelAdapter.test.js: TC-PI-003 loads ESM once and registers isolated catalog with literal credentials |
| TC-PI-004 | 模型覆盖与回退 | unit | 双模型目录 | 覆盖、去重、非法引用与错误分类 | 无静默错误模型回退，401 不重试 | modelAdapter.test.js: TC-PI-004 model override and fallback selection reject invalid models and auth errors |
| TC-PI-005 | 工具上下文与 schema | unit | 真 ToolExecutor | 执行 echo 和非法参数 | 上下文传递正确、非法参数拒绝 | toolBridge.test.js: TC-PI-005 bridge preserves schema, permission, trace, workspace and publishEvent |
| TC-PI-006 | 权限拒绝与取消 | unit | low 会话 | 调 memory_write、取消后执行 | 不执行工具，pi 收到异常 | toolBridge.test.js: TC-PI-006 permission rejection becomes a pi tool error without executing |
| TC-PI-007 | 截图附件 | unit | 临时离线图像 | 调 capture bridge | 返回 text + image | toolBridge.test.js: TC-PI-007 desktop capture result includes an actual image block |
| TC-PI-008 | 设备工具动态刷新与授权 | unit | 假 EventEmitter Hub | 配置 allow/deny，注册后变更、取下一快照 | 默认不暴露，deny 优先；获准工具刷新且旧快照路由稳定 | deviceTools.test.js: TC-PI-008 device tools refresh next snapshot and preserve in-flight definitions / dynamic Hub tools require explicit patterns and keep deny precedence |
| TC-PI-009 | 总线与 Avatar 权限 | unit | 假 Hub/controller | 发布合法/非法主题、移交、deny | 非法发布拒绝，移交参数保留 | deviceTools.test.js: TC-PI-009 bus namespace, schema, policy and avatar routing are enforced |
| TC-PI-010 | Prompt 与旧核心逐段比对 | integration | 离线假 reasoner | 捕获旧循环 system messages，对比新 builder | 除旧的模型自审批指令外每个原有段落存在；Pi 明确交由策略层审批 | promptBuilder.test.js: TC-PI-010 prompt migration preserves each legacy system paragraph |
| TC-PI-011 | 低权限和语音关闭 | unit | low、voice off | 构造 prompt | 不含 memory seed 与语音强制规则 | promptBuilder.test.js: TC-PI-011 low permission omits memory seeds and voice force-off instructions |
| TC-PI-012 | pi JSONL 恢复与路径隔离 | integration | 临时目录、实际 SessionManager | 写入并重建 bridge | 第一轮上下文可恢复，seed 不重复，路径安全 | sessionBridge.test.js: TC-PI-012 stable pi sessions restore history and do not duplicate seeds |
| TC-PI-013 | 串行与 UI 镜像 | integration | 真 FileSessionStore | 并发同 session、写历史 | 顺序稳定、关闭镜像不重复写 | sessionBridge.test.js: TC-PI-013 session serialization and optional UI history mirror |
| TC-PI-014 | 技能来源与禁用规则 | integration | 临时 workspace/global 技能 | pi loader 加载并禁用后 reload | workspace 覆盖 global，禁用项消失，不加载扩展 | skillBridge.test.js: TC-PI-014 pi skills honor configured roots, disable rules, precedence and reload |
| TC-PI-015 | 真实 pi 循环与事件 | integration | 本地 SSE mock | 工具 add 后流式回复 | 输出 42，全部兼容事件与 trace/seq 字段正确，无内置工具 | piRuntime.test.js: TC-PI-015 real pi loop executes tools and maps legacy events |
| TC-PI-016 | 第二轮、图片、音频 | integration | 本地 mock 与 pi JSONL | 重建 runtime，图片/ASR 请求 | 历史恢复、图片发送、转录入 prompt | piRuntime.test.js: TC-PI-016 real session resume, image input and audio transcription |
| TC-PI-017 | 实际模型回退和覆盖 | integration | 503 主模型、本地备用 | 请求并覆盖 modelRef | 按顺序回退且 user 输入不重复 | piRuntime.test.js: TC-PI-017 transient fallback and per-run model override use actual provider requests |
| TC-PI-018 | pi 执行权限拒绝 | integration | low 与 memory_write | 模型请求写入 | 工具未执行，模型收到失败 | piRuntime.test.js: TC-PI-018 tool denial is visible to pi and does not bypass permissions |
| TC-PI-019 | 副作用后禁止回退 | integration | 工具后 503、401 | 执行两种错误 | 不重放工具，不回退鉴权失败 | piRuntime.test.js: TC-PI-019 never fall back after tools or on authentication failures |
| TC-PI-020 | 循环步数上限 | integration | 无限工具 mock | maxStep=2 | 有限请求后 ERROR | piRuntime.test.js: TC-PI-020 endless tools stop at configured step limit |
| TC-PI-021 | 网关完整双模式 e2e | e2e | 每模式独立 home、本地 mock | 子进程分别执行原 gateway.e2e.test.js 五项 | pi/legacy 均通过 HTTP、WS、历史、记忆、Live2D、图片及语音设置 | gatewayModes.test.js: TC-PI-021 existing gateway e2e suite passes with AGENT_CORE=pi/legacy |
| TC-PI-022 | 回滚与 model_ref 转送 | unit | 真 RuntimeRpcWorker、假 runner | legacy 选择、无效开关、执行 runtime.run | worker 原生把 model_ref 与权限转交 runner，兼容装配不再二次包装 | gatewayModes.test.js: TC-PI-022 core rollback and native worker model_ref forwarding preserve existing context |
| TC-PI-023 | 自动压缩持久化 | integration | 小上下文模型、本地 mock usage | 三轮对话触发 threshold | 实际生成并持久化 compaction entry，下一轮继续 | piRuntime.test.js: TC-PI-023 automatic compaction persists a summary and resumes through pi |
| TC-PI-024 | 自定义推理字段 | unit | 字节切分 UTF-8 SSE | 转换字段并回放历史 | 中文与 DONE 帧保留，历史映射到配置字段 | modelAdapter.test.js: TC-PI-024 custom reasoning fields normalize split UTF-8 SSE and history replay |
| TC-PI-025 | 多 provider 工具名编码 | integration | 含点、冲突候选、超长名称的工具，本地 SSE mock | 发送工具 schema、由模型调用含点工具 | 线上名称合法无碰撞；executor、Live2D 控制与所有兼容事件使用原名 | piRuntime.test.js: TC-PI-025 provider-safe tool names execute and emit their original names without collisions |
| TC-PI-026 | 模型不可见审批能力 | unit | registry 同时包含 `shell.exec` 与 `shell.approve` | 构造 Pi 工具桥并检查 schema | provider 只收到 `shell.exec`；prompt 禁止请求、伪造或重试审批 token | `test/runtime/agent-pi/toolBridge.test.js`, `test/runtime/agent-pi/promptBuilder.test.js` / TC-PI-026 |
| TC-PI-027 | 其他工具失败保留错误码与详情 | unit | 工具抛带 details 的 ToolingError | 经 pi 工具桥执行 | 抛出的错误文本包含错误码与 details JSON | `test/runtime/agent-pi/toolBridge.test.js` / TC-PI-027 |
| TC-PI-028 | 语音回复以 TTS 为首动作 | integration | voice policy/force_on；文字与音频输入 | 构造 pi prompt；检查 voice policy；把音频输入送入实际 pi session | 模型判断需语音时 TTS 先于 Live2D、搜索及其他工具；音频输入标记进入 system prompt；缺失策略文件仍默认启用；默认冷却 0.5 秒且每分钟 12 次 | `test/runtime/agent-pi/promptBuilder.test.js`, `test/runtime/agent-pi/piRuntime.test.js`, `test/runtime/voicePolicy.test.js` |
| TC-PI-029 | Legacy 语音任务打断与超时释放 | integration | legacy runner 的同一 session 有正在执行工具的音频 turn | 提交新音频 turn；另起一个不结束的音频 turn 并等待时限 | legacy 回滚模式仍可 abort 旧 turn；无新输入时 90 s 超时收尾；两者都以 ABORTED final 释放 worker | `test/runtime/runtimeRpcWorker.test.js` 的 voice interrupt / bounded execution 用例 |
| TC-PI-030 | 长生命周期 registry 复用会话 | unit | 两个相同 session_id 与一个不同 session_id | 并发/顺序调用 registry.get | 相同 ID 只创建一个 entry；不同 ID 隔离；disposeAll 释放全部资源 | `test/runtime/agent-pi/agentSessionRegistry.test.js` |
| TC-PI-031 | registry 空闲回收与容量限制 | unit | 可控时钟、busy entry、容量 2 | 推进时钟并创建第三个会话 | 只回收过期且非 busy 的 entry；容量恢复；busy 会话不被中断 | `test/runtime/agent-pi/agentSessionRegistry.test.js` |
| TC-PI-032 | PiRuntime 复用 AgentSession 并记录实际模型 | integration | mock provider、同一 session 两轮 | 两次 run 并读取 plan/metrics/registry | AgentSession 对象相同；第二轮含首轮历史；requested/resolved model ref 可诊断；dispose 清空 registry | `test/runtime/agent-pi/piRuntime.test.js` |
| TC-PI-033 | Pi 工具副作用感知并行 | integration | 两个 90ms 只读工具、写/锁/未知工具 | 让真实 Pi 同批请求两个只读工具，并检查桥接定义 | 只读/none 且无锁的工具并发；写、锁或未知工具串行；运行指标报告 parallel | `test/runtime/agent-pi/toolBridge.test.js`, `test/runtime/agent-pi/piRuntime.test.js` |
| TC-PI-034 | Pi 原生 steering/follow-up 与请求归属 | integration | 同一长生命周期 session；旧 turn 可在工具中运行 | 并发提交普通文字、语音和显式 text steer；观察 provider 历史与两个 RPC | follow-up 依次回答；steer 在工具后、下一模型调用前接续；旧 RPC ABORTED；每个请求只收到自己的 delta/final；legacy 行为不变 | `test/runtime/agent-pi/turnCoordinator.test.js`, `test/runtime/agent-pi/piRuntime.test.js`, `test/runtime/runtimeRpcWorker.test.js` |
| TC-PI-035 | 会话审批策略层 | integration | shell operator、跨工作区路径、手机设备会话 | 分别使用 manual、auto_approve、full_access；经 HTTP 与 Device Hub 决策 | manual 等待匹配 session 的决定；auto 在模型外签发并只重试一次；full access 提升 high、放开工作区并跳过逐次审批，同时硬危险命令仍拒绝；模式持久化且非法值 400 | `test/runtime/approvalCoordinator.test.js`, `test/runtime/tooling.test.js`, `test/runtime/sessionPermissions.test.js`, `test/gateway/deviceHub/runtimeBridge.test.js`, `test/integration/gateway.e2e.test.js` |
| TC-PI-036 | 会话 EventBus 工具与高优先级 steering | integration | 驻留 Pi AgentSession、RuntimeEventBus、手机来源事件 | 订阅安全 topic，发布多条及超大事件，pull/cursor/unsubscribe；建立 high-priority steer 订阅并发布设备事件 | ACL、TTL、容量、64 KiB 和跨会话边界生效；pull 顺序稳定；只有显式 high steer 会进入同一 AgentSession 并生成独立最终事件；dispose 释放 listener | `test/runtime/agent-pi/sessionEventSubscriptions.test.js`, `test/runtime/agent-pi/busTools.test.js`, `test/runtime/agent-pi/piRuntime.test.js` |
| TC-PI-037 | Pi 标准 Skills、context 与受控标准工具 | integration | 临时 AGENTS.md、Apple Music Skill、真实 Pi definitions 与 ToolExecutor | 建立 session 并检查 provider system/tools；执行 read/bash/edit/write，切换 medium/high/full_access | context 与 Skill 各出现一次；Apple Music 不注册专用工具；四个原生工具可用且读写边界、自动审批、full access 与错误归因生效 | `test/runtime/agent-pi/skillBridge.test.js`, `test/runtime/agent-pi/standardTools.test.js`, `test/runtime/agent-pi/piRuntime.test.js` |
| TC-PI-038 | Realtime transcript 与工具 schema 转换 | unit | Pi system/user/assistant/toolResult 消息 | 转成 Qwen Realtime conversation items | system sections 与有效工具合并；user/assistant/function_call/function_call_output 顺序和 call_id 保持 | `test/runtime/agent-pi/qwenRealtimeAdapter.test.js` |
| TC-PI-039 | Realtime Pi 事件与原生音频分离 | integration | 假 Realtime WebSocket、Yachiyo 音色 | 注入 text/audio/function call/usage/done | 产生标准 Pi text/toolCall/done；音频仅走 voice.stream side channel；usage 正确归一化 | `test/runtime/agent-pi/qwenRealtimeAdapter.test.js` |
| TC-PI-040 | Realtime 使用唯一 Pi Agent 循环 | integration | 真实 Pi AgentSession、假 Realtime provider、原始 WAV、add 工具 | 音频首轮返回 function call；Pi 执行工具；次轮返回文字 | 不触发 ASR/旧 HTTP/手写循环；原始 PCM 直接进模型；工具由 Pi 执行；function_call_output 进入次轮；最终输出和会话状态正常 | `test/runtime/agent-pi/piRuntime.test.js` |
| TC-PI-041 | Realtime 音频消息映射与占位隔离 | unit | 带 `yachiyoInputAudio` 的 Pi user message | 转成 Qwen conversation item | 发送 `input_audio` 原始 PCM；内部占位文字不泄露给模型；非法 WAV 以 provider error 收口 | `test/runtime/agent-pi/qwenRealtimeAdapter.test.js` |
