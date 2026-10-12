const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', '..', 'apps', 'gateway', 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

test('TC-CFG-006 config-v2 page uses the shared night theme and has four pages', () => {
  const html = read('config-v2.html');
  assert.match(html, /href="\/theme\/yachiyo-theme\.css"/);
  assert.match(html, /rel="icon" href="data:,"/);
  for (const page of ['overview', 'models', 'voice', 'advanced']) {
    assert.match(html, new RegExp(`data-page="${page}"`));
  }
  assert.doesNotMatch(html, /config\.html/);
  for (const file of fs.readdirSync(PUBLIC).filter((f) => /^config-v2.*\.js$/.test(f))) {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file);
  }
  const css = read('config-v2.css');
  assert.equal(/#[0-9a-f]{6}\b/i.test(css), false, 'colors must come from --y-* tokens');
});

test('TC-CFG-007 legacy config.html only redirects; providers.yaml has no raw editor', () => {
  const legacy = read('config.html');
  assert.match(legacy, /\/config-v2\.html/);
  assert.equal(fs.existsSync(path.join(PUBLIC, 'config.js')), false);
  const advanced = read('config-v2-advanced.js');
  assert.doesNotMatch(advanced, /providers\/(raw|config)/);
  assert.doesNotMatch(advanced, /id: 'providers'/);
});

test('TC-CFG-016 overview loads model, voice and device status with quick links', () => {
  const overview = read('config-v2-overview.js');
  for (const endpoint of ['/api/config/models', '/api/config/voice', '/api/device/devices']) {
    assert.match(overview, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  for (const page of ['#models', '#voice', '#advanced']) assert.match(overview, new RegExp(page));
  for (const label of ['当前模型', '语音合成', '语音识别', '设备连接']) assert.match(overview, new RegExp(label));
});
