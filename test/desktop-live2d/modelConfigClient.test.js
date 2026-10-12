const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');

const {
  createModelConfigClient,
  normalizeRequest,
  sanitizeErrorMessage
} = require('../../apps/desktop-live2d/main/modelConfigClient');

test('desktop model config IPC accepts only the three renderer operations', () => {
  assert.deepEqual(normalizeRequest({ method: 'get', path: '/api/config/models' }), {
    method: 'GET', path: '/api/config/models', body: undefined
  });
  assert.throws(() => normalizeRequest({ method: 'GET', path: '/api/config/providers/config' }), /unsupported/);
  assert.throws(() => normalizeRequest({ method: 'DELETE', path: '/api/config/models' }), /unsupported/);
  assert.throws(() => normalizeRequest({ method: 'GET', path: '/api/config/models?token=secret' }), /unsupported/);
  assert.throws(() => normalizeRequest({ method: 'GET', path: '/api/config/models', body: {} }), /does not accept/);
  assert.throws(() => normalizeRequest({
    method: 'PUT', path: '/api/config/models/selection',
    body: { active_model: 'demo/model', enabled_models: ['demo/model'], roles: { chat: 'demo/model' } }
  }), /invalid model selection body/);
  assert.throws(() => normalizeRequest({
    method: 'POST', path: '/api/config/models/discover',
    body: { provider: { base_url: 'https://attacker.example', api_key_env: 'SECRET' } }
  }), /invalid provider key/);
  assert.throws(() => normalizeRequest({
    method: 'POST', path: '/api/config/models/discover',
    body: { provider: 'demo', timeout_ms: 60000 }
  }), /invalid model discovery body/);
});

test('desktop model config client uses configured gateway and unwraps public data', async () => {
  let called = null;
  const request = createModelConfigClient({
    gatewayUrl: 'http://127.0.0.1:43123/base/',
    fetchImpl: async (url, init) => {
      called = { url: String(url), init };
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { active: 'demo/model' } }) };
    }
  });
  const result = await request({
    method: 'PUT', path: '/api/config/models/selection',
    body: { active_model: 'demo/model', enabled_models: ['demo/model'] }
  });
  assert.deepEqual(result, { active: 'demo/model', enabled: [], models: [], providers: {} });
  assert.equal(called.url, 'http://127.0.0.1:43123/api/config/models/selection');
  assert.deepEqual(called.init, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: '{"active_model":"demo/model","enabled_models":["demo/model"]}'
  });
});

test('desktop model config client redacts credentials from failures', async () => {
  assert.equal(sanitizeErrorMessage('Bearer abc123 token=secret api_key:raw'), 'Bearer *** token=*** api_key:***');
  const request = createModelConfigClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: { message: 'token=secret Bearer abc123' } })
    })
  });
  await assert.rejects(() => request({ method: 'GET', path: '/api/config/models' }), /token=\*\*\* Bearer \*\*\*/);

  const networkFailure = createModelConfigClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => { throw new Error('Bearer abc123 api_key=raw'); }
  });
  await assert.rejects(() => networkFailure({ method: 'GET', path: '/api/config/models' }), /Bearer \*\*\* api_key=\*\*\*/);
});

