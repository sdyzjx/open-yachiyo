const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../apps/android/app/src/main/assets/web');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

test('TC-AND-053 phone chat selects a safe remote model and carries it on text and microphone input', () => {
  assert.match(html, /id="chat-model"/);
  assert.match(html, /id="active-model-badge"/);
  assert.match(html, /id="active-model-name"/);
  assert.match(html, /id="active-model-mode"/);
  assert.match(script, /B\.rpc\('model\.catalog\.get'/);
  assert.match(script, /B\.publish\('chat\.input', \{ text, model_ref:/);
  assert.match(script, /audio_mode: audioModeForSelectedModel\(\)/);
  assert.match(script, /model_ref: S\.selectedModelRef/);
  assert.match(script, /activeModelName\.textContent = active\?\.name/);
  assert.match(script, /activeModelBadge\.onclick = openChat/);
  assert.match(script, /function hubErrorMessage/);
  assert.match(script, /toast\(`识别失败：\$\{message\}`\)/);
  assert.doesNotMatch(script, /识别失败：\$\{d\.error\}/);
  assert.doesNotMatch(script, /api_key|enabled_models|\/api\/config\/models/);
});
