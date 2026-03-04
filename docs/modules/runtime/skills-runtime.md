# Skills Runtime Module

## 1. Scope

This module doc describes the skills subsystem integrated into runtime planning:

- multi-source skill loading
- frontmatter parsing and eligibility filtering
- trigger selection and prompt budget clipping
- per-session snapshot cache
- file watch and telemetry
- runner prompt injection

Related files:

- `config/skills.yaml`
- `apps/runtime/skills/frontmatter.js`
- `apps/runtime/skills/runtimePaths.js`
- `apps/runtime/skills/skillConfigStore.js`
- `apps/runtime/skills/skillLoader.js`
- `apps/runtime/skills/skillEligibility.js`
- `apps/runtime/skills/skillSelector.js`
- `apps/runtime/skills/skillPromptBudgeter.js`
- `apps/runtime/skills/skillSnapshotStore.js`
- `apps/runtime/skills/skillWatcher.js`
- `apps/runtime/skills/skillTelemetry.js`
- `apps/runtime/skills/skillRuntimeManager.js`
- `apps/runtime/loop/toolLoopRunner.js`
- `apps/gateway/server.js`

## 2. Runtime Flow

1. Gateway initializes `SkillRuntimeManager`.
2. For each run, `ToolLoopRunner` calls `resolveSkillsContext({sessionId,input})`.
3. Manager computes turn context:
   - load skills
   - filter eligible
   - select relevant
   - clip prompt by limits
4. Runner injects generated skills prompt as system message.
5. Manager records snapshot and telemetry.

## 3. Module Contracts

## 3.1 `skillLoader.js`

- Skill source priority:
  - `workspace/skills` (highest)
  - `~/yachiyo/skills` (managed/global)
  - `load.extraDirs`
- valid skill entry requires `SKILL.md`.
- oversized files are ignored via `limits.maxSkillFileBytes`.

## 3.2 `frontmatter.js`

Parses `--- ... ---` header in `SKILL.md`, used for:
- `name`
- `description`
- runtime eligibility directives (csv-style fields).

## 3.3 `skillEligibility.js`

Eligibility gates:
- `entries.<skill>.enabled`
- `requires_env`
- `requires_bins` / `requires_any_bins`
- `requires_config`
- `os`

Output:
- accepted list
- dropped list with reasons

## 3.4 `skillSelector.js`

Hybrid score model:
- explicit skill hint boost
- name/keyword/description token matching
- aliases matching (`entries.<skill>.aliases` or frontmatter `aliases`)
- cross-locale intent tag matching (e.g. `播放音乐` -> `music`)
- risk-based penalty
- threshold + cooldown + max selected per turn

Explicit hint sources:
- `$skill-name` markers in user input
- `use <skill-name>` / `使用 <skill-name>` style mentions
- direct skill-name mention in plain text

Notes:
- explicit skills bypass cooldown gating for this turn
- danger-risk skills are still blocked by policy

## 3.5 `skillPromptBudgeter.js`

`clipSkillsForPrompt` enforces:
- `maxSkillsInPrompt`
- `maxSkillsPromptChars`

Clipping reason:
- `count` or `chars`.

## 3.6 `skillRuntimeManager.js`

Main orchestration entry:
- `buildTurnContext({sessionId,input})`

Returns:
- `prompt`
- `selected`
- `dropped`
- `clippedBy`

Side effects:
- snapshot cache write
- telemetry append

## 4. Configuration

Configured by `config/skills.yaml`.

Key sections:
- `home`: yachiyo home path resolution
- `load`: workspace/global/extra dirs + watch settings
- `limits`: candidate/loading/prompt bounds
- `trigger`: threshold/cooldown/selection caps
  - `trigger.rules.<skill>.keywords`: per-skill keyword boosts
- `entries`: per-skill overrides
  - `entries.<skill>.aliases`: per-skill alias boosts

## 5. Usage Cases

## Case A: workspace skill overrides global skill

1. Create same skill name in:
   - `~/yachiyo/skills/<name>/SKILL.md`
   - `<workspace>/skills/<name>/SKILL.md`
2. Trigger the skill in chat.

Expected:
- workspace version takes precedence.

## Case B: disable one skill by config

Add to `config/skills.yaml`:

```yaml
entries:
  test_skill_smoke:
    enabled: false
```

Expected:
- skill appears in dropped list with `disabled_by_config`.
- not injected into prompt.

## Case C: smoke-test skill trigger

Use repository skill:
- `skills/test_skill_smoke/SKILL.md`

Send:

```text
test_skill_smoke 请帮我做一次技能冒烟测试
```

Expected:
- skill selected and injected
- planner can call `get_time` / `echo`

## Case D: explicit marker bypasses high threshold

```text
请使用 $apple-events-music 播放歌单
```

Even with a high `scoreThreshold`, `$apple-events-music` is treated as explicit and selected.

## Case E: natural-language trigger with rules/aliases

Example config:

```yaml
trigger:
  rules:
    apple-events-music:
      keywords: [music, playlist, 播放, 音乐]
entries:
  apple-events-music:
    aliases: [音乐控制技能, 播歌技能]
```

Input:

```text
帮我播放一首音乐
```

Expected:
- selector can match `apple-events-music` without requiring direct skill-name mention.

## 6. Observability

Telemetry file:
- `~/yachiyo/logs/skills-telemetry.jsonl`

Common events:
- `skills.turn`
- `skills.bump`

## 7. Test Mapping

- `test/runtime/skills/runtimePaths.test.js`
- `test/runtime/skills/skillConfigStore.test.js`
- `test/runtime/skills/skillLoader.test.js`
- `test/runtime/skills/skillEligibility.test.js`
- `test/runtime/skills/skillSelector.test.js`
- `test/runtime/skills/skillPromptBudgeter.test.js`
- `test/runtime/skills/skillRuntimeManager.test.js`
- `test/runtime/skills/skillSnapshotStore.test.js`
- `test/runtime/skills/skillWatcher.test.js`
- `test/runtime/skills/skillTelemetry.test.js`
- `test/runtime/skills/repoTestSkill.test.js`
- `test/runtime/toolLoopRunner.test.js` (skills prompt injection)
