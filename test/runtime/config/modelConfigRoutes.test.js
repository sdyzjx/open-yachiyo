const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { ProviderConfigStore } = require('../../../apps/runtime/config/providerConfigStore');
const { LlmProviderManager } = require('../../../apps/runtime/config/llmProviderManager');
const { createModelConfigRouter } = require('../../../apps/gateway/routes/modelConfig');
const { mergeSessionSettings } = require('../../../apps/runtime/session/sessionPermissions');
const { getFreePort } = require('../../helpers/net');

async function listen(app) {
  const port = await getFreePort();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${port}` };
}

async function setup(yamlText, routerOpts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-routes-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, yamlText, 'utf8');
  const llmManager = new LlmProviderManager({ store: new ProviderConfigStore({ configPath }) });
  const commits = [];
  const app = express();
  app.use(express.json());
  app.use(createModelConfigRouter({ llmManager, commitConfigChange: (f) => commits.push(f), ...routerOpts }));
  // stand-in for the existing settings handler
  app.put('/api/sessions/:id/settings', (req, res) => res.json({ ok: true, reached: true }));
  const { server, base } = await listen(app);
  const call = async (method, url, body) => {
    const r = await fetch(`${base}${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, json: await r.json() };
  };
  return { server, call, commits, configPath, llmManager };
}

const BASE_YAML = `
active_model: ds/deepseek-chat
enabled_models: [ds/deepseek-chat]
providers:
  ds:
    preset: deepseek
    api_key: sk-SECRET-VALUE
  qw:
    preset: qwen
    api_key_env: ROUTE_TEST_UNSET_ENV
`;

test('GET /api/config/models never leaks api_key and reports has_api_key', async () => {
  const t = await setup(BASE_YAML);
  try {
    const r = await t.call('GET', '/api/config/models');
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(r.json).includes('sk-SECRET-VALUE'), false);
    assert.equal(r.json.data.active, 'ds/deepseek-chat');
    assert.deepEqual(r.json.data.enabled, ['ds/deepseek-chat']);
    const ds = r.json.data.models.find((m) => m.ref === 'ds/deepseek-chat');
    assert.equal(ds.has_api_key, true);
    assert.equal(ds.enabled, true);
    assert.equal('api_key' in ds, false);
    const qw = r.json.data.models.find((m) => m.provider === 'qw');
    assert.equal(qw.has_api_key, false);
    assert.equal(r.json.data.providers.ds.has_api_key, true);
  } finally { t.server.close(); }
});

test('PUT selection validates refs (400) and persists + commits on success', async () => {
  const t = await setup(BASE_YAML);
  try {
    const bad = await t.call('PUT', '/api/config/models/selection', { active_model: 'ds/nope' });
    assert.equal(bad.status, 400);
    const badEnabled = await t.call('PUT', '/api/config/models/selection', { enabled_models: ['zzz/a'] });
    assert.equal(badEnabled.status, 400);
    assert.deepEqual(t.commits, []);

    const good = await t.call('PUT', '/api/config/models/selection', {
      active_model: 'qw/qwen3.5-plus',
      enabled_models: ['qw/qwen3.5-plus', 'ds/deepseek-reasoner'],
      roles: { vision: 'qw/qwen3.5-plus' },
      fallback_models: ['ds/deepseek-chat']
    });
    assert.equal(good.status, 200);
    assert.equal(good.json.data.active, 'qw/qwen3.5-plus');
    assert.deepEqual(good.json.data.fallback_models, ['ds/deepseek-chat']);
    assert.deepEqual(t.commits, ['providers.yaml']);

    const again = await t.call('GET', '/api/config/models');
    assert.deepEqual(again.json.data.enabled, ['qw/qwen3.5-plus', 'ds/deepseek-reasoner']);
    assert.equal(again.json.data.roles.vision, 'qw/qwen3.5-plus');
    // key was not lost by the save
    assert.equal(fs.readFileSync(t.configPath, 'utf8').includes('sk-SECRET-VALUE'), true);
  } finally { t.server.close(); }
});

