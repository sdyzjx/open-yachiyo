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

## What OpenClaw Wake Flow Is Worth Reusing

OpenClaw does not let every trigger directly run the model.

Its wake path is effectively:

`timer / cron / exec / hook -> requestHeartbeatNow -> wake coalescer -> runHeartbeatOnce`

The important reusable properties are:

- timers only request a wake; they do not directly run the heartbeat
- wake requests are coalesced by target
- wake reasons have different priorities
- if the main lane is busy, heartbeat backs off and retries later
- cron and exec first enqueue system events, then wake heartbeat

For `open-yachiyo`, this is the right shape to copy. A random scheduler, a daily scheduler, a fixed interval scheduler, and future desktop events should all feed the same wake entrance instead of each inventing its own execution path.

## Scheduling Requirements Mapped To A Concrete Model

The requested wake behavior can be modeled with three schedule types:

- `interval`
  - wake every `n` duration
- `daily_times`
  - wake every day at specific local times
- `random_window`
  - for each fixed window of size `x`, randomly wake `y` times, with at least `z` gap

### Why `random_window` Should Use Anchored Windows

For the random mode, the implementation should not use a rolling window.

It should use anchored windows, for example with timezone `Asia/Shanghai`:

- `00:00-06:00`
- `06:00-12:00`
- `12:00-18:00`
- `18:00-24:00`

Within each anchored window:

- generate `y` due times
- persist them
- ensure every adjacent pair respects `min_gap`
- consume them one by one

This makes the behavior restart-safe, explainable, and previewable.

Validation rules should include:

- `window > 0`
- `count >= 1`
- `min_gap >= 0`
- if `count > 1`, then `(count - 1) * min_gap <= window`

If the last rule fails, the scheduler must reject the config because the schedule is impossible to realize.

## Configuration Shape

The cleanest approach is to separate static config from runtime state:

- static config: `config/heartbeat.yaml`
- runtime state: `data/heartbeat-state.json`

The YAML should be the source of truth for jobs and policy.
The runtime state file should only store schedule execution state.

### Example `heartbeat.yaml`

```yaml
version: 1
defaults:
  timezone: Asia/Shanghai
  ack_token: HEARTBEAT_OK
  retry_on_busy: true
  retry_delay: 5m

jobs:
  - id: desktop-random-check
    enabled: true
    target:
      session_id: desktop-main
    schedule:
      type: random_window
      window: 6h
      count: 2
      min_gap: 90m
    context:
      rules_md: HEARTBEAT.md
      observations: inbox
    delivery:
      silent: true

  - id: desktop-fixed-summary
    enabled: true
    target:
      session_id: desktop-main
    schedule:
      type: daily_times
      times: ["09:00", "14:00", "21:30"]
    context:
      rules_md: HEARTBEAT.md
      observations: inbox
    delivery:
      silent: true

  - id: desktop-interval-check
    enabled: true
    target:
      session_id: desktop-main
    schedule:
      type: interval
      every: 2h
    context:
      rules_md: HEARTBEAT.md
      observations: inbox
    delivery:
      silent: true
```

### Runtime State

`heartbeat-state.json` should store fields such as:

- `job_id`
- `window_start_ms`
- `window_end_ms`
- `due_times_ms`
- `next_due_ms`
- `last_run_ms`
- `last_success_ms`
- `last_result`
- `retry_after_ms`
- `config_hash`

This is especially important for `random_window`, because the random due times should survive process restart.

## YAML Authoring And AI Editing

The product can present this as "AI can write heartbeat YAML", but the implementation should not let the model write files directly.

The safer pattern is:

- frontend supports raw YAML editing
- conversation uses a constrained tool call
- backend validates structured input
- backend renders canonical YAML and writes the file

That means the actual tool should be something like:

- `heartbeat.job.upsert`
- `heartbeat.job.remove`
- `heartbeat.config.preview`
- `heartbeat.config.import_yaml`

The important point is that tool arguments should be JSON with schema validation, not free-form file editing.

This keeps the configuration stable and reduces malformed edits.

## Silent Heartbeat As The First Stage

The new requirement is not just "periodically send a reminder".

It is closer to:

`wake -> silent perception run -> internal decision -> optional visible action`

This is the correct evolution of the design.

### Silent Perception Run

When the scheduler wakes a job, the first run should be a silent internal run:

- inject one or more rule markdown files
- inject recent observations
- inject available capability summary
- do not emit chat bubble
- do not emit TTS
- do not emit normal user-facing `runtime.final`

The purpose of this run is:

- perceive current environment
- infer what is actionable
- decide whether a next step should happen

This is conceptually similar to OpenClaw heartbeat, but more explicit about silent perception.

### Why A Dedicated Silent Mode Is Necessary

The current runtime already routes `runtime.final` into desktop presentation and voice passthrough.

If the silent perception run is not explicitly marked, it will accidentally:

- show internal reasoning to the user
- trigger bubble output
- trigger TTS passthrough
- pollute normal session history

