# Heartbeat And Desktop Awareness Research

## Goal

This note summarizes two related questions:

1. What OpenClaw heartbeat actually is.
2. How a heartbeat-style mechanism could be used to implement desktop awareness in the current `desktop-ai-native-runtime` architecture.

The conclusion is that heartbeat should be treated as a background attention loop, not as a transport keepalive and not as the sensor layer itself.

## What OpenClaw Heartbeat Is

OpenClaw heartbeat is fundamentally a business-layer agent run triggered in the background.

It is not primarily:

- a WebSocket ping/pong keepalive
- a renderer timer
- a passive status flag

It is primarily:

- a scheduled or wake-driven agent invocation
- running against an existing session/agent context
- constrained by a dedicated heartbeat prompt
- allowed to stay silent through an ack token such as `HEARTBEAT_OK`

Relevant OpenClaw source references:

- default heartbeat prompt and ack stripping:
  - `/Users/doosam/.openclaw/workspace/research/openclaw/src/auto-reply/heartbeat.ts`
- wake coalescing and retry when busy:
  - `/Users/doosam/.openclaw/workspace/research/openclaw/src/infra/heartbeat-wake.ts`
- actual heartbeat runner behavior:
  - `/Users/doosam/.openclaw/workspace/research/openclaw/src/infra/heartbeat-runner.ts`

### Essence

The essence of heartbeat in OpenClaw is:

`background trigger -> constrained agent decision -> quiet if nothing matters -> surface only meaningful attention`

That is why it works well for reminders, checks, proactive summaries, and event-driven follow-up, but not for realtime control loops.

## Current Runtime Architecture Mapping

In this repository, the main execution path is already centralized enough to support a heartbeat mechanism without introducing a second runtime:

- Gateway receives `/ws` requests and normalizes them into runtime RPC envelopes.
- `RpcInputQueue` is the single queue boundary.
- `RuntimeRpcWorker` builds context and invokes `ToolLoopRunner`.
- `ToolLoopRunner` assembles prompt messages and emits runtime events.
- Desktop already renders `runtime.final` into chat panel and bubble UI.

Relevant code:

- gateway websocket and request enqueue:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/gateway/server.js`
- runtime worker:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/runtime/rpc/runtimeRpcWorker.js`
- prompt assembly:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/runtime/loop/toolLoopRunner.js`
- desktop runtime client:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/desktop-live2d/main/gatewayRuntimeClient.js`
- desktop final output rendering:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/desktop-live2d/main/desktopSuite.js`

### Important Existing Strengths

The current architecture already has several properties that make heartbeat feasible:

- A single execution pipeline exists. Heartbeat can be modeled as a synthetic `runtime.run` instead of a new executor.
- Prompt injection points already exist in `buildRunContext` and `buildPromptMessages`.
- Desktop output already has a unified render path through `runtime.final`.
- Voice playback already supports runtime-to-desktop passthrough via `voice.playback.electron`.

### Important Existing Risk

Heartbeat cannot be naively implemented as a normal user turn in the current session.

Why:

- `onRunStart` persists the input as a `user` message.
- `onRunFinal` persists the output as an `assistant` message.
- `buildRecentContextMessages` later rehydrates `user` and `assistant` messages back into prompt context.

Relevant code:

- persistence hooks:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/gateway/server.js`
- recent context filtering:
  - `/Users/doosam/.codex/worktrees/32fa/desktop-ai-native-runtime/apps/runtime/session/contextBuilder.js`

If heartbeat is implemented as a plain user message, then:

- the heartbeat poll text pollutes conversation history
- the assistant heartbeat result becomes future prompt context
- desktop awareness starts to bias normal dialogue

This means heartbeat needs either:

- a dedicated heartbeat mode with special persistence handling, or
- a dedicated session separate from the normal desktop chat session

The first option is generally better for product coherence, but requires more careful implementation.

## How Heartbeat Should Be Used For Desktop Awareness

Heartbeat should be used as the decision layer of desktop awareness, not the sensing layer.

The recommended conceptual split is:

`desktop sensing -> event normalization -> heartbeat decision -> desktop feedback`

### Layer 1: Desktop Sensing

The desktop process should collect low-frequency, stable signals such as:

- active application changed
- user idle or active state
- unread notification count crossed threshold
- background task completed
- clipboard changed
- file generation completed
- foreground app dwell time exceeded a threshold

These signals should not go directly into the model as raw logs.

### Layer 2: Event Normalization

Signals should be converted into structured observations, for example:

- `type=foreground_app_changed`
- `app=Cursor`
- `duration_ms=420000`
- `ts=...`

