const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/renderer/chat.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/renderer/chat.js'), 'utf8');

test('TC-DSK-014 chat chrome is Chinese, token-based, and keeps toolbar labels on one line', () => {
  assert.match(html, /yachiyo-theme\.css/);
  assert.match(html, />送到手机</);
  assert.match(html, /title="新对话"/);
  assert.match(html, /title="设置"/);
  assert.match(html, /button \{ white-space: nowrap; \}/);
  assert.doesNotMatch(html, />Send</);
  assert.doesNotMatch(html, /Type message/);
});

test('TC-DSK-014 composer is multiline and sends Enter while preserving Shift+Enter', () => {
  assert.match(html, /<textarea id="chat-input"/);
  assert.match(script, /if \(event\.shiftKey\) return;/);
  assert.match(script, /sendChatInput/);
  assert.match(html, /id="chat-image-input" type="file" accept="image\/\*" multiple/);
});