So the implementation needs an explicit mode such as:

- `run_mode=heartbeat_silent`
- `heartbeat_job_id=<id>`
- `heartbeat_reason=interval|daily_time|random_window|manual|event`
- `delivery_policy=silent`

And this mode must affect:

- prompt assembly
- persistence behavior
- event delivery filtering
- tool policy

## Second Stage: Action Execution

The first stage should not directly act like a user-visible chat turn.

Instead, it should produce a structured internal decision.

Example decision shapes:

```json
{ "decision": "noop", "reason": "no_actionable_change" }
```

```json
{
  "decision": "notify_user",
  "channel": "bubble",
  "message": "编译完成了，要不要我帮你看一下错误摘要？"
}
```

```json
{
  "decision": "speak",
  "text": "测试已经跑完，我发现了两个失败项。"
}
```

```json
{
  "decision": "tool_call",
  "tool": "desktop.observe.snapshot",
  "args": {}
}
```

This creates a clean two-stage model:

- stage 1: understand and decide
- stage 2: execute and optionally become visible

### Why Two Stages Are Better

This split gives much tighter control over side effects.

It allows:

- silent background reasoning
- selective user interruption
- optional internal follow-up actions
- auditability of why a visible action happened

It also makes future guardrails easier, because high-side-effect tools can be kept out of the first stage.

## Markdown Rule Files

The rule markdown should be treated as heartbeat policy, not as user content.

Suggested files:

- `HEARTBEAT.md`
  - general heartbeat rules
- `DESKTOP_AWARENESS.md`
  - environment interpretation rules
- optional per-job markdown
  - special rules for one job

The content should define things like:

- when to stay silent
- when it is appropriate to interrupt
- what kind of changes count as meaningful
- when to wait for idle time
- when direct tool action is allowed
- when user-visible output is forbidden

The scheduler job should reference these markdown files as context sources rather than copying large prompt text into YAML.

## Observation Inbox

Heartbeat should not directly inspect the desktop on every wake.

Instead:

- Electron main collects low-frequency observations
- gateway stores them in a per-session inbox
- silent heartbeat reads and summarizes them

This keeps sensing and reasoning decoupled.

Suggested observation examples:

- active app changed
- foreground dwell exceeded threshold
- idle state entered or left
- notification count crossed threshold
- task completed
- file changed
- clipboard changed

These should be normalized before entering the inbox.

## Gateway-Side Daemon Design

The heartbeat mechanism should live in gateway, not renderer.

Recommended modules:

- `apps/gateway/heartbeat/heartbeatConfigStore.js`
  - load, validate, and save `heartbeat.yaml`
- `apps/gateway/heartbeat/heartbeatStateStore.js`
  - persist runtime state
- `apps/gateway/heartbeat/heartbeatScheduler.js`
  - compute next due jobs
- `apps/gateway/heartbeat/heartbeatWake.js`
  - coalesce and retry wake requests
- `apps/gateway/heartbeat/heartbeatRunner.js`
  - create synthetic silent runs
- `apps/gateway/heartbeat/observationInbox.js`
  - store normalized desktop observations

The scheduler daemon should:

- load config at boot
- compute next wake per job
- keep only one nearest timer armed
- on due, send a wake request instead of directly running the model
- support config hot reload

## Persistence And Context Isolation

This remains the largest architectural risk.

Heartbeat turns must not be stored as normal `user` and `assistant` messages and then replayed by `buildRecentContextMessages`.

For `open-yachiyo`, one of these must be done:

- store heartbeat runs in a separate event channel
- tag heartbeat messages and filter them out during normal context replay
- use a dedicated heartbeat session separate from the main chat session

The preferred option is tagged filtering because it preserves a coherent product identity while avoiding prompt pollution.

## Frontend And API Surface

The gateway already has a raw YAML config editing pattern, so heartbeat can plug into the same shape first.

Minimum APIs:

- `GET /api/config/heartbeat/raw`
- `PUT /api/config/heartbeat/raw`
- `GET /api/heartbeat/jobs`
- `POST /api/heartbeat/wake`
- `GET /api/heartbeat/preview`

Useful first UI features:

- raw YAML editor
- schedule type selector
- random window parameter editor
- daily time list editor
- next 24h wake preview
- last run result / next due display

The wake preview matters a lot for random schedules because users need to understand what the scheduler will do.

## Final Assessment

Using heartbeat to implement desktop awareness is feasible and architecturally coherent, but only if heartbeat is used as an attention and decision loop.

The correct mental model is:

- sensing happens on the desktop side
- reasoning happens in a silent heartbeat loop
- visible delivery happens only in a second-stage action path when needed

The main danger is not technical inability. The main danger is session pollution and over-triggering.

So the first implementation should prioritize:

- explicit scheduler model
- explicit wake coalescing
- explicit heartbeat mode
- explicit silent perception mode
- observation normalization
- queue-aware scheduling
- quiet-run suppression
- two-stage decision and action execution
- persistence isolation from normal chat history
