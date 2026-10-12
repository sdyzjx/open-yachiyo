const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { loadConfig } = require('../../../apps/gateway/deviceHub/config');
const { APPASSETS_ORIGIN, appassetsCors, remoteApiAuth } = require('../../../apps/gateway/deviceHub/accessControl');
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

test('Remote management APIs require pairing auth and appassets CORS supports preflight', async (t) => {
  const app = express();
  app.use(appassetsCors);
  app.use('/api', remoteApiAuth('test-token'));
  app.use('/debug', remoteApiAuth('test-token'));
  app.get('/api/config/providers/config', (req, res) => res.json({ ok: true }));
  app.get('/api/config/models', (req, res) => res.json({ ok: true }));
  app.get('/api/device/devices', (req, res) => res.json({ ok: true }));
  app.get('/api/sessions', (req, res) => res.json({ ok: true }));
  app.get('/debug/stream', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: '192.0.2.10' }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/api/config/providers/config`)).status, 403);
  assert.equal((await fetch(`${base}/debug/stream`)).status, 403);
  assert.equal((await fetch(`${base}/api/sessions`, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 403);
  assert.equal((await fetch(`${base}/api/sessions`, { headers: { authorization: 'Bearer test-token' } })).status, 200);
  assert.equal((await fetch(`${base}/api/sessions?token=test-token`)).status, 200);

  const preflight = await fetch(`${base}/api/config/models`, {
    method: 'OPTIONS',
    headers: { origin: APPASSETS_ORIGIN, 'access-control-request-headers': 'authorization,content-type' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), APPASSETS_ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);

  const models = await fetch(`${base}/api/config/models`, {
    headers: { origin: APPASSETS_ORIGIN, authorization: 'Bearer test-token' }
  });
  assert.equal(models.status, 200);
  assert.equal(models.headers.get('access-control-allow-origin'), APPASSETS_ORIGIN);
  const device = await fetch(`${base}/api/device/devices?token=test-token`, { headers: { origin: APPASSETS_ORIGIN } });
  assert.equal(device.headers.get('access-control-allow-origin'), APPASSETS_ORIGIN);
  const foreign = await fetch(`${base}/api/config/models?token=test-token`, { headers: { origin: 'https://example.invalid' } });
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
});

test('Remote runtime websocket cannot bypass pairing authentication', async (t) => {
  const f = await fixture(t);
  f.server.prependListener('upgrade', (req) => Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: '192.0.2.10' }));
  const denied = new WebSocket(`${f.base.replace('http', 'ws')}/ws`);
  const [, response] = await once(denied, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  response.resume();

  const allowed = new WebSocket(`${f.base.replace('http', 'ws')}/ws?token=test-token`);
  assert.equal(String((await once(allowed, 'message'))[0]), 'legacy');
  allowed.close();
});