This keeps prompt cost under control and prevents the heartbeat loop from reasoning over noisy raw desktop state.

### Layer 3: Heartbeat Decision

Heartbeat should periodically consume:

- recent normalized desktop observations
- optional per-session desktop state summary
- optional policy instructions from a heartbeat-specific prompt

Then it decides:

- whether anything deserves user attention
- whether the output should be silent
- whether it should use chat bubble, chat panel, voice, or no output

This is where the OpenClaw heartbeat pattern fits naturally.

### Layer 4: Desktop Feedback

If heartbeat produces a meaningful result:

- send `runtime.final`
- render through existing chat and bubble path
- optionally trigger TTS through the existing voice path

If heartbeat returns the equivalent of `HEARTBEAT_OK`:

- suppress the output
- optionally log only a debug event

## Why Heartbeat Is A Good Fit For Desktop Awareness

Heartbeat is a good fit for desktop awareness when the product problem is:

- deciding when to interrupt
- summarizing ambient state
- following up on background events
- turning scattered signals into a single user-facing reminder

Examples:

- "You have stayed in the same editor for 45 minutes without switching context."
- "The background generation job finished."
- "You have been idle long enough to summarize current work state."
- "Unread notifications crossed a threshold."
- "Tests finished with failures and now is a good moment to surface them."

These are attention-management problems, not realtime-control problems.

## What Heartbeat Is Not Good For

Heartbeat is a poor fit for:

- sub-second realtime reactions
- window drag or pointer movement
- lipsync and animation timing
- continuous visual monitoring
- high-frequency OS event handling

Those cases need event-driven or streaming mechanisms, not periodic reasoning loops.

## Recommended Implementation Direction

### Recommendation 1: Put Heartbeat In Gateway Or Runtime, Not Renderer

Business heartbeat should not live in the renderer.

Reason:

- renderer lifecycle is unstable
- window hidden or closed would kill the mechanism
- perception policy belongs to the runtime side, not the presentation side

Desktop-side sensing may still live in Electron main, but scheduling and decision should live on the gateway/runtime side.

### Recommendation 2: Introduce A Heartbeat Mode Instead Of Faking User Chat

A robust implementation should add explicit heartbeat metadata, for example:

- `mode=heartbeat`
- `reason=interval|desktop-event|job-complete`
- `source=desktop-awareness`

This metadata should control:

- prompt assembly
- persistence filtering
- ack suppression
- UI delivery policy

### Recommendation 3: Add An Observation Inbox

The cleanest model is not "heartbeat reads the desktop directly".

Instead:

- Electron main collects observations
- gateway stores them in a per-session observation inbox
- heartbeat periodically drains or samples that inbox

This decouples sensing cadence from reasoning cadence.

### Recommendation 4: Skip Or Coalesce When Busy

The current runtime has a single queue boundary.

So heartbeat should not compete equally with foreground user requests.

OpenClaw's pattern is the correct one here:

- if foreground requests are in flight, skip
- coalesce repeated wakes
- retry later

Without this, desktop heartbeat becomes a source of queue noise and perceived lag.

### Recommendation 5: Suppress Quiet Runs

Desktop awareness becomes annoying very quickly if every poll creates UI output.

A heartbeat design for desktop must support:

- an ack token or semantic quiet result
- suppression of empty or low-value runs
- optional duplicate suppression

Otherwise the desktop pet will feel noisy rather than aware.

## Suggested Minimum Viable Shape

The smallest viable version in this repository would look like this:

1. Electron main emits normalized desktop observations to gateway.
2. Gateway stores them per session in a lightweight inbox.
3. Gateway starts a heartbeat scheduler.
4. Scheduler checks queue state before triggering.
5. Heartbeat run injects desktop observations plus a heartbeat prompt.
6. If the result is quiet, suppress it.
7. If the result is meaningful, reuse existing `runtime.final` and optional voice playback path.

This is enough to validate whether heartbeat can produce useful desktop awareness without overfitting the full OpenClaw implementation.

## Final Assessment

Using heartbeat to implement desktop awareness is feasible and architecturally coherent, but only if heartbeat is used as an attention and decision loop.

The correct mental model is:

- sensing happens on the desktop side
- reasoning happens in the heartbeat loop
- delivery happens through the existing desktop runtime output path

The main danger is not technical inability. The main danger is session pollution and over-triggering.

So the first implementation should prioritize:

- explicit heartbeat mode
- observation normalization
- queue-aware scheduling
- quiet-run suppression
- persistence isolation from normal chat history