test('desktop model config IPC projects successful responses onto non-sensitive UI fields', async () => {
  const secretValues = ['header-secret', 'body-secret', 'env-secret', 'url-secret'];
  const request = createModelConfigClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    fetchImpl: async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => init.method === 'POST'
        ? ({ ok: true, data: {
          ok: false,
          status: 401,
          error: 'Bearer header-secret token=body-secret',
          models: [],
          debug: { headers: { Authorization: 'header-secret' } }
        } })
        : ({ ok: true, data: {
          active: 'demo/first',
          enabled: ['demo/first'],
          roles: { chat: 'demo/first' },
          fallback_models: [],
          models: [{
            ref: 'demo/first', id: 'first', name: 'First', provider: 'demo',
            has_api_key: true, enabled: true, api_key: 'body-secret', headers: { Authorization: 'header-secret' }
          }],
          providers: {
            demo: {
              key: 'demo', display_name: 'Demo', has_api_key: true, requires_api_key: true,
              base_url: 'https://url-secret.example', api_key_env: 'env-secret',
              headers: { Authorization: 'header-secret' }, extra_body: { secret: 'body-secret' }
            }
          }
        } })
    })
  });

  const snapshot = await request({ method: 'GET', path: '/api/config/models' });
  const serialized = JSON.stringify(snapshot);
  for (const secret of secretValues) assert.equal(serialized.includes(secret), false);
  assert.deepEqual(snapshot.providers.demo, {
    key: 'demo', display_name: 'Demo', has_api_key: true, requires_api_key: true
  });
  assert.deepEqual(snapshot.models[0], {
    ref: 'demo/first', id: 'first', name: 'First', provider: 'demo', has_api_key: true, enabled: true
  });

  const discovery = await request({
    method: 'POST', path: '/api/config/models/discover', body: { provider: 'demo' }
  });
  assert.deepEqual(discovery, { ok: false, status: 401, error: 'Bearer *** token=***', models: [] });
});

test('desktop model config flow persists selection and handles success, empty, and offline states', async (t) => {
  let snapshot = {
    active: 'demo/first',
    enabled: ['demo/first'],
    models: [
      { ref: 'demo/first', id: 'first', name: 'First', provider: 'demo' },
      { ref: 'demo/second', id: 'second', name: 'Second', provider: 'demo' }
    ],
    providers: { demo: { key: 'demo', display_name: 'Demo' } }
  };
  let discovered = [{ id: 'remote-a', name: 'Remote A' }];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/config/models') {
      res.end(JSON.stringify({ ok: true, data: snapshot }));
      return;
    }
    if (req.method === 'PUT' && req.url === '/api/config/models/selection') {
      snapshot = { ...snapshot, active: body.active_model, enabled: body.enabled_models };
      res.end(JSON.stringify({ ok: true, data: snapshot }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/config/models/discover') {
      res.end(JSON.stringify({ ok: true, data: { ok: true, models: discovered } }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ ok: false, error: 'missing' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.listening) server.close(); });
  const address = server.address();
  const gatewayUrl = `http://127.0.0.1:${address.port}`;
  const request = createModelConfigClient({ gatewayUrl });

  assert.equal((await request({ method: 'GET', path: '/api/config/models' })).active, 'demo/first');
  await request({
    method: 'PUT',
    path: '/api/config/models/selection',
    body: { active_model: 'demo/second', enabled_models: ['demo/first', 'demo/second'] }
  });
  const reopened = createModelConfigClient({ gatewayUrl });
  assert.equal((await reopened({ method: 'GET', path: '/api/config/models' })).active, 'demo/second');
  assert.deepEqual((await request({ method: 'POST', path: '/api/config/models/discover', body: { provider: 'demo' } })).models, discovered);

  discovered = [];
  assert.deepEqual((await request({ method: 'POST', path: '/api/config/models/discover', body: { provider: 'demo' } })).models, []);
  snapshot = { active: '', enabled: [], models: [], providers: {} };
  assert.deepEqual((await request({ method: 'GET', path: '/api/config/models' })).models, []);

  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(() => request({ method: 'GET', path: '/api/config/models' }));
});

test('model config IPC is registered before the chat renderer loads', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../apps/desktop-live2d/main/desktopSuite.js'), 'utf8');
  const registerAt = source.indexOf('ipcMain.handle(CHANNELS.modelConfigRequest');
  const loadAt = source.indexOf("await chatWindow.loadFile(path.join(config.assetRoot, 'apps', 'desktop-live2d', 'renderer', 'chat.html'))");
  assert.ok(registerAt > 0 && loadAt > registerAt, 'model config IPC must exist before chat.html executes');
});
