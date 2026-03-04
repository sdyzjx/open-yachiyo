const test = require('node:test');
const assert = require('node:assert/strict');

const { SkillSelector } = require('../../../apps/runtime/skills/skillSelector');

function mk(name, description = '') {
  return { name, description };
}

test('SkillSelector selects explicit skill with highest priority', () => {
  const selector = new SkillSelector({ now: () => 1000 });
  const result = selector.select({
    skills: [mk('weather'), mk('shell')],
    input: 'hello',
    triggerConfig: {
      explicitSkills: ['shell'],
      scoreThreshold: 10,
      maxSelectedPerTurn: 2,
      cooldownMs: 0,
      entries: {}
    }
  });

  assert.equal(result.selected[0].name, 'shell');
});

test('SkillSelector enforces threshold and maxSelectedPerTurn', () => {
  const selector = new SkillSelector({ now: () => 1000 });
  const result = selector.select({
    skills: [mk('write_file', 'write file'), mk('shell', 'run shell')],
    input: 'please run shell and write file',
    triggerConfig: {
      scoreThreshold: 20,
      maxSelectedPerTurn: 1,
      cooldownMs: 0,
      rules: {
        shell: { keywords: ['shell'] },
        write_file: { keywords: ['write file'] }
      },
      entries: {}
    }
  });

  assert.equal(result.selected.length, 1);
});

test('SkillSelector applies cooldown and risk blocks', () => {
  let now = 1000;
  const selector = new SkillSelector({ now: () => now });

  const cfg = {
    scoreThreshold: 0,
    maxSelectedPerTurn: 2,
    cooldownMs: 10000,
    entries: {
      danger_skill: { risk: 'danger' }
    }
  };

  const first = selector.select({
    skills: [mk('safe_skill'), mk('danger_skill')],
    input: 'safe_skill danger_skill',
    triggerConfig: cfg
  });

  assert.equal(first.selected.some((s) => s.name === 'safe_skill'), true);
  assert.equal(first.selected.some((s) => s.name === 'danger_skill'), false);

  now = 5000;
  const second = selector.select({
    skills: [mk('safe_skill')],
    input: 'safe_skill',
    triggerConfig: cfg
  });
  assert.equal(second.selected.length, 0);
  assert.equal(second.dropped.some((d) => d.reason === 'cooldown'), true);
});

test('SkillSelector can match Chinese intent text to English skill descriptions', () => {
  const selector = new SkillSelector({ now: () => 1000 });
  const result = selector.select({
    skills: [
      mk('apple-events-music', 'Control Apple Music: play/pause, next, playlist'),
      mk('weather', 'Get weather forecast')
    ],
    input: '帮我播放一首音乐',
    triggerConfig: {
      scoreThreshold: 20,
      maxSelectedPerTurn: 2,
      cooldownMs: 0,
      entries: {}
    }
  });

  assert.equal(result.selected.some((s) => s.name === 'apple-events-music'), true);
});

test('SkillSelector supports aliases from config entries', () => {
  const selector = new SkillSelector({ now: () => 1000 });
  const result = selector.select({
    skills: [mk('apple-events-music', 'Control Apple Music')],
    input: '请用音乐控制技能来播放歌单',
    triggerConfig: {
      scoreThreshold: 20,
      maxSelectedPerTurn: 1,
      cooldownMs: 0,
      entries: {
        'apple-events-music': {
          aliases: ['音乐控制技能']
        }
      }
    }
  });

  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, 'apple-events-music');
});
