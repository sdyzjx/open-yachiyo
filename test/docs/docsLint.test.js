const test = require('node:test');
const assert = require('node:assert/strict');
const { lintDocs } = require('../../scripts/docs-lint');

test('docs follow AGENT.md naming, header, section and TC-id rules', () => {
  const problems = lintDocs();
  assert.deepEqual(problems.map((p) => `${p.file}: ${p.message}`), []);
});
