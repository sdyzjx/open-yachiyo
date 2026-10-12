# Architecture (pi Runtime, Queue + EventBus)

> 类型: module
> 状态: active
> 负责人: Codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../features/FEAT-runtime-pi-agent-core.md, ../plans/PLAN-android-companion-contracts.md, ../../apps/runtime/agent-pi/

## Core Flow

1. WebSocket receives JSON-RPC `runtime.run` or legacy `type=run` and enqueues an RPC envelope.
2. RuntimeRpcWorker builds session/persona/permission context and performs existing audio transcription.
3. Gateway assembly selects `AGENT_CORE=pi` (default) or `legacy` (rollback).
4. PiRuntime refreshes Model Catalog, tools and skills, restores the session's pi JSONL, and calls AgentSession.prompt.
5. pi owns the model/tool loop and automatic compaction. Custom tools execute through ToolExecutor, preserving schema, policy, workspace and event context. Device methods call the Device Hub through the same tool pipeline.
6. EventBridge converts pi events to the existing runtime.event envelope. The worker keeps the original WebSocket notifications and JSON-RPC result contract.
7. SessionManager persists model context and compaction. Existing gateway hooks write FileSessionStore for UI queries.

The legacy branch retains ToolLoopRunner → tool.call.requested → ToolCallDispatcher → tool.call.result. The pi branch does not publish dispatcher commands; doing so would execute a tool twice. RuntimeEventBus remains the UI/device event transport in both modes.

## Boundaries

- CommonJS loads pi ESM packages exclusively through agent-pi/loadPi.js.
- Built-in pi read/bash/edit/write and other built-ins are inactive. The active list contains only registered Yachiyo and Device Hub tools.
- Model/provider credentials are resolved from Model Catalog and held in memory. Default pi credential files, external extensions, and model network refresh are disabled.
- A per-session lock serializes requests to a stable SHA-256(session_id).jsonl. No session context is stored in a process-global conversation.
- Gateway remains the queue producer; RuntimeRpcWorker remains the consumer and RPC router.

## Provider and Skills Configuration

`~/yachiyo/config/providers.yaml` is read via ProviderConfigStore → Model Catalog → modelAdapter. OpenAI completions, Anthropic messages and Google generative AI API identifiers follow C4. Runtime model overrides and the fallback chain are resolved per run. Only transient failures before visible text/tool execution may fall back.

Repository skills/ and runtime skills directories retain skills.yaml source/eligibility rules. pi DefaultResourceLoader parses the filtered resources; an explicit pi-formatted skill list is added because built-in file readers are disabled.

## Session Persistence

pi's source of model history is `~/yachiyo/data/pi-sessions/`; FileSessionStore remains the UI view. Gateway hooks remain:

- buildPromptMessages: session-start memory SOP/bootstrap and legacy history import.
- onRunStart: user message and uploaded-image metadata.
- onRuntimeEvent: existing event history.
- onRunFinal: final assistant message and run metadata.

`/api/sessions`, `/api/sessions/:sessionId`, `/events`, `/memory`, and `/settings` retain their existing routing. WS2 adds persistent model_ref settings. Direct PiRuntime users can opt into FileSessionStore mirroring; gateway assembly disables it to prevent duplicate writes.

## Long-Term Memory

LongTermMemoryStore remains authoritative for global memory. memory_write and memory_search execute through the permission pipeline. Session-start SOP (`docs/memory_sop.md`) and bootstrap entries are passed into the pi prompt; low permission suppresses new memory seeds. Persona/profile and voice reply policy preserve the old prompt paragraphs.

## Runtime State and Protocol

Run results retain DONE/ERROR, output, traceId, metrics. Existing runtime.start, message.delta, runtime.event, tool_call.event and runtime.final WebSocket notifications remain. The event envelope retains trace/session/step/seq, source and latency fields; tool failures preserve their original code. Additional pi.compaction_start/end events expose compaction status.

See [feature specification](../features/FEAT-runtime-pi-agent-core.md) for configuration, event fields and limits, and [test cases](../testing/TC-runtime-pi-agent-core.md) for offline regression coverage in both cores.
