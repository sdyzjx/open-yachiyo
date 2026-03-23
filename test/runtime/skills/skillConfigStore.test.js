const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SkillConfigStore,
  normalizeSkillsConfig
} = require('../../../apps/runtime/skills/skillConfigStore');

test('SkillConfigStore loads and normalizes config/skills.yaml', () => {
  const store = new SkillConfigStore({
    configPath: path.resolve(process.cwd(), 'config/skills.yaml')
  });

  const cfg = store.load();
  assert.equal(cfg.version, 1);
  assert.equal(cfg.home.envKey, 'YACHIYO_HOME');
  assert.equal(cfg.load.workspace, true);
  assert.equal(cfg.load.global, true);
  assert.ok(cfg.limits.maxSkillsPromptChars > 0);
  assert.ok(cfg.trigger && typeof cfg.trigger === 'object');
  assert.ok(cfg.trigger.rules && typeof cfg.trigger.rules === 'object');
  assert.ok(cfg.defaults && typeof cfg.defaults === 'object');
  assert.deepEqual(cfg.defaults.sessionSkills, { enabled: false, names: [] });
});

test('normalizeSkillsConfig throws on invalid root', () => {
  assert.throws(() => normalizeSkillsConfig(null), /root must be an object/);
});

test('SkillConfigStore supports custom file path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-config-'));
  const cfgPath = path.join(tmpDir, 'skills.yaml');
  fs.writeFileSync(
    cfgPath,
    [
      'version: 1',
      'home:',
      '  envKey: YACHIYO_HOME',
      '  defaultPath: ~/yachiyo',
      'load:',
      '  workspace: true',
      '  global: true',
      '  extraDirs: []',
      'limits:',
      '  maxCandidatesPerRoot: 10',
      '  maxSkillsLoadedPerSource: 5',
      '  maxSkillsInPrompt: 2',
      '  maxSkillsPromptChars: 3000',
      '  maxSkillFileBytes: 4096',
      'trigger:',
      '  mode: hybrid',
      '  maxSelectedPerTurn: 1',
      '  scoreThreshold: 40',
      '  cooldownMs: 1000',
      '  rules:',
      '    apple-events-music:',
      '      keywords: [music, playlist, 播放]',
      'defaults:',
      '  sessionSkills:',
      '    enabled: true',
      '    names: [sonder]',
      'entries: {}'
    ].join('\n'),
    'utf8'
  );

  const store = new SkillConfigStore({ configPath: cfgPath });
  const cfg = store.load();

  assert.equal(cfg.limits.maxSkillsInPrompt, 2);
  assert.equal(cfg.trigger.maxSelectedPerTurn, 1);
  assert.deepEqual(cfg.trigger.rules['apple-events-music'].keywords, ['music', 'playlist', '播放']);
  assert.equal(cfg.defaults.sessionSkills.enabled, true);
  assert.deepEqual(cfg.defaults.sessionSkills.names, ['sonder']);
});
