# Voice Auto Reply Context Injection

## Overview
This feature adds an optional runtime context switch that injects a voice auto-reply system prompt into the LLM message stack.

When enabled, the model is guided to call `voice.tts_aliyun_vc` before long text replies.
When disabled, no voice auto-reply prompt is injected.

This implementation is context-injection only. It does not enforce tool scheduling or finalization gates.

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

## Non-goals
- No strict enforcement if model ignores instruction.
- No voice tool reorder logic.
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
