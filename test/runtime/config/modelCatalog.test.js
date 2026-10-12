const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProviderConfigStore } = require('../../../apps/runtime/config/providerConfigStore');
const { loadModelCatalog, toDescriptor } = require('../../../apps/runtime/config/modelCatalog');

function storeWith(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, yaml, 'utf8');
  return new ProviderConfigStore({ configPath });
}

test('loadModelCatalog maps v1 providers to descriptors and picks active', () => {
  const catalog = loadModelCatalog({ store: storeWith(`
active_provider: ds
providers:
  ds:
    type: openai_compatible
    base_url: https://api.deepseek.com/v1/
    model: deepseek-chat
    api_key: sk-test
  tts:
    type: tts_dashscope
    tts_model: m
    tts_voice: v
    base_url: https://x
    api_key_env: X
`) });
  assert.equal(catalog.active.ref, 'ds/deepseek-chat');
  assert.equal(catalog.active.api, 'openai-completions');
  assert.equal(catalog.active.base_url, 'https://api.deepseek.com/v1');
  assert.equal(catalog.active.api_key, 'sk-test');
  assert.deepEqual(catalog.enabled.map((m) => m.ref), ['ds/deepseek-chat']);
  assert.equal(catalog.forRole('vision').ref, 'ds/deepseek-chat');
  assert.equal(catalog.tts.key, 'tts');
  assert.equal(catalog.models.length, 1);
});

test('getDeviceHub returns a null hub until a real hub is installed', async () => {
  const { getDeviceHub, setDeviceHub } = require('../../../apps/gateway/deviceHub');
  const hub = getDeviceHub();
  assert.equal(hub.enabled, false);
  assert.deepEqual(hub.listToolMethods(), []);
  await assert.rejects(hub.invoke('x', 'device.vibrate'), (err) => err.code === -32010);
  setDeviceHub(null);
  assert.equal(getDeviceHub().getAvatarHost(), 'desktop');
});

test('catalog v2: multi-model, enabled order, roles, fallback chain, tts/asr, key resolution', () => {
  process.env.CATALOG_TEST_KEY = 'env-secret';
  try {
    const catalog = loadModelCatalog({ store: storeWith(`
version: 2
active_model: deepseek/deepseek-reasoner
enabled_models: [qwen/qwen3.5-plus, deepseek/deepseek-reasoner]
roles: { vision: qwen/qwen3.5-plus }
fallback_models: [qwen/qwen3.5-plus, deepseek/deepseek-reasoner]
providers:
  deepseek:
    preset: deepseek
    api_key_env: CATALOG_TEST_KEY
    headers: { X-Org: acme }
    extra_body: { foo: 1 }
  qwen:
    preset: qwen
    api_key: sk-q
  openrouter:
    preset: openrouter
    api_key: sk-o
    models:
      - id: openai/gpt-4o-mini
  asr1:
    type: asr_openai_compatible
    base_url: http://x
    model: whisper-1
    api_key: sk-a
`) });
    assert.equal(catalog.models.length, 5);
    assert.equal(catalog.active.ref, 'deepseek/deepseek-reasoner');
    assert.equal(catalog.active.reasoning, true);
    assert.equal(catalog.active.api_key, 'env-secret');
    assert.equal(catalog.active.api_key_env, 'CATALOG_TEST_KEY');
    assert.deepEqual(catalog.active.headers, { 'X-Org': 'acme' });
    assert.deepEqual(catalog.active.extra_body, { foo: 1 });
    assert.equal(catalog.active.compat.strip_reasoning_in_history, true);
    assert.deepEqual(catalog.enabled.map((m) => m.ref), ['qwen/qwen3.5-plus', 'deepseek/deepseek-reasoner']);
    assert.equal(catalog.forRole('vision').ref, 'qwen/qwen3.5-plus');
    assert.equal(catalog.forRole('summary').ref, 'deepseek/deepseek-reasoner');
    assert.deepEqual(catalog.fallbackChain().map((m) => m.ref), ['deepseek/deepseek-reasoner', 'qwen/qwen3.5-plus']);
    assert.equal(catalog.resolve('openrouter/openai/gpt-4o-mini').id, 'openai/gpt-4o-mini');
    assert.equal(catalog.resolve('nope/x'), null);
    assert.equal(catalog.asr.key, 'asr1');
    assert.equal(catalog.asr.api_key, 'sk-a');
    assert.equal(catalog.tts, null);
  } finally {
    delete process.env.CATALOG_TEST_KEY;
  }
});

test('catalog maps anthropic/google api ids and ollama without key', () => {
  const catalog = loadModelCatalog({ store: storeWith(`
active_model: ant/claude-sonnet-4-5
providers:
  ant: { preset: anthropic, api_key: k }
  gem: { preset: gemini, api_key: k }
  local: { preset: ollama }
`) });
  assert.equal(catalog.resolve('ant/claude-sonnet-4-5').api, 'anthropic-messages');
  assert.equal(catalog.resolve('gem/gemini-2.5-flash').api, 'google-generative-ai');
  const local = catalog.resolve('local/qwen2.5:7b');
  assert.equal(local.api, 'openai-completions');
  assert.equal(local.api_key, null);
});

test('TC-LLM-036 catalog maps ChatGPT plan models to Responses without storing credentials', () => {
  const store = storeWith(`
active_model: chatgpt/gpt-test
providers:
  chatgpt:
    type: openai_chatgpt_plan
    base_url: https://api.openai.com/v1
    models:
      - { id: gpt-test, name: GPT Test }
`);
  const refresh = async () => 'rotated-oauth-token';
  const catalog = loadModelCatalog({ store, chatgptAccessToken: 'runtime-oauth-token', chatgptRefreshAccessToken: refresh });
  const model = catalog.active;
  assert.equal(model.api, 'openai-responses');
  assert.equal(model.base_url, 'https://api.openai.com/v1');
  assert.equal(model.api_key, 'runtime-oauth-token');
  assert.equal(model.chatgpt_plan, true);
  assert.equal(model.refresh_access_token, refresh);
  const hardened = toDescriptor('chatgpt', {
    type: 'openai_chatgpt_plan', base_url: 'https://api.openai.com/v1',
    headers: { authorization: 'Bearer config-override' }, extra_body: { metadata: { unsafe: true } }
  }, { id: 'gpt-test', headers: { 'x-model': 'unsafe' }, extra_body: { user: 'unsafe' } }, {
    chatgptAccessToken: 'runtime-oauth-token', chatgptRefreshAccessToken: refresh
  });
  assert.deepEqual(hardened.headers, {});
  assert.deepEqual(hardened.extra_body, {});
  assert.doesNotMatch(JSON.stringify(store.loadNormalized()), /runtime-oauth-token|rotated-oauth-token/);
  const unsafe = storeWith(`
active_model: chatgpt/gpt-test
providers:
  chatgpt:
    type: openai_chatgpt_plan
    base_url: https://example.invalid
    api_key: must-not-survive
    model: gpt-test
`);
  assert.throws(() => unsafe.load(), /must use https:\/\/api\.openai\.com\/v1/);
});
