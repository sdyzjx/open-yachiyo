# Live2D Action Pipeline Operation & Rollback Guide

## 1. Message Contract

Runtime -> desktop action event topic:

- `ui.live2d.action`

Payload:

```json
{
  "action_id": "act-uuid",
  "action": {
    "type": "expression",
    "name": "smile",
    "args": {}
  },
  "duration_sec": 1.8,
  "queue_policy": "append"
}
```

Supported `action.type`:

- `expression`
- `motion`
- `gesture`
- `emote`
- `react`

Supported `queue_policy`:

- `append`
- `replace`
- `interrupt`

## 2. Queue and Mutex Behavior

- Queue is FIFO by default.
- `replace` clears pending queue and keeps current action.
- `interrupt` clears pending queue and interrupts current waiting duration.
- Queue has max length protection (`maxQueueSize`) with overflow policy:
  - `drop_oldest`
  - `drop_newest`
  - `reject`
- Action execution is protected by a shared mutex to avoid conflicts between:
  - queued actions (`live2d.action.enqueue`)
  - direct RPC actions (`model.expression.set` / `model.motion.play`)

## 3. Semantic Action Mapping

Semantic actions are resolved by `config/live2d-presets.yaml`:

- `emote` -> expression + optional param batch
- `gesture` -> expression + motion
- `react` -> step sequence (`expression` / `motion` / `wait` / `param_batch`)

Duration priority:

- `payload.duration_sec` overrides default duration
- fallback duration is applied per action type by runtime adapter

## 4. Telemetry and Debug Stream

Renderer queue emits telemetry events:

- `enqueue`
- `drop`
- `start`
- `done`
- `fail`

Desktop main additionally emits:

- `ack` when enqueue RPC is accepted

Telemetry is forwarded through `desktop.event` with:

- `type: "live2d.action.telemetry"`
- `data.event` in `enqueue|drop|start|done|fail|ack`

## 5. Troubleshooting

- `invalid_payload` during forwarding:
  - verify `duration_sec` in `(0,120]`
  - verify `queue_policy` in `append|replace|interrupt`
  - verify `action.type` and `name` are valid
- `preset not found` for semantic action:
  - check `config/live2d-presets.yaml`
  - ensure key exists for `gesture.type` / `emote.emotion` / `react.intent`
- actions dropped under load:
  - check queue overflow policy (`drop_oldest` / `drop_newest` / `reject`)
  - inspect telemetry `drop` events

## 6. Rollback

If you need to disable the queue/event pipeline quickly:

1. Revert commits introducing Phase C/D/E changes on current branch.
2. Keep only Phase A/B baseline (`ui.live2d.action` + basic expression/motion queue playback).
3. Validate with:
   - `node --test test/runtime/live2dAdapter.test.js`
   - `node --test test/desktop-live2d/live2dActionQueuePlayer.test.js test/desktop-live2d/desktopSuite.test.js`
4. Confirm desktop can still process `expression`/`motion` actions.
