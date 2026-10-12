# Skills Runtime Implementation

## 1. Scope

The skills runtime is integrated into current runtime flow and provides:

- multi-source skill discovery and merge
- frontmatter-based eligibility gates
- trigger-based skill selection
- prompt budget clipping
- per-session snapshot cache
- watcher and telemetry

## 2. Delivered Modules

- `config/skills.yaml`
- `apps/runtime/skills/runtimePaths.js`
- `apps/runtime/skills/skillConfigStore.js`
- `apps/runtime/skills/frontmatter.js`
- `apps/runtime/skills/skillLoader.js`
- `apps/runtime/skills/skillEligibility.js`
- `apps/runtime/skills/skillSelector.js`
- `apps/runtime/skills/skillPromptBudgeter.js`
- `apps/runtime/skills/skillSnapshotStore.js`
- `apps/runtime/skills/skillWatcher.js`
- `apps/runtime/skills/skillTelemetry.js`
- `apps/runtime/skills/skillRuntimeManager.js`

Integration points:

- `apps/runtime/loop/toolLoopRunner.js` (inject skill prompt into system messages)
- `apps/gateway/server.js` (runtime manager wiring)

## 3. Key Runtime Rules

1. Source precedence:
- `workspace/skills` > `~/yachiyo/skills` > `extraDirs`

2. Hard eligibility before selection:
- disabled/env/bin/config/os checks

3. Trigger selection:
- score threshold + cooldown + risk gate

4. Prompt safety:
- bounded by count and chars

5. Observability:
- JSONL telemetry under `~/yachiyo/logs/skills-telemetry.jsonl`

## 4. Documentation Links

- Module-level spec:
  - `docs/modules/runtime/skills-runtime.md`
- Practical smoke skill:
  - `docs/testing/TEST_SKILL_SMOKE_GUIDE.md`
- Combined runtime usage cases:
  - `docs/guides/RUNTIME_FEATURE_USAGE_CASES.md`

## 5. Validation

Use:

```bash
npm test
```

Skills-related test coverage:

- `test/runtime/skills/runtimePaths.test.js`
- `test/runtime/skills/skillConfigStore.test.js`
- `test/runtime/skills/skillLoader.test.js`
- `test/runtime/skills/skillEligibility.test.js`
- `test/runtime/skills/skillSelector.test.js`
- `test/runtime/skills/skillPromptBudgeter.test.js`
- `test/runtime/skills/skillSnapshotStore.test.js`
- `test/runtime/skills/skillWatcher.test.js`
- `test/runtime/skills/skillTelemetry.test.js`
- `test/runtime/skills/skillRuntimeManager.test.js`
- `test/runtime/skills/repoTestSkill.test.js`

## 6. Follow-up

1. Command-dispatch from skill directives to tool executor.
2. Per-skill approval policy integration (`safe/review/danger`).
3. API endpoints for skills diagnostics and snapshot introspection.
