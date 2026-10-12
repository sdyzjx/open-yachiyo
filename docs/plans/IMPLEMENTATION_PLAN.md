# Core Framework Construction Plan

## Completed in this iteration
- Added real LLM reasoner using OpenAI-compatible `chat/completions`
- Added YAML-based provider registry (`~/yachiyo/config/providers.yaml`)
- Added provider manager APIs and debug-page YAML editor for online updates
- Added file-backed session persistence (messages, runtime events, run records)
- Added session query APIs for backend retrieval
- Added multi-turn context injection from persisted session history
- Added tool-call driven long-term memory management (`memory_write` / `memory_search`)
- Added session-start memory bootstrap + markdown SOP context injection
- Introduced runtime EventBus abstraction
- Reworked tool execution to event-driven dispatch (`tool.call.requested` / `tool.call.result`)
- Added JSON-RPC 2.0 input queue (`RpcInputQueue`) and queue consumer worker (`RuntimeRpcWorker`)
- Updated gateway to route all runtime input through RPC queue
- Kept backward compatibility for debug UI `type=run`

## Next (P1 hardening)
- Add timeout/retry/cancel policy on tool dispatcher per tool type
- Add queue persistence and replay strategy for crash recovery
- Add idempotency key / dedupe in RPC worker for repeated request ids
- Add event schema validation before publishing to bus
- Add automated tests for JSON-RPC error codes and queue saturation behavior

## Next (P2 expansion)
- Add MCP tool adapter behind same event bus contract
- Add handoff/background task dispatcher with `task_id`
- Upgrade memory search ranking from lexical baseline to hybrid vector rerank
- Add memory quality scoring + decay policy per entry
- Add realtime bridge events (tts/lipsync/interrupt)
