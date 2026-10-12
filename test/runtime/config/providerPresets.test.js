const test = require('node:test');
const assert = require('node:assert/strict');
const { listPresets, getPreset } = require('../../../apps/runtime/config/providerPresets');
const { validateConfig } = require('../../../apps/runtime/config/providerConfigStore');

test('presets include every contract C4.3 id', () => {
  const ids = listPresets().map((p) => p.id);
  for (const id of ['openai', 'deepseek', 'qwen', 'moonshot', 'zhipu', 'siliconflow', 'openrouter', 'ollama', 'anthropic', 'gemini', 'custom']) {
    assert.ok(ids.includes(id), id);
  }
});

test('deepseek preset descriptor fields and presets are copies', () => {
  const p = getPreset('deepseek');
  assert.equal(p.base_url, 'https://api.deepseek.com/v1');
  assert.equal(p.api_key_env, 'DEEPSEEK_API_KEY');
  assert.equal(p.compat.strip_reasoning_in_history, true);
  assert.equal(p.models.find((m) => m.id === 'deepseek-reasoner').reasoning, true);
  p.models.length = 0;
  assert.equal(getPreset('deepseek').models.length, 2);
  assert.equal(getPreset('nope'), null);
});

test('every non-custom preset yields a valid provider with a key', () => {
  for (const p of listPresets().filter((x) => x.id !== 'custom')) {
    validateConfig({ active_model: `${p.id}/${p.models[0].id}`, providers: { [p.id]: { preset: p.id, api_key: 'k' } } });
  }
});