test('GET presets lists the contract presets', async () => {
  const t = await setup(BASE_YAML);
  try {
    const r = await t.call('GET', '/api/config/models/presets');
    assert.ok(r.json.data.some((p) => p.id === 'deepseek'));
    assert.ok(r.json.data.length >= 11);
  } finally { t.server.close(); }
});

test('provider upsert keeps stored key when omitted; delete cleans references', async () => {
  const t = await setup(BASE_YAML);
  try {
    const up = await t.call('PUT', '/api/config/models/providers/ds', {
      preset: 'deepseek', display_name: 'DS renamed', models: [{ id: 'deepseek-chat' }]
    });
    assert.equal(up.status, 200);
    assert.equal(fs.readFileSync(t.configPath, 'utf8').includes('sk-SECRET-VALUE'), true);
    const created = await t.call('PUT', '/api/config/models/providers/local', { preset: 'ollama' });
    assert.equal(created.status, 200);
    assert.ok(created.json.data.models.some((m) => m.ref === 'local/qwen2.5:7b'));
    assert.equal((await t.call('PUT', '/api/config/models/providers/bad key', { preset: 'ollama' })).status, 400);

    await t.call('PUT', '/api/config/models/selection', { fallback_models: ['local/qwen2.5:7b'] });
    const del = await t.call('DELETE', '/api/config/models/providers/local');
    assert.equal(del.status, 200);
    assert.deepEqual(del.json.data.fallback_models, []);
    assert.equal((await t.call('DELETE', '/api/config/models/providers/local')).status, 404);
  } finally { t.server.close(); }
});

function mockUpstream(handler) {
  return (async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { requests.push({ url: req.url, method: req.method, headers: req.headers, body }); handler(req, res); });
    });
    const port = await getFreePort();
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { server, requests, base: `http://127.0.0.1:${port}` };
  })();
}

test('POST test: success reports latency; failure redacts key; temp provider inherits stored key', async () => {
  const up = await mockUpstream((req, res) => {
    if (req.headers.authorization === 'Bearer sk-up') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
    } else {
      res.writeHead(401).end(`bad key ${req.headers.authorization}`);
    }
  });
  const t = await setup(`
active_model: m/x
providers:
  m: { type: openai_compatible, base_url: ${up.base}, api_key: sk-up, model: x, compat: { max_tokens_field: max_completion_tokens } }
  w: { type: openai_compatible, base_url: ${up.base}, api_key: sk-wrong, model: x }
`);
  try {
    const okRes = await t.call('POST', '/api/config/models/test', { ref: 'm/x' });
    assert.equal(okRes.json.data.ok, true);
    assert.equal(typeof okRes.json.data.latency_ms, 'number');
    assert.equal(JSON.parse(up.requests[0].body).max_completion_tokens, 8);

    const bad = await t.call('POST', '/api/config/models/test', { ref: 'w/x' });
    assert.equal(bad.json.data.ok, false);
    assert.equal(bad.json.data.status, 401);
    assert.equal(JSON.stringify(bad.json).includes('sk-wrong'), false);

    const draft = await t.call('POST', '/api/config/models/test', {
      provider: { type: 'openai_compatible', base_url: up.base, model: 'x' }, provider_key: 'm'
    });
    assert.equal(draft.json.data.ok, true);

    assert.equal((await t.call('POST', '/api/config/models/test', { ref: 'nope/x' })).status, 400);
    assert.equal((await t.call('POST', '/api/config/models/test', {})).status, 400);
  } finally { t.server.close(); up.server.close(); }
});

