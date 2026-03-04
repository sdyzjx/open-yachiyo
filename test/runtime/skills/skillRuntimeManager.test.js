const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SkillRuntimeManager } = require('../../../apps/runtime/skills/skillRuntimeManager');

function writeSkill(root, name, desc, extra = '') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\n# ${name}\n`,
    'utf8'
  );
}

test('SkillRuntimeManager builds selected prompt context', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rt-'));
  const workspace = path.join(tmp, 'ws');
  const yhome = path.join(tmp, 'yachiyo');
  const wskills = path.join(workspace, 'skills');
  fs.mkdirSync(wskills, { recursive: true });

  writeSkill(wskills, 'shell', 'run shell safely');
  writeSkill(wskills, 'weather', 'get weather report');

  const old = process.env.YACHIYO_HOME;
  process.env.YACHIYO_HOME = yhome;

  try {
    const manager = new SkillRuntimeManager({
      workspaceDir: workspace,
      configStore: {
        load() {
          return {
            home: { envKey: 'YACHIYO_HOME', defaultPath: '~/yachiyo' },
            load: { workspace: true, global: false, extraDirs: [] },
            limits: { maxCandidatesPerRoot: 100, maxSkillsLoadedPerSource: 50, maxSkillsInPrompt: 2, maxSkillsPromptChars: 2000, maxSkillFileBytes: 262144 },
            trigger: { scoreThreshold: 10, maxSelectedPerTurn: 1, cooldownMs: 0 },
            entries: {},
            tools: { exec: { enabled: true } }
          };
        }
      }
    });

    const ctx = manager.buildTurnContext({ input: 'please run shell command' });
    assert.equal(Array.isArray(ctx.selected), true);
    assert.equal(ctx.selected.length, 1);
    assert.match(ctx.prompt, /available_skills/);
  } finally {
    if (old === undefined) delete process.env.YACHIYO_HOME;
    else process.env.YACHIYO_HOME = old;
  }
});

test('SkillRuntimeManager extracts explicit skills from $skill markers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rt-explicit-'));
  const workspace = path.join(tmp, 'ws');
  const yhome = path.join(tmp, 'yachiyo');
  const wskills = path.join(workspace, 'skills');
  fs.mkdirSync(wskills, { recursive: true });

  writeSkill(wskills, 'weather', 'get weather report');

  const old = process.env.YACHIYO_HOME;
  process.env.YACHIYO_HOME = yhome;

  try {
    const manager = new SkillRuntimeManager({
      workspaceDir: workspace,
      configStore: {
        load() {
          return {
            home: { envKey: 'YACHIYO_HOME', defaultPath: '~/yachiyo' },
            load: { workspace: true, global: false, extraDirs: [] },
            limits: { maxCandidatesPerRoot: 100, maxSkillsLoadedPerSource: 50, maxSkillsInPrompt: 2, maxSkillsPromptChars: 2000, maxSkillFileBytes: 262144 },
            trigger: { scoreThreshold: 90, maxSelectedPerTurn: 1, cooldownMs: 0, rules: {} },
            entries: {},
            tools: { exec: { enabled: true } }
          };
        }
      }
    });

    const ctx = manager.buildTurnContext({ input: '请使用 $weather 技能' });
    assert.equal(ctx.selected.length, 1);
    assert.equal(ctx.selected[0], 'weather');
  } finally {
    if (old === undefined) delete process.env.YACHIYO_HOME;
    else process.env.YACHIYO_HOME = old;
  }
});

test('SkillRuntimeManager includes loaded skills for discovery query', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rt-discovery-'));
  const workspace = path.join(tmp, 'ws');
  const yhome = path.join(tmp, 'yachiyo');
  const gskills = path.join(yhome, 'skills');
  fs.mkdirSync(gskills, { recursive: true });

  writeSkill(gskills, 'apple-events-music', 'control Apple Music');

  const old = process.env.YACHIYO_HOME;
  process.env.YACHIYO_HOME = yhome;

  try {
    const manager = new SkillRuntimeManager({
      workspaceDir: workspace,
      configStore: {
        load() {
          return {
            home: { envKey: 'YACHIYO_HOME', defaultPath: '~/yachiyo' },
            load: { workspace: true, global: true, extraDirs: [] },
            limits: { maxCandidatesPerRoot: 100, maxSkillsLoadedPerSource: 50, maxSkillsInPrompt: 5, maxSkillsPromptChars: 5000, maxSkillFileBytes: 262144 },
            trigger: { scoreThreshold: 90, maxSelectedPerTurn: 1, cooldownMs: 0, rules: {} },
            entries: {},
            tools: { exec: { enabled: true } }
          };
        }
      }
    });

    const ctx = manager.buildTurnContext({ input: '你有什么skills' });
    assert.equal(ctx.selected.includes('apple-events-music'), true);
    assert.match(ctx.prompt, /apple-events-music/);
  } finally {
    if (old === undefined) delete process.env.YACHIYO_HOME;
    else process.env.YACHIYO_HOME = old;
  }
});
