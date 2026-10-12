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
  assert.match(html, /placeholder="对八千代说点什么…"/);
  assert.doesNotMatch(html, /placeholder="[^"]*(?:Enter|Shift\+Enter)/);
  assert.match(script, /if \(event\.shiftKey\) return;/);
  assert.match(script, /sendChatInput/);
  assert.match(html, /id="chat-image-input" type="file" accept="image\/\*" multiple/);
});

test('TC-DSK-017 toolbar uses two roomy rows and never overlays transfer status', () => {
  assert.match(html, /class="chat-title-row"/);
  assert.match(html, /class="chat-toolbar"/);
  assert.match(html, /class="toolbar-actions"/);
  assert.match(html, /\.chat-toolbar \{[^}]*gap: 8px/);
  assert.match(html, /\.toolbar-select \{[^}]*height: 32px/);
  assert.match(html, /id="transfer-status" class="visually-hidden"/);
  assert.doesNotMatch(html, /#transfer-status \{[^}]*top:/);
  assert.match(script, /modelActiveElement\.title = active \? `本次对话：\$\{modelLabel\(active\)\}`/);
  assert.match(script, /model_ref: state\.selectedModelRef/);
});

test('TC-DSK-018 composer grows to six lines and preserves readable send states', () => {
  assert.match(html, /#chat-input \{[^}]*max-height: 142px/);
  assert.match(html, /#chat-composer-input-row \{[^}]*align-items: center/);
  assert.match(html, /#chat-send:disabled \{/);
  assert.match(script, /const MAX_COMPOSER_HEIGHT = 142;/);
  assert.match(script, /Math\.min\(MAX_COMPOSER_HEIGHT, chatInputElement\.scrollHeight\)/);
});

test('TC-DSK-019 message rows provide avatar, alignment, hover time, and compact width', () => {
  assert.match(html, /\.chat-message \{ max-width: 78%/);
  assert.match(html, /\.chat-message-row\.user \{ justify-content: flex-end/);
  assert.match(html, /\.chat-message-avatar \{[^}]*var\(--y-gold-line\)/);
  assert.match(html, /\.chat-message-row:hover \.chat-message-time/);
  assert.match(script, /createMessageFrame\('assistant', Date\.now\(\)\)/);
  assert.match(script, /avatar\.textContent = '八'/);
});