test('POST test times out and reports an error instead of hanging', async () => {
  const up = await mockUpstream(() => { /* never respond */ });
  const t = await setup(`
active_model: m/x
providers:
  m: { type: openai_compatible, base_url: ${up.base}, api_key: k, model: x }
`);
  try {
    const r = await t.call('POST', '/api/config/models/test', { ref: 'm/x', timeout_ms: 150 });
    assert.equal(r.json.data.ok, false);
    assert.match(r.json.data.error, /timeout/);
  } finally { t.server.close(); up.server.closeAllConnections?.(); up.server.close(); }
});

test('POST discover lists openai-style models and gemini-style names', async () => {
  const up = await mockUpstream((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/models') && req.headers['x-goog-api-key']) {
      res.end(JSON.stringify({ models: [{ name: 'models/gemini-x', displayName: 'Gem X' }] }));
    } else {
      res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }));
    }
  });
  const t = await setup(`
active_model: m/x
providers:
  m: { type: openai_compatible, base_url: ${up.base}, api_key: k, model: x }
`);
  try {
    const r = await t.call('POST', '/api/config/models/discover', { provider: 'm' });
    assert.deepEqual(r.json.data.models.map((m) => m.id), ['a', 'b']);
    const g = await t.call('POST', '/api/config/models/discover', {
      provider: { type: 'google', base_url: up.base, api_key: 'gk' }
    });
    assert.deepEqual(g.json.data.models, [{ id: 'gemini-x', name: 'Gem X' }]);
    assert.equal((await t.call('POST', '/api/config/models/discover', { provider: 'unknown' })).status, 400);
  } finally { t.server.close(); up.server.close(); }
});

test('session settings: unknown model_ref -> 400, valid/clear/absent pass through; merge persists model_ref', async () => {
  const t = await setup(BASE_YAML);
  try {
    const bad = await t.call('PUT', '/api/sessions/s1/settings', { settings: { model_ref: 'ds/nope' } });
    assert.equal(bad.status, 400);
    assert.equal((await t.call('PUT', '/api/sessions/s1/settings', { settings: { model_ref: 5 } })).status, 400);
    for (const settings of [{ model_ref: 'ds/deepseek-reasoner' }, { model_ref: null }, { permission_level: 'low' }]) {
      const r = await t.call('PUT', '/api/sessions/s1/settings', { settings });
      assert.equal(r.json.reached, true);
    }
  } finally { t.server.close(); }

  const withRef = mergeSessionSettings({ permission_level: 'low' }, { model_ref: 'ds/deepseek-chat' });
  assert.equal(withRef.model_ref, 'ds/deepseek-chat');
  assert.equal(withRef.permission_level, 'low');
  assert.equal('model_ref' in mergeSessionSettings(withRef, { model_ref: null }), false);
  assert.equal(mergeSessionSettings(withRef, { permission_level: 'high' }).model_ref, 'ds/deepseek-chat');
});

test('POST /api/config/models/test never sends stored credentials to a foreign base_url', async () => {
  const seen = [];
  const attacker = http.createServer((req, res) => {
    seen.push(req.headers.authorization || null);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  });
  const port = await getFreePort();
  await new Promise((resolve) => attacker.listen(port, '127.0.0.1', resolve));
  process.env.ROUTE_TEST_SECRET_ENV = 'sk-ENV-SECRET';
  const t = await setup(BASE_YAML);
  try {
    const foreign = `http://127.0.0.1:${port}/v1`;
    await t.call('POST', '/api/config/models/test', {
      provider: { type: 'openai_compatible', base_url: foreign, model: 'x' }, provider_key: 'ds'
    });
    await t.call('POST', '/api/config/models/test', {
      provider: { type: 'openai_compatible', base_url: foreign, model: 'x', api_key_env: 'ROUTE_TEST_SECRET_ENV' }
    });
    assert.ok(seen.length >= 1);
    for (const header of seen) {
      assert.ok(!String(header || '').includes('SECRET'), `credential leaked: ${header}`);
    }
  } finally {
    delete process.env.ROUTE_TEST_SECRET_ENV;
    t.server.close();
    attacker.close();
  }
});
