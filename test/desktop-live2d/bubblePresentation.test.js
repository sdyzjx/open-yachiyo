const test = require('node:test');
const assert = require('node:assert/strict');
const { truncateLines } = require('../../apps/desktop-live2d/renderer/bubblePresentation');

test('TC-DSK-016 long bubble text truncates by Unicode character and exposes the chat hint state', () => {
  const result = truncateLines([{ id: 'a', text: '月'.repeat(200) }], 180);
  assert.equal(Array.from(result.lines[0].text).length, 181);
  assert.equal(result.lines[0].text.endsWith('…'), true);
  assert.equal(result.truncated, true);
  assert.deepEqual(truncateLines([{ id: 'a', text: '晚上好' }], 180), {
    lines: [{ id: 'a', text: '晚上好' }], truncated: false
  });
});
