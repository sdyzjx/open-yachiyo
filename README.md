# open-yachiyo

![open-yachiyo cover](assets/readme-cover.jpg)

Native-first desktop AI assistant runtime — built from scratch on the [ReAct loop](https://arxiv.org/abs/2210.03629) for predictable, bounded, auditable agent execution. Not a wrapper around OpenClaw or any orchestration framework: no unbounded tool chains, no cross-session context bleed, no workflow instability.

🇨🇳 [中文说明](./README.zh.md)

## Current State

This repository now runs in real LLM mode with a decoupled architecture:
- Runtime loop asks LLM for next action (final response or tool call)
- Tool calls are dispatched through event bus topics, not direct method calls
- Input requests enter a JSON-RPC 2.0 message queue before runtime processing

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure model provider YAML (`~/yachiyo/config/providers.yaml`):

```bash
# edit ~/yachiyo/config/providers.yaml:
# - active_provider
# - providers.<name>.base_url
# - providers.<name>.model
# - providers.<name>.api_key or api_key_env
```

If using `api_key_env`, export the env var (example):

```bash
export OPENAI_API_KEY="<your_api_key>"
```

3. Start service:

```bash
npm run dev
```

4. Health check:

```bash
curl http://localhost:3000/health
```

5. Web UI:
- Chat UI: `http://localhost:3000/`
- Provider config UI: `http://localhost:3000/config.html`

## Desktop Live2D (Replanned)

1. Import model assets into project path:

```bash
npm run live2d:import
```

2. Start desktop suite (gateway + live2d window + RPC):

```bash
npm run desktop:up
```

3. Run quick desktop RPC smoke after startup:

```bash
npm run desktop:smoke
```

Runtime summary file:
- `~/yachiyo/data/desktop-live2d/runtime-summary.json`

UI config file:
- `~/yachiyo/config/desktop-live2d.json`
- Editable knobs include:
  - window position: `window.placement.anchor` / `margin*`
  - compact mode (chat hidden): `window.compactWhenChatHidden` / `window.compactWidth` / `window.compactHeight`
  - model size/position: `layout.*` (use `layout.lockScaleOnResize` + `layout.lockPositionOnResize` to keep avatar pose stable while toggling chat panel)
  - clarity: `render.resolutionScale` / `render.maxDevicePixelRatio`

Current baseline (already done):
- transparent desktop Live2D window
- chat panel: history + local input + show/hide + clear + append
- chat panel is hidden by default and toggles when clicking the character
- chat panel default anchor moved to bottom-left to avoid covering face area
- chat panel header includes `Hide` / `Close` controls for pet window
- chat panel hidden state triggers compact window mode to reduce desktop occlusion
- tray icon stays available after hide; click tray icon to summon pet window again
- **streaming bubble output**: real-time display of LLM response generation with blinking cursor animation
  - listens to `message.delta` events from runtime
  - 50ms throttle to prevent excessive IPC communication
  - streaming bubbles stay visible for 30s (vs 5s for final)
  - backward compatible: falls back to non-streaming mode if no delta events
- rpc methods: `state.get`, `param.set`, `model.param.set`, `model.param.batchSet`, `model.motion.play`, `model.expression.set`, `chat.show`, `chat.bubble.show`, `chat.panel.show`, `chat.panel.hide`, `chat.panel.append`, `chat.panel.clear`, `tool.list`, `tool.invoke`
- right-bottom placement + drag-ready window + configurable layout/clarity
- renderer-to-main submit event: `live2d:chat:input:submit`
- runtime forwarding: gateway `runtime.*` notification -> desktop `desktop.event` -> renderer final response append
- agent tool-calling surface: `tool.list` + whitelisted `tool.invoke`
- desktop chat session bootstrap: startup creates a fresh `desktop-*` session
- desktop `/new` command: creates and switches to a fresh gateway session
- web chat sync: `/api/sessions` polling keeps desktop-side sessions/messages visible in web UI

Desktop chat commands:
- `/new`: create and switch desktop runtime session (chat panel clears and starts new thread)

Live2D semantic action surface:
- tool names: `live2d.motion.play`, `live2d.expression.set`, `live2d.param.set`, `live2d.param.batch_set`, `live2d.emote`, `live2d.gesture`, `live2d.react`
- semantic presets live in `config/live2d-presets.yaml`
- tool-call schema is enforced by `config/tools.yaml` (invalid preset names are rejected before runtime execution)
- renderer-side action player consumes queued action messages and falls back to `Idle` when queue drains

Live2D action message shape:

```json
{
  "action_id": "optional-id",
  "action": { "type": "emote", "args": { "emotion": "happy", "intensity": "high" } },
  "duration_sec": 2.5,
  "queue_policy": "append"
}
```

Current gaps under active development:
- Phase E stabilization: observability hardening, stress regression, and release checklist

Detailed construction plan:
- `docs/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md`
- `docs/modules/desktop-live2d/module-reference.md`

## Desktop Markdown & Mermaid Rendering

Desktop Chat Panel and Bubble now support rich content rendering:

**ChatPanel Features**:
- Full Markdown support (headers, lists, tables, code blocks, etc.)
- LaTeX formula rendering with KaTeX (inline `$...$` and display `$$...$$`)
- Mermaid diagram rendering (flowchart, sequence, class, state, gantt, pie)
- Tool call visualization with syntax highlighting

**Bubble Smart Truncation**:
- Configurable message truncation (default: 120 characters)
- Three modes: simple, smart (recommended), disabled
- Smart mode preserves word boundaries and formula integrity
- Complex content (diagrams/formulas) shows hint instead of truncating
- Emoji and multi-byte character aware

**Configuration**:
- Edit `~/yachiyo/config/desktop-live2d.json`
- Or use WebUI at `/config-v2.html` (Desktop Bubble Settings section)
- See `docs/DESKTOP_MARKDOWN_MERMAID_FEATURE.md` for full documentation

## Multimodal Image Input

Chat UI supports image upload with multimodal model calls:
- send text + image, or image-only messages
- click image in chat history to open lightbox preview
- image preview remains available after service restart (file-backed session image store)

Runtime/API support:
- Legacy websocket `type=run` accepts `input_images[]`
- JSON-RPC `runtime.run` accepts `params.input_images[]`

## Persistence

Session persistence is enabled by default (file-backed):
- default path: `~/yachiyo/data/session-store`
- override path: `SESSION_STORE_DIR=/your/path`

Session image persistence:
- default path: `~/yachiyo/data/session-images`
- override path: `SESSION_IMAGE_STORE_DIR=/your/path`

Session APIs:
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/events`
- `GET /api/sessions/:sessionId/memory`
- `GET /api/memory`
- `GET /api/memory/search?q=<keyword>`
- `GET /api/session-images/:sessionId/:fileName`

## Context Management

Each `runtime.run` now assembles multi-turn prompt context from persisted session history:
- Source: latest user/assistant messages from session store
- Injection point: before current input is appended to prompt
- Runtime tunables:
  - `CONTEXT_MAX_MESSAGES` (default: `12`)
  - `CONTEXT_MAX_CHARS` (default: `12000`)

## Long-Term Memory

Long-term memory is now decoupled from runtime finalization and managed by model tool-calls:
- Write flow: model calls `memory_write` tool
- Search flow: model calls `memory_search` tool by keyword query
- Storage: global file-backed memory store (`~/yachiyo/data/long-term-memory` by default)

Session-start context behavior:
- On new session start, gateway injects:
  1. memory SOP markdown (`docs/memory_sop.md` by default)
  2. bootstrap long-term memory entries (top N, configurable)

Memory tunables:
- `LONG_TERM_MEMORY_DIR` (default: `~/yachiyo/data/long-term-memory`)
- `MEMORY_BOOTSTRAP_MAX_ENTRIES` (default: `10`)
- `MEMORY_BOOTSTRAP_MAX_CHARS` (default: `2400`)
- `MEMORY_SOP_PATH` (default: `docs/memory_sop.md`)
- `MEMORY_SOP_MAX_CHARS` (default: `8000`)

## Testing

Run the complete test suite:

```bash
npm test
```

CI-equivalent command:

```bash
npm run test:ci
```

CI note:
- `npm run test:ci` intentionally excludes `test/runtime/voiceAdapter.test.js` to avoid hard dependency on `ffmpeg` in hosted CI environments.

Voice adapter tests (local):
- install `ffmpeg` first, then run:

```bash
node --test test/runtime/voiceAdapter.test.js
```

Detailed testing guide:
- `docs/TESTING.md`

## Runtime Message Paths

### Legacy Web Debug Message (backward compatible)

WebSocket `/ws` accepts:

```json
{ "type": "run", "input": "现在几点了" }
```

Returns `start` / `event` / `final` messages.

### JSON-RPC 2.0 Queue Input

WebSocket `/ws` also accepts JSON-RPC request:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "runtime.run",
  "params": {
    "session_id": "demo-session",
    "input": "12+35"
  }
}
```

Runtime sends:
- `runtime.start` notification
- `runtime.event` notifications (plan/tool.call/tool.result/done/tool.error)
- `runtime.final` notification
- JSON-RPC response with final result (when `id` is provided)

## Provider Config API
- `GET /api/config/providers` summary view
- `GET /api/config/providers/config` full parsed config
- `PUT /api/config/providers/config` save full config object
- `GET /api/config/providers/raw` raw YAML text
- `PUT /api/config/providers/raw` save YAML text

Provider config now has a dedicated page (`/config.html`) with graphical form editing and raw YAML editing.

## LLM Reliability (Retry)

OpenAI-compatible LLM requests now include transient failure retry:
- network/socket/timeout style failures: retry
- HTTP retriable statuses: `408`, `409`, `429`, `5xx`

Provider config optional fields (per provider):
- `max_retries` (default `2`)
- `retry_delay_ms` (default `300`)

Env fallback:
- `LLM_REQUEST_MAX_RETRIES`
- `LLM_REQUEST_RETRY_DELAY_MS`

Multimodal input limits:
- `MAX_INPUT_IMAGES` (default `4`)
- `MAX_INPUT_IMAGE_BYTES` (default `8MB`)
- `MAX_INPUT_IMAGE_DATA_URL_CHARS` (default `ceil(MAX_INPUT_IMAGE_BYTES * 1.5)`)

## Repo Layout
- `apps/gateway`: websocket gateway + rpc queue ingress
- `apps/runtime`: event bus, rpc worker, llm reasoner, tool loop
- `apps/realtime`: realtime voice/lipsync services (planned)
- `apps/desktop`: electron + react + live2d shell (planned)
- `packages/*`: shared protocol/contracts placeholders

## Next
See `docs/IMPLEMENTATION_PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/TESTING.md`.

Detailed feature implementation record:
- `docs/LONG_TERM_MEMORY_TOOL_CALL_IMPLEMENTATION.md`
- `docs/SESSION_WORKSPACE_PERMISSION_IMPLEMENTATION.md`
- `docs/SKILLS_RUNTIME_IMPLEMENTATION.md`

Module-level runtime docs:
- `docs/modules/runtime/session-workspace-permission.md`
- `docs/modules/runtime/skills-runtime.md`
- `docs/modules/runtime/multimodal-image-runtime.md`

Practical usage cases:
- `docs/TEST_SKILL_SMOKE_GUIDE.md`
- `docs/RUNTIME_FEATURE_USAGE_CASES.md`

## Contributors

Thanks to everyone who has contributed to this project!

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/sdyzjx">
        <img src="https://github.com/sdyzjx.png" width="80" alt="sdyzjx" style="border-radius:50%"/><br/>
        <sub><b>sdyzjx</b></sub>
      </a><br/>
      <sub>Creator & Maintainer</sub>
    </td>
    <td align="center">
      <a href="https://github.com/wkf16">
        <img src="https://github.com/wkf16.png" width="80" alt="wkf16" style="border-radius:50%"/><br/>
        <sub><b>wkf16</b></sub>
      </a><br/>
      <sub>Contributor</sub>
    </td>
  </tr>
</table>

## Why Not OpenClaw?

OpenClaw is a capable orchestration layer, but it wasn't designed for the constraints this project needs. In practice, running an agent through OpenClaw means accepting: unbounded tool-call chains with no hard loop limit, context window bleed across long sessions, and a workflow model optimized for flexibility over determinism. For a desktop-resident assistant that needs to stay snappy and predictable, that's the wrong tradeoff.

**open-yachiyo's runtime is built from scratch on the ReAct loop** (Reason → Act → Observe, repeat). Each turn is a single, auditable cycle: the model reasons about the current state, emits exactly one action (tool call or final response), the runtime executes it, and the result is fed back as an observation. The loop has a hard step cap. Sessions are isolated. There's no ambient "agent memory" leaking between unrelated conversations — memory is explicit, tool-driven, and queryable.

The result is a runtime you can actually reason about: predictable turn structure, bounded execution, and a clear audit trail from input to output.
