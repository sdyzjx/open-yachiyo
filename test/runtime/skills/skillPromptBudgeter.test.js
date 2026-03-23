const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatSkillsForPrompt,
  clipSkillsForPrompt
} = require('../../../apps/runtime/skills/skillPromptBudgeter');

function mk(name, desc = 'd', filePath = `/tmp/${name}/SKILL.md`) {
  return { name, description: desc, filePath };
}

test('formatSkillsForPrompt renders xml-like block', () => {
  const text = formatSkillsForPrompt([mk('a')]);
  assert.match(text, /<available_skills>/);
  assert.match(text, /<name>a<\/name>/);
});

test('formatSkillsForPrompt includes script body for injectScript skills', () => {
  const text = formatSkillsForPrompt([{
    ...mk('sonder'),
    injectScript: true,
    body: '# Sonder\n\nStrict script body'
  }]);
  assert.match(text, /<script><!\[CDATA\[/);
  assert.match(text, /Strict script body/);
});

test('clipSkillsForPrompt clips by count', () => {
  const skills = [mk('a'), mk('b'), mk('c')];
  const out = clipSkillsForPrompt(skills, { maxSkillsInPrompt: 2, maxSkillsPromptChars: 99999 });
  assert.equal(out.selected.length, 2);
  assert.equal(out.clippedBy, 'count');
});

test('clipSkillsForPrompt clips by chars with binary search', () => {
  const skills = [
    mk('a', 'x'.repeat(1200)),
    mk('b', 'x'.repeat(1200)),
    mk('c', 'x'.repeat(1200))
  ];
  const out = clipSkillsForPrompt(skills, { maxSkillsInPrompt: 3, maxSkillsPromptChars: 1000 });
  assert.equal(out.clippedBy, 'chars');
  assert.ok(out.selected.length < 3);
  assert.ok(out.prompt.length <= 450);
});
