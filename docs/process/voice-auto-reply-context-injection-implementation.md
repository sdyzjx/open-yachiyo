# Voice Auto Reply Context Injection Implementation

## Goal
Add a configurable, opt-in context-injection path so that the model receives a voice auto-reply system instruction only when enabled.

Current control source:

- `config/voice-policy.yaml` -> `voice_policy.auto_reply.enabled`
- runtime ignores session-level `voice_auto_reply_enabled` for decision making.

## Scope
In scope:

- session settings model extension
- gateway settings validation
- runtime context propagation
- conditional system prompt injection
- test coverage and documentation

Out of scope:

- hard enforcement / repair loops
- tool execution order changes
- realtime or playback pipeline changes

## Implementation Steps
1. Extend session settings schema
- File: `apps/runtime/session/sessionPermissions.js`
- Add `voice_auto_reply_enabled` to default, normalization, and merge behavior.

2. Validate and persist switch in gateway settings API
- File: `apps/gateway/server.js`
- Validate `settings.voice_auto_reply_enabled` is boolean.

3. Build runtime context with switch
- File: `apps/gateway/server.js`
- In `buildRunContext`, resolve switch from `voice-policy.yaml` only.
- Ignore session-level switch for runtime decisions.
- Persist the YAML-derived value in session settings and return it in `runtimeContext`.

4. Inject system prompt conditionally
- File: `apps/runtime/loop/toolLoopRunner.js`
- Add helper to build voice prompt only when `runtimeContext.voice_auto_reply_enabled === true`.
- Append prompt in `ctx.messages` as an extra `system` entry.

5. Add tests
- `test/runtime/sessionPermissions.test.js`
  - default and merge behavior for new switch.
- `test/runtime/toolLoopRunner.test.js`
  - injects voice prompt when enabled.
  - does not inject when disabled.
- `test/integration/gateway.e2e.test.js`
  - session settings API accepts boolean switch and persists.
  - rejects non-boolean switch.
  - runtime decision follows YAML even when session switch is patched to opposite value.

## Verification
Recommended commands:

- `node --test test/runtime/sessionPermissions.test.js test/runtime/toolLoopRunner.test.js test/integration/gateway.e2e.test.js`
- `npm run test:ci`

## Rollback
Revert commit(s) touching:

- `apps/runtime/session/sessionPermissions.js`
- `apps/gateway/server.js`
- `apps/runtime/loop/toolLoopRunner.js`
- related tests/docs
