# Test Skill Smoke Guide

## Skill
- Path: `skills/test_skill_smoke/SKILL.md`
- Name: `test_skill_smoke`

## Goal
Quickly verify the runtime can:
1. load workspace skills
2. select a skill by user input
3. execute tools under normal planner flow

## Manual verification

1. Start server:
```bash
npm run dev
```

2. In chat UI, send a message that explicitly includes:
```text
test_skill_smoke 请帮我做一次技能冒烟测试
```

3. Expected behavior:
- runtime status should show normal run lifecycle
- assistant output should include a short smoke-test summary
- tool call path should run (`get_time` and optional `echo`)

## Automated verification

Run:
```bash
npm test
```

Relevant tests:
- `test/runtime/skills/repoTestSkill.test.js`
- existing `test/runtime/skills/*.test.js`
