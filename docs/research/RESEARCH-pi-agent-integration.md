# pi 1.1.0 Agent 集成调研

> 类型: research
> 状态: done
> 负责人: Codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-ws1-pi-core.md, ../features/FEAT-runtime-pi-agent-core.md

## 版本与依据

锁定 `@earendil-works/pi-coding-agent`、`pi-ai`、`pi-agent-core` 为 **1.1.0**，Node 24。已阅读安装包 docs 中 sdk、sessions、compaction、skills、extensions、models、custom-provider、message-types 以及 examples/sdk 全部示例，并核对 dist 类型定义及实现。参考上游 [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[provider](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)；实现以本地锁定版本为准。

## SDK 边界

- `createAgentSession({ modelRuntime, model, resourceLoader, settingsManager, sessionManager, noTools, tools, customTools })` 返回 `{session}`；`prompt()` 等待重试/恢复结束，`dispose()` 释放会话。不要以 `agent_end` 作为全部工作完成；SDK 还可能压缩重试。
- `SessionManager.create(cwd, dir)` / `open(file, dir)` 管理 JSONL 树；`appendMessage()` 导入旧历史，`buildSessionContext()` 重建经过压缩的上下文。不能直接赋值 agent.state.messages 来代替持久化。
- `ModelRuntime.create({credentials, modelsPath:null, modelsStore, refreshOnCreate:false, allowModelNetwork:false})` 隔离默认用户凭证和网络发现。`registerProvider(id, config)` 可编程注册 OpenAI/Anthropic/Google 模型；API 标识与 C4.2 一致。
- `DefaultResourceLoader` 支持 `systemPromptOverride`、`appendSystemPromptOverride`、`skillsOverride`；关闭环境中的 extensions、prompts、context files，防止意外载入开发仓库 AGENT.md 或用户的 pi 扩展。
- 自定义工具 `{name,label,description,parameters,execute(callId,args,signal,onUpdate,ctx)}`；结果 `{content:[{type:'text',text}],details}`，抛异常表示工具失败。JSON Schema 由现有 ToolExecutor 再次校验，权限不得绕过。
- `noTools:'builtin'` 禁用默认工具；`tools:[]` 同时禁用自定义工具，因此显式工具白名单必须包含桥接工具名称。
- CommonJS 通过单一 `loadPi.js` 的缓存 `import()` 加载三个 ESM 包，失败后允许重试；不依赖 require(ESM) 的版本特殊行为。

## 模型适配

descriptor 的 snake_case 映射为 pi camelCase；保留 reasoning、input、contextWindow、maxTokens、headers。OpenAI compat 包含 supportsDeveloperRole、maxTokensField；reasoning_content_field 和 strip_reasoning_in_history 通过请求/响应 hook 处理。extra_body 在 onPayload 合并，timeoutMs/maxRetries 传给 pi-ai 请求。凭证只存内存，不写 models.json、不记录到事件或会话。

回退按 catalog.fallbackChain() 去重；model_ref 优先。仅在网络错误/429/5xx 且尚未输出文本或执行工具时回退，避免重复副作用。工具错误交还 pi 循环，不触发模型回退。现有 mock SSE 无 finish_reason，需兼容 supportsFinishReason:false；保留 tool-result name 供旧 mock 和 provider 使用。

## 事件映射

所有 runtime.event 保持 `{trace_id,session_id,task_id:null,step_index,seq,event,source:'runtime',latency_budget_ms:1200,payload}`。

| pi / 入口 | 旧协议与兼容字段 |
|---|---|
| run 开始 | plan；网关 worker 负责 WS runtime.start，bus 另发 runtime.start |
| turn_start | step_index 递增，llm.stream.start `{mode:'decision_stream'}` |
| message_update / text_delta | llm.stream.delta `{delta}`；worker 转 message.delta |
| toolcall_end | tool_call.stable `{call_id,name,args}` |
| tool_execution_start | tool.call `{call_id,name,args,dispatch_mode}`；新增 tool_call.requested/started |
| tool_execution_end | tool.result `{call_id,name,ok,result,error,code}`；tool_call.completed/failed |
| message_end assistant | llm.stream.end；llm.final `{decision,streamed,stream_meta}` |
| prompt 完成 | done `{output,state,metrics}`；worker 负责 WS runtime.final，bus 另发 runtime.final |
| 失败 | tool.error `{error}`；bus runtime.error，run 返回 ERROR |

旧核心未发 tool_call.requested/started/completed/failed（只有流式 delta/stable/parse_error）；为满足 C5 新增这些事件，同时保留旧 tool.call/tool.result。不能发布 tool.call.requested 到 dispatcher 后又直接 executor.execute，否则工具会执行两次。

## Prompt、技能与会话

PersonaContextBuilder 原样复用；seedMessages 的 system 部分保留 memory SOP/bootstrap；语音规则、persona 修改提示、截图提示逐段迁移。会话权限通过每轮 context 注入。技能沿用 skills.yaml 的来源、禁用及 eligibility，再交 pi resource loader 管理目录和显式命令。

外部 session_id 使用哈希路径映射固定 pi JSONL，避免路径穿越；同会话串行，不同会话独立。UI 的 FileSessionStore 写入继续由网关 hooks 完成，独立运行提供可选镜像，避免重复消息。压缩由 SettingsManager.compaction 配置，默认开启。

## 风险与对策

- SDK 自动发现可能读写 ~/.pi 或访问模型目录：显式内存配置/凭证/目录存储，离线测试覆盖。
- RPC worker 未转送 model_ref、settings 未保留该字段，以及 avatar 服务端 API 未规定：详见施工文档待统筹决策。
- 工具名含点是本项目历史协议；保留名称，按真实兼容 provider 验收限制。
- 旧截图工具返回的是本地 artifact 引用：工具桥需附加图像块，避免提示词承诺图片但模型看不到。
- pi 会话持久化系统提示词：不得把密钥放入提示词；权限改变时注意历史已经披露的信息无法撤回。
- package-lock.json 不在本工作流范围；合并后统筹更新锁文件，随后 npm ci 再验证。
