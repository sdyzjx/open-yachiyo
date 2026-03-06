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

Status: completed

Scope:

- wire router into provider manager and loop runner
- pass session context for `responses`
- surface endpoint selection, fallback, and cache application signals

Acceptance:

- tool loop remains backward compatible
- integration tests cover routing and session state handoff
- targeted tests pass:
  - `test/runtime/llmProviderManager.test.js`
  - `test/runtime/stackedReasoner.test.js`
  - `test/runtime/toolLoopRunner.test.js`
  - `test/runtime/responsesReasoner.test.js`
  - `test/runtime/openaiReasoner.test.js`

Commit target:

- `feat(runtime): integrate dual-stack llm routing`

### Phase 5: Docs and rollout

Status: completed

Scope:

- document configuration, usage, fallback behavior, and session cache rules
- update testing and rollout notes

Acceptance:

- doc covers both usage and implementation principles
- relevant tests pass
- broad runtime regression passes:
  - `node --test test/runtime/*.test.js`

Commit target:

- `docs(runtime): document dual-stack llm routing`

## Progress Log

- 2026-03-06: Created tracker and locked phased implementation plan.
- 2026-03-06: Completed provider config schema extension for dual-stack routing and added validation tests.
- 2026-03-06: Added `ResponsesReasoner` with streaming/non-streaming support and contract-compatible tool decisions.
- 2026-03-06: Added `StackedReasoner` with endpoint selection, `responses.model_allowlist`, and configurable responses-to-chat fallback.
- 2026-03-06: Integrated stacked routing into provider manager and tool loop, with session cache injection and routing metadata exposure.

## Usage

### Config example

```yaml
active_provider: qwen
providers:
  qwen:
    type: openai_compatible
    display_name: Qwen
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3.5-plus
    api_key_env: DASHSCOPE_API_KEY
    llm_endpoint_mode: auto
    responses:
      enabled: true
      fallback_to_chat: true
      fallback_policy: unsupported_only
      model_allowlist:
        - qwen3.5-plus
        - qwen3.5-flash
      session_cache:
        enabled: true
        header_name: x-dashscope-session-cache
        model_allowlist:
          - qwen3.5-plus
```

### Routing modes

- `llm_endpoint_mode: chat`
  Always use `chat/completions`.

- `llm_endpoint_mode: responses`
  Always try `responses`. If `responses.fallback_to_chat` is enabled, fallback still applies.

- `llm_endpoint_mode: auto`
  Prefer `responses` only when `responses.enabled` is true and the current model passes `responses.model_allowlist`. Otherwise stay on `chat/completions`.

### Fallback behavior

- `responses.fallback_to_chat: true`
  Enables fallback from `responses` to `chat/completions`.

- `responses.fallback_policy: unsupported_only`
  Only fallback for unsupported-model or unsupported-endpoint style failures.

- `responses.fallback_policy: any_error`
  Fallback for any `responses` request failure.

### Session cache behavior

- Session cache is only applied on the `responses` path.
- Session cache requires:
  - `responses.session_cache.enabled: true`
  - a session id from runtime
  - the model to pass `responses.session_cache.model_allowlist` when the allowlist is not empty
- When applied, the runtime injects the configured header, defaulting to `x-dashscope-session-cache`.
- The router also remembers the last `response_id` per session and forwards it as `previous_response_id` on the next `responses` request for that same session.

### Observable output

The runtime now exposes route metadata through the normal loop output path:

- `decision.route`
- `decision.fallback_from`
- `decision.provider_meta.response_id`
- `decision.provider_meta.session_cache_applied`
- `decision.provider_meta.previous_response_id`
- `decision.provider_meta.usage`

## Principles

### Why dual-stack instead of replacement

`chat/completions` is still the broadest compatibility path across providers. Replacing it outright would force every provider and model to support `responses`, which is not true in practice. Dual-stack keeps the legacy path stable while enabling `responses` only where it is supported and useful.

### Why routing belongs below the tool loop

The tool loop should only care about one contract: final text decisions and tool decisions. By keeping endpoint routing inside the reasoner layer, the orchestration layer stays stable and the fallback path does not need special handling in tool execution or prompt assembly.

### Why session cache is model-gated

Session cache is not a generic OpenAI-compatible feature. It depends on provider-specific support and, in the Qwen case, model support. Gating it with an allowlist keeps the feature explicit and prevents accidental header injection for unsupported models.

### Why keep previous response ids in the router

`previous_response_id` is transport-specific state. It does not belong in the conversation transcript itself, because the transcript should remain portable between `chat/completions` and `responses`. The router is the correct layer to hold that per-session transport state.
