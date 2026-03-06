# Responses Stack Implementation Tracker

## Goal

Build a dual-stack LLM access layer that keeps `chat/completions` fully available while adding:

- provider/model based endpoint routing
- `responses` as a first-class path
- automatic fallback from `responses` to `chat/completions`
- session cache headers only for supported models

This document is the execution log, acceptance checklist, and user-facing reference for the feature.

## Delivery Strategy

### Phase 1: Config foundation

Status: completed

Scope:

- extend provider config schema with endpoint routing and `responses` settings
- keep old provider configs valid
- add unit tests for new config validation

Acceptance:

- existing configs still load unchanged
- invalid `responses` config is rejected with clear errors
- targeted tests pass:
  - `test/runtime/providerConfigStore.test.js`
  - `test/runtime/llmProviderManager.test.js`

Commit target:

- `feat(runtime): add dual-stack llm provider config schema`

### Phase 2: Responses reasoner

Status: completed

Scope:

- add a dedicated `responses` reasoner
- support text final output and tool-call decisions
- support streaming parsing

Acceptance:

- unit tests cover non-streaming and streaming paths
- output shape matches current tool loop contract
- targeted tests pass:
  - `test/runtime/responsesReasoner.test.js`
  - `test/runtime/openaiReasoner.test.js`

Commit target:

- `feat(runtime): add responses reasoner`

### Phase 3: Router and fallback

Status: completed

Scope:

- add stacked reasoner/router
- choose endpoint by provider/model capability
- fallback from `responses` to `chat/completions`

Acceptance:

- route selection is deterministic
- fallback emits observable state and preserves decision behavior
- targeted tests pass:
  - `test/runtime/stackedReasoner.test.js`
  - `test/runtime/providerConfigStore.test.js`
  - `test/runtime/responsesReasoner.test.js`

Commit target:

- `feat(runtime): add responses-chat router fallback`

### Phase 4: Runtime integration and observability

Status: pending

Scope:

- wire router into provider manager and loop runner
- pass session context for `responses`
- surface endpoint selection, fallback, and cache application signals

Acceptance:

- tool loop remains backward compatible
- integration tests cover routing and session state handoff

Commit target:

- `feat(runtime): integrate dual-stack llm routing`

### Phase 5: Docs and rollout

Status: pending

Scope:

- document configuration, usage, fallback behavior, and session cache rules
- update testing and rollout notes

Acceptance:

- doc covers both usage and implementation principles
- relevant tests pass

Commit target:

- `docs(runtime): document dual-stack llm routing`

## Progress Log

- 2026-03-06: Created tracker and locked phased implementation plan.
- 2026-03-06: Completed provider config schema extension for dual-stack routing and added validation tests.
- 2026-03-06: Added `ResponsesReasoner` with streaming/non-streaming support and contract-compatible tool decisions.
- 2026-03-06: Added `StackedReasoner` with endpoint selection, `responses.model_allowlist`, and configurable responses-to-chat fallback.

## Usage

This section will be completed as features land. Planned coverage:

- how to force `chat/completions`
- how to force `responses`
- how `auto` routing works
- how to enable session cache only for supported models
- how fallback behaves and where to inspect it in logs

## Principles

This section will be completed as features land. Planned coverage:

- why dual-stack is safer than replacing `chat/completions`
- why session cache must be gated by model capability
- why routing and fallback belong below the tool loop
