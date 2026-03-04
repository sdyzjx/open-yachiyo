# open-yachiyo

![open-yachiyo cover](assets/readme-cover.jpg)

Native-first desktop AI assistant runtime with a **controllable ReAct loop**.
Built for two goals:

1. **Story A: Multi-agent software delivery** (parallel, auditable, review-gated)
2. **Story B: Controllable runtime core** (bounded, debuggable, deterministic)

🇨🇳 [中文说明](./README.zh.md)

---

## What this project is

`open-yachiyo` is an AI runtime and desktop shell designed for production-like agent execution:

- bounded turn loop (ReAct: Reason -> Act -> Observe)
- explicit tool-calling and memory operations
- session isolation and file-backed persistence
- desktop-first interaction (Live2D + streaming bubble)

This is **not** a wrapper around OpenClaw or generic orchestration frameworks.

---

## Quick Start

```bash
npm install
npm run dev
```

Configure provider at `~/yachiyo/config/providers.yaml`:

- `active_provider`
- `providers.<name>.base_url`
- `providers.<name>.model`
- `providers.<name>.api_key` or `api_key_env`

Health check:

```bash
curl http://localhost:3000/health
```

Web UI:

- Chat: `http://localhost:3000/`
- Provider config: `http://localhost:3000/config.html`

Desktop (Live2D):

```bash
npm run live2d:import
npm run desktop:up
npm run desktop:smoke
```

---

## Core Features

- **Controllable runtime loop** with hard step boundaries
- **JSON-RPC + queue ingress** (`runtime.run`) decoupled from execution
- **EventBus tool dispatch** (`tool.call.requested` -> `tool.call.result`)
- **Session persistence** (messages/events/runs)
- **Long-term memory tools** (`memory_write`, `memory_search`)
- **Desktop rich rendering** (Markdown/LaTeX/Mermaid, streaming bubbles)
- **Multimodal image input** with persisted previews
- **Provider hot config** via YAML + Web UI

Docs:

- Architecture: `docs/ARCHITECTURE.md`
- Testing: `docs/TESTING.md`
- Runtime usage cases: `docs/RUNTIME_FEATURE_USAGE_CASES.md`

---

## Why not OpenClaw?

OpenClaw is strong as a multi-channel gateway/orchestration layer.
`open-yachiyo` optimizes a different axis: **runtime controllability**.

| Dimension | OpenClaw (typical strength) | open-yachiyo focus |
|---|---|---|
| Primary goal | Multi-channel gateway + orchestration | Deterministic runtime core + desktop agent |
| Execution model | Flexible orchestration | Bounded ReAct cycle with explicit step control |
| Tool path | Highly extensible | EventBus-decoupled + runtime-auditable |
| Session behavior | General-purpose | Strong session isolation + explicit memory tools |
| Product posture | Gateway platform | Native runtime engine |

If you need “one gateway for many chat channels”, OpenClaw is great.
If you need “strictly controllable agent runtime”, this project targets that directly.

---

## Debuggability (first-class)

The runtime exposes a full-chain debug lane via **SSE**:

- subscribe: `GET /api/debug/events` (or `/debug/stream`)
- emit custom debug events: `POST /api/debug/emit`
- toggle debug mode: `PUT /api/debug/mode`

With topic filters, you can trace one request end-to-end:

`web/electron -> gateway ws -> queue -> worker -> loop -> dispatch -> executor -> ws outbound`

Reference:

- `docs/AGENT_SSE_DEBUG_TOOLCHAIN_GUIDE.md`
- `docs/DEBUG_CHAIN_FLOW_GUIDE.md`

---

## Story A: Multi-agent development at high throughput

This project’s development workflow is designed for sustained parallel delivery (e.g., **~15k added lines/day over 5 days** in burst phases):

1. **Split by branch/worktree** for concurrent agent work
2. **Route runtime chain to SSE** so debug agents can inspect exact RPC/tool paths
3. **Review-gated integration** before merging to `main`
4. **Keep `main` stable**, merge small validated units

### Practical mechanics

- Branch rules and worktree SOP:
  - `docs/BRANCH_COLLABORATION_SPEC.md`
  - `docs/MERGE_STRATEGY.md`
- SSE debug instrumentation for agent diagnosis:
  - `docs/SSE_EXPRESS_LOGGER_MVP_PLAN.md`
  - `docs/AGENT_SSE_DEBUG_TOOLCHAIN_GUIDE.md`

This makes multi-agent coding less “black box”, and more like an observable software pipeline.

---

## Testing

```bash
npm test
npm run test:ci
```

CI runs on GitHub Actions (`.github/workflows/ci.yml`).

---

## Repo Layout

- `apps/gateway`: HTTP/WebSocket ingress + debug endpoints
- `apps/runtime`: queue worker, loop, dispatcher, tooling, memory/session
- `apps/desktop`: desktop shell (Electron + Live2D)
- `docs/`: architecture/plans/debug/testing
- `config/`: providers/tools/skills/live2d presets

---

## Contributors

- [sdyzjx](https://github.com/sdyzjx) — Creator & Maintainer
- [wkf16](https://github.com/wkf16) — Contributor
