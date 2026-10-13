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

test('TC-DSK-026 desktop chat exposes session approval policy and pending decisions', () => {
  assert.match(html, /id="session-control-toggle"/);
  assert.match(html, /data-session-mode="manual"/);
  assert.match(html, /data-session-mode="auto_approve"/);
  assert.match(html, /data-session-mode="full_access"/);
  assert.match(html, /backdrop-filter: blur\(28px\)/);
  assert.match(script, /sessionControlRequest\(\{ action: 'get' \}\)/);
  assert.match(script, /action: 'set_approval_mode'/);
  assert.match(script, /action: 'decide_approval'/);
  assert.match(script, /command\.textContent = request\.command/);
});

test('TC-DSK-027 desktop main process limits session controls to chat window IPC', () => {
  const suite = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/main/desktopSuite.js'), 'utf8');
  const preload = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/main/preload.js'), 'utf8');
  assert.match(suite, /event\?\.sender !== chatWindow\.webContents/);
  assert.match(suite, /action === 'get'/);
  assert.match(suite, /action === 'set_approval_mode'/);
  assert.match(suite, /action === 'decide_approval'/);
  assert.match(suite, /throw new Error\('unsupported session control action'\)/);
  assert.match(preload, /sessionControlRequest\(payload = \{\}\)/);
});

test('TC-DSK-028 desktop chat records PCM WAV and sends it with the selected model', () => {
  const suite = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/main/desktopSuite.js'), 'utf8');
  const preload = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/main/preload.js'), 'utf8');
  assert.match(html, /id="chat-mic"/);
  assert.match(html, /#chat-mic\.recording/);
  assert.match(script, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(script, /requestChatAudioPermission/);
  assert.match(script, /encodePcmWav\(capture\.chunks, capture\.sampleRate\)/);
  assert.match(script, /sendChatAudioInput/);
  assert.match(script, /model_ref: state\.selectedModelRef/);
  assert.match(preload, /chatAudioSubmit/);
  assert.match(preload, /chatAudioPermissionRequest/);
  assert.match(suite, /inputAudio: \{ audio_ref: file, format: 'wav'/);
  assert.match(suite, /DESKTOP_VOICE_INPUT_MAX_BYTES/);
});
