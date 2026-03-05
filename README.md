# open-yachiyo

![open-yachiyo cover](assets/readme-cover.png)

AI Native runtime for an **Agentic desktop pet**, with a **controllable ReAct loop**.

## Introduction video available at:
🎬 Demo Video: <https://www.bilibili.com/video/BV1brPkzFEr4/>


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
- **Streaming message pipeline** (`runtime.start/event/final` pushed to Web/Electron in real time)
- **Realtime auto lipsync for streaming output** (audio-spectrum viseme inference + consonant transient overlays, driving `ParamMouthOpenY` / `ParamMouthForm` automatically)
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

## Engineering Workflow

Parallel development and integration are handled with branch/worktree discipline and documented merge strategy.

- Branch/worktree collaboration: `docs/BRANCH_COLLABORATION_SPEC.md`
- Merge strategy: `docs/MERGE_STRATEGY.md`
- SSE logger MVP plan: `docs/SSE_EXPRESS_LOGGER_MVP_PLAN.md`

---

## Development Environment

- Primary development machine: **MacBook Air M4 (macOS)**
- Current status: **Windows is not yet adapted/validated**

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
- [wkf16](https://github.com/wkf16) — Maintainer

---

## TODO (Near-term)

> Source: GitHub open issues + `PROGRESS_TODO.md` snapshot.

### Open Issues

- [ ] #57 Feature: Integrate macOS Accelerometer
- [x] #49 fix(tts): Japanese proper noun pronunciation for "八千代"
- [ ] #46 feat(security/ux): Project Dev Mode + visual file-edit permission negotiation
- [ ] #35 feat(architecture): unified Heartbeat mechanism
- [ ] #31 feat(ai-native): session-level dynamic permission model + admin session
- [ ] #25 feat(agent): add git repository management capability
- [ ] #23 [Bug] WebUI nickname update not reflected by LLM

### Recent Progress

- [x] Desktop Live2D Phase A replan baseline
- [x] Phase B chat panel UI
- [x] Phase C RPC forwarding
- [x] Phase D model-control tool-calling exposure
- [x] Phase F session sync + chat panel interaction polish
- [ ] Phase E stabilization and release hardening (REVIEW)
- [ ] Async voice module as tool-calling capability (ASR + TTS)
- [ ] Expose Live2D motion/control as model-callable tools
- [ ] Telegram / NapCat adapters
- [ ] WebUI privileged fixed-session control dialog
