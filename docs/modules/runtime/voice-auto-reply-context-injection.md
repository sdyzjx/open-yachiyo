# Voice Auto Reply Context Injection

## Overview
This feature adds an optional runtime context switch that injects a voice auto-reply system prompt into the LLM message stack.

When enabled, the model is guided to call `voice.tts_aliyun_vc` before long text replies.
When disabled, no voice auto-reply prompt is injected.

Current behavior includes turn-local consumption inside `ToolLoopRunner`:

- when `voice.tts_aliyun_vc` succeeds once in the current reply turn, the loop marks the voice requirement as satisfied
- later steps in the same reply turn no longer expose `voice.tts_aliyun_vc` back to the planner
- the loop also injects a short status system message so the model knows TTS is already completed for this reply

## Switch Model
The runtime switch source is:

- `config/voice-policy.yaml` -> `voice_policy.auto_reply.enabled`

The session field is kept for compatibility/observability:

- `voice_auto_reply_enabled: boolean`

Runtime resolution per run:

1. Read `voice_policy.auto_reply.enabled` from YAML.
2. Ignore session-level `voice_auto_reply_enabled` as decision source.
3. Persist the YAML-derived value back into session settings.

## Injection Point
Injection happens in `ToolLoopRunner.run()` while building `ctx.messages`.

Injected only when:

- `runtimeContext.voice_auto_reply_enabled === true`

Prompt intent:

- call `voice.tts_aliyun_vc` before long text reply
- voice text can be summary or brief commentary
- plain text only
- no markdown/code block
- no more than 5 sentences

## Affected Runtime Data Flow
1. Gateway `buildRunContext` loads `voice-policy.yaml`, resolves and persists the switch.
2. `RuntimeRpcWorker` passes `runtimeContext` into `ToolLoopRunner`.
3. `ToolLoopRunner` conditionally appends a `system` message.

## Turn-local constraint

The prompt text says "before returning the final answer", but the runtime treats this as a **reply-turn local requirement**, not a per-step requirement.

That means:

- one successful `voice.tts_aliyun_vc` call is enough for one final user-facing reply
- the loop must not keep asking the model to call TTS again on every subsequent tool step
- a new user request starts a new turn and re-enables the requirement

## Non-goals
- No playback/transport changes.

## APIs
Session settings API supports this field:

- `PUT /api/sessions/:sessionId/settings`
- `GET /api/sessions/:sessionId/settings`

Validation:

- `settings.voice_auto_reply_enabled` must be boolean.

## Tests
Covered by:

- `test/runtime/sessionPermissions.test.js`
- `test/runtime/toolLoopRunner.test.js`
- `test/integration/gateway.e2e.test.js`
