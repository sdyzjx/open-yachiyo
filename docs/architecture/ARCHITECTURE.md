# Architecture (Native Runtime, Queue + EventBus)

## Core Flow
1. WebSocket receives JSON-RPC 2.0 request (`runtime.run`) or legacy `type=run`.
2. Gateway converts request to RPC envelope and pushes into `RpcInputQueue`.
3. `RuntimeRpcWorker` pops queue items, builds prompt context (session history + session-start memory bootstrap), then invokes `ToolLoopRunner`.
4. `ToolLoopRunner` asks LLM provider for next decision.
5. If tool is needed, runner publishes `tool.call.requested` to EventBus.
6. `ToolCallDispatcher` consumes call event, executes tool, publishes `tool.call.result`.
7. Runner waits on EventBus result event, updates context, and continues loop.
8. Final result is emitted as runtime events and JSON-RPC response.
9. SessionStore persists run input/output/messages/events; long-term memory is managed by dedicated tools/store.

## Decoupling Guarantees
- Runner never invokes tool execution directly.
- Tool execution path is only EventBus-based (`requested -> result`).
- Gateway never calls runtime internals directly; it only enqueues RPC inputs.
- RPC worker is the sole queue consumer and method router.

## Provider Config (YAML)
- Config file: `~/yachiyo/config/providers.yaml`
- Gateway reads provider config through `ProviderConfigStore` + `LlmProviderManager`
- Debug front-end edits YAML via `/api/config/providers/raw`
- Runner resolves reasoner per request, so provider updates apply immediately without process restart

## Session Persistence
- Implementation: file-backed store (`apps/runtime/session/fileSessionStore.js`)
- Runtime hooks:
  - `buildPromptMessages` (load session-start SOP/bootstrap + recent history as prompt context)
  - `onRunStart`
  - `onRuntimeEvent`
  - `onRunFinal` (persist final output only)
- Query APIs:
  - `GET /api/sessions`
  - `GET /api/sessions/:sessionId`
  - `GET /api/sessions/:sessionId/events`
  - `GET /api/sessions/:sessionId/memory`

## Long-Term Memory
- Store: `apps/runtime/session/longTermMemoryStore.js` (global file-backed entries)
- Tool-driven management:
  - `memory_write`: model decides when to write durable memory
  - `memory_search`: model proactively searches memory by keywords
- Session-start bootstrap:
  - inject SOP markdown (`docs/memory_sop.md`)
  - inject top-N memory entries (`MEMORY_BOOTSTRAP_MAX_ENTRIES`)
- APIs:
  - `GET /api/memory`
  - `GET /api/memory/search?q=<keyword>`

## Runtime State Machine
- IDLE -> RUNNING -> DONE
- IDLE -> RUNNING -> ERROR
- IDLE -> RUNNING -> ABORTED

## JSON-RPC Contract
- Supported method: `runtime.run`
- Params:
  - `input` (string, required)
  - `session_id` (string, optional)
- Notifications emitted:
  - `runtime.start`
  - `runtime.event`
  - `runtime.final`
- If request includes `id`, worker returns JSON-RPC result object.
