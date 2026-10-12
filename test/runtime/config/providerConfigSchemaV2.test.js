const test = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const {
  validateConfig,
  normalizeProviderConfig,
  splitModelRef
} = require('../../../apps/runtime/config/providerConfigStore');

const V1 = {
  active_provider: 'qwen35_plus',
  providers: {
    qwen35_plus: {
      type: 'openai_compatible',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.5-plus',
      api_key_env: 'DASHSCOPE_API_KEY'
    },
    qwen3_tts: {
      type: 'tts_dashscope', tts_model: 'm', tts_voice: 'v', base_url: 'https://x', api_key_env: 'K'
    }
  }
};

test('v1 config stays valid and normalizes to v2 view without mutating input', () => {
  const before = JSON.stringify(V1);
  validateConfig(V1);
  const n = normalizeProviderConfig(V1);
  assert.equal(JSON.stringify(V1), before);
  assert.equal(n.version, 2);
  assert.equal(n.active_model, 'qwen35_plus/qwen3.5-plus');
  assert.equal(n.active_provider, 'qwen35_plus');
  assert.deepEqual(n.providers.qwen35_plus.models, [{ id: 'qwen3.5-plus' }]);
  assert.deepEqual(n.enabled_models, []);
});

test('v2 config with preset, multiple models, roles and fallback validates', () => {
  const cfg = YAML.parse(`
version: 2
active_model: deepseek/deepseek-chat
enabled_models: [deepseek/deepseek-chat, deepseek/deepseek-reasoner]
roles: { chat: deepseek/deepseek-chat, summary: deepseek/deepseek-chat }
fallback_models: [deepseek/deepseek-reasoner]
providers:
  deepseek:
    preset: deepseek
    api_key: sk-x
`);
  validateConfig(cfg);
  const n = normalizeProviderConfig(cfg);
  assert.equal(n.providers.deepseek.type, 'openai_compatible');
  assert.equal(n.providers.deepseek.base_url, 'https://api.deepseek.com/v1');
  assert.deepEqual(n.providers.deepseek.models.map((m) => m.id), ['deepseek-chat', 'deepseek-reasoner']);
  assert.equal(n.providers.deepseek.compat.strip_reasoning_in_history, true);
});

test('new provider types validate; ollama needs no key; anthropic gets default base_url', () => {
  const cfg = {
    active_model: 'ant/claude-x',
    providers: {
      ant: { type: 'anthropic', api_key: 'k', models: [{ id: 'claude-x' }] },
      gem: { type: 'google', api_key_env: 'G', model: 'gemini-2.5-flash' },
      local: { preset: 'ollama' },
      asr1: { type: 'asr_openai_compatible', base_url: 'http://x', model: 'whisper-1', api_key: 'k' },
      asr2: { type: 'asr_dashscope', model: 'paraformer', api_key_env: 'D' }
    }
  };
  validateConfig(cfg);
  const n = normalizeProviderConfig(cfg);
  assert.equal(n.providers.ant.base_url, 'https://api.anthropic.com');
  assert.equal(n.providers.local.base_url, 'http://127.0.0.1:11434/v1');
});

test('validation rejects unknown refs, empty models and missing keys', () => {
  const base = () => ({
    active_model: 'a/m1',
    providers: { a: { type: 'openai_compatible', base_url: 'http://x', api_key: 'k', models: [{ id: 'm1' }] } }
  });
  validateConfig(base());
  assert.throws(() => validateConfig({ ...base(), active_model: 'a/nope' }), /unknown model/);
  assert.throws(() => validateConfig({ ...base(), enabled_models: ['b/x'] }), /enabled_models/);
  assert.throws(() => validateConfig({ ...base(), fallback_models: ['a/zzz'] }), /fallback_models/);
  assert.throws(() => validateConfig({ ...base(), roles: { vision: 'a/zzz' } }), /roles/);
  const noKey = base();
  delete noKey.providers.a.api_key;
  assert.throws(() => validateConfig(noKey), /api_key/);
  const bad = base();
  bad.providers.a.type = 'nope';
  assert.throws(() => validateConfig(bad), /type must be one of/);
});

test('splitModelRef handles model ids containing slashes', () => {
  const providers = { openrouter: {}, open: {} };
  assert.deepEqual(splitModelRef('openrouter/openai/gpt-4o', providers), { provider: 'openrouter', id: 'openai/gpt-4o' });
  assert.equal(splitModelRef('nope/x', providers), null);
});
