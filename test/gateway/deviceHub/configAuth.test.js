const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../../../apps/gateway/deviceHub/config');
const { fixture } = require('./helpers');

test('Pairing config persists a private random token and does not log it twice', () => {
  const home = fs.mkdtempSync(path.join(__dirname, '.config-'));
  try {
    const messages = [];
    const first = loadConfig({ home, log: (msg) => messages.push(msg) });
    const second = loadConfig({ home, log: (msg) => messages.push(msg) });
    assert.match(first.pairing_token, /^[a-f0-9]{48}$/); assert.equal(second.pairing_token, first.pairing_token);
    assert.equal(messages.length, 1);
    assert.equal(fs.statSync(path.join(home, 'config/device-hub.yaml')).mode & 0o777, 0o600);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Remote HTTP auth rejects proxy spoofing and pairing remains localhost-only', async (t) => {
  const f = await fixture(t);
  f.server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: '192.0.2.10' }));
  assert.equal((await fetch(`${f.base}/api/device/devices`, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 403);
  assert.equal((await fetch(`${f.base}/api/device/devices`, { headers: { authorization: 'Bearer test-token' } })).status, 200);
  assert.equal((await fetch(`${f.base}/api/device/devices?token=test-token`)).status, 200);
  assert.equal((await fetch(`${f.base}/api/device/pairing?token=test-token`)).status, 403);
});
