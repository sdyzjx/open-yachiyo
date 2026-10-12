const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { ProviderConfigStore } = require('../../apps/runtime/config/providerConfigStore');
const { LlmProviderManager } = require('../../apps/runtime/config/llmProviderManager');
const { createModelConfigRouter } = require('../../apps/gateway/routes/modelConfig');
const { safeLegacyProviderConfig } = require('../../apps/gateway/routes/configSecurity');
const {
  APPASSETS_ORIGIN, appassetsCors, configLoopbackOnly, remoteApiAuth
} = require('../../apps/gateway/deviceHub/accessControl');

const YAML_TEXT = `
active_model: ds/deepseek-chat
enabled_models: [ds/deepseek-chat]
providers:
  ds:
    preset: deepseek
    api_key: sk-SECRET-VALUE
    headers: { Authorization: 'Bearer HDR-SECRET', X-Org: org-secret }
    extra_body: { user_token: BODY-SECRET }
    compat: { max_tokens_field: max_completion_tokens }
`;

async function setup(t, { remoteAddress } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-sec-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, YAML_TEXT);
  const llmManager = new LlmProviderManager({ store: new ProviderConfigStore({ configPath }) });
  const app = express();
  app.use(express.json());
  app.use(appassetsCors);
  app.use('/api/config', configLoopbackOnly);
  app.use('/api', remoteApiAuth('test-token'));
  app.use(createModelConfigRouter({ llmManager }));
  app.get('/api/config/providers/config', (req, res) => res.json({ ok: true, data: safeLegacyProviderConfig(llmManager.getConfig()) }));
  app.get('/api/device/ping', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  if (remoteAddress) {
    server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: remoteAddress }));
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(`${base}${url}`, {
      method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  return { call, configPath };
}

test('TC-CFG-001 /api/config/** rejects non-loopback peers, XFF spoof and pairing token', async (t) => {
  const f = await setup(t, { remoteAddress: '192.0.2.10' });
  for (const url of ['/api/config/models', '/api/config/providers/config', '/api/config/models/presets']) {
    assert.equal((await f.call('GET', url)).status, 403, url);
    assert.equal((await f.call('GET', url, undefined, { 'x-forwarded-for': '127.0.0.1' })).status, 403, `${url} xff`);
    assert.equal((await f.call('GET', url, undefined, { authorization: 'Bearer test-token' })).status, 403, `${url} token`);
    assert.equal((await f.call('GET', `${url}?token=test-token`)).status, 403, `${url} query token`);
  }
  assert.equal((await f.call('PUT', '/api/config/models/selection', { active_model: 'ds/deepseek-chat' }, { authorization: 'Bearer test-token' })).status, 403);
  assert.equal((await f.call('GET', '/api/device/ping', undefined, { authorization: 'Bearer test-token' })).status, 200);
});

test('TC-CFG-002 loopback peers can use /api/config/** and appassets gets no config CORS', async (t) => {
  const f = await setup(t);
  assert.equal((await f.call('GET', '/api/config/models')).status, 200);
  const r = await f.call('OPTIONS', '/api/config/models', undefined, { origin: APPASSETS_ORIGIN });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('TC-CFG-003 provider snapshots never expose key, headers or extra_body values', async (t) => {
  const f = await setup(t);
  for (const url of ['/api/config/models', '/api/config/providers/config']) {
    const r = await f.call('GET', url);
    for (const secret of ['sk-SECRET-VALUE', 'HDR-SECRET', 'org-secret', 'BODY-SECRET']) {
      assert.equal(r.text.includes(secret), false, `${url} leaked ${secret}`);
    }
    const data = JSON.parse(r.text).data;
    const ds = data.providers.ds;
    assert.equal(ds.has_api_key, true);
    assert.equal(ds.has_custom_headers, true);
    assert.equal(ds.has_extra_body, true);
    assert.equal('headers' in ds, false);
    assert.equal('extra_body' in ds, false);
    assert.equal(ds.compat.max_tokens_field, 'max_completion_tokens');
  }
  const model = JSON.parse((await f.call('GET', '/api/config/models')).text).data.models[0];
  assert.equal(model.has_custom_headers, true);
  assert.equal('headers' in model, false);
  assert.equal('extra_body' in model, false);
});

test('TC-CFG-004 provider PUT is a patch: absent fields and empty api_key are kept', async (t) => {
  const f = await setup(t);
  const stored = () => fs.readFileSync(f.configPath, 'utf8');
  let r = await f.call('PUT', '/api/config/models/providers/ds', { display_name: 'DS renamed', api_key: '' });
  assert.equal(r.status, 200);
  assert.ok(stored().includes('sk-SECRET-VALUE'));
  assert.ok(stored().includes('HDR-SECRET'));
  assert.ok(stored().includes('BODY-SECRET'));
  assert.ok(stored().includes('max_completion_tokens'));
  assert.ok(stored().includes('DS renamed'));
  // writing the model list back from a snapshot must not drop per-model hidden data
  r = await f.call('PUT', '/api/config/models/providers/ds', { models: [{ id: 'deepseek-chat', has_custom_headers: true }] });
  assert.equal(r.status, 200);
  assert.equal(stored().includes('has_custom_headers'), false);
  // explicit key replace
  r = await f.call('PUT', '/api/config/models/providers/ds', { api_key: 'sk-NEW-VALUE' });
  assert.ok(stored().includes('sk-NEW-VALUE'));
  assert.equal(stored().includes('sk-SECRET-VALUE'), false);
  assert.equal(r.text.includes('sk-NEW-VALUE'), false);
  // only clear_api_key clears (needs env fallback to stay valid)
  r = await f.call('PUT', '/api/config/models/providers/ds', { api_key_env: 'DS_TEST_ENV', clear_api_key: true });
  assert.equal(r.status, 200);
  assert.equal(stored().includes('sk-NEW-VALUE'), false);
  assert.ok(stored().includes('DS_TEST_ENV'));
});

test('TC-CFG-005 error responses are single-line and do not echo secrets', async (t) => {
  const f = await setup(t);
  const r = await f.call('PUT', '/api/config/models/providers/ds', { type: 'bogus', api_key: 'sk-SECRET-VALUE' });
  assert.equal(r.status, 400);
  assert.equal(r.text.includes('sk-SECRET-VALUE'), false);
});
