# Testing and CI

## Overview

The project uses Node's built-in test runner (`node:test`) with a layered test strategy:

- Unit tests: pure modules and contracts
- Integration tests: gateway + queue + runtime + websocket flow with a mock LLM server

All tests are offline and deterministic. No external model API is required in CI.

## Test Layout

- `test/runtime/jsonRpc.test.js`: JSON-RPC contract validation
- `test/runtime/rpcInputQueue.test.js`: request queue acceptance/full/consumer behavior
- `test/runtime/eventBus.test.js`: event publish/subscribe/waitFor behavior
- `test/runtime/toolExecutor.test.js`: local tool execution and registry contract
- `test/runtime/providerConfigStore.test.js`: YAML config validation and persistence
- `test/runtime/fileSessionStore.test.js`: file-backed session persistence and lock behavior
- `test/runtime/contextBuilder.test.js`: session history to prompt-context assembly rules
- `test/runtime/longTermMemory.test.js`: long-term memory compression and retrieval recall behavior
- `test/runtime/longTermMemoryStore.test.js`: tool-managed long-term memory storage/search/bootstrap behavior
- `test/runtime/memoryTools.test.js`: `memory_write` / `memory_search` tool integration
- `test/runtime/memorySopLoader.test.js`: markdown SOP loading and clipping behavior
- `test/runtime/llmProviderManager.test.js`: provider selection, env key resolution, cache invalidation
- `test/runtime/openaiReasoner.test.js`: OpenAI-compatible response parsing (tool/final) and transient network retry behavior
- `test/runtime/toolLoopRunner.test.js`: event-driven tool call loop behavior
- `test/runtime/runtimeRpcWorker.test.js`: queue consumer RPC routing and response flow
- `test/integration/gateway.e2e.test.js`: end-to-end HTTP + WebSocket + runtime path with mock LLM, persisted session verification, multimodal image upload + persisted image URL retrieval, tool-driven long-term memory write/search, and session-start SOP/bootstrap injection check

## Commands

Run full test suite:

```bash
npm test
```

Run CI-equivalent command:

```bash
npm run test:ci
```

Run one file:

```bash
node --test test/integration/gateway.e2e.test.js
```

## CI Workflow

GitHub Actions workflow: `.github/workflows/ci.yml`

Triggers:
- `push` on `main`
- any `pull_request`

Steps:
1. checkout code
2. setup Node 22 with npm cache
3. `npm ci`
4. `npm run test:ci`

## Design Notes

- Integration test uses a temporary provider config file via `PROVIDER_CONFIG_PATH`.
- Gateway test port is injected by `PORT` env to avoid conflicts.
- Mock LLM server emulates tool-call + final-response cycle and verifies that second-turn prompts include first-turn history.
- Integration flow checks model can write/search memory via tool calls and verifies `/api/memory` + `/api/memory/search`.
