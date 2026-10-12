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

test('TC-LLM-042 validates model capability and audio routing metadata', () => {
  const config = (model) => ({
    active_model: `qwen/${model.id}`,
    providers: {
      qwen: {
        type: 'openai_compatible',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        api_key: 'k',
        models: [model]
      }
    }
  });
  validateConfig(config({
    id: 'qwen3.8-omni-flash-realtime',
    input: ['text', 'audio'],
    output: ['text', 'audio'],
    transport: 'realtime',
    audio: { mode: 'realtime', input_format: 'pcm_s16le' }
  }));
  assert.throws(
    () => validateConfig(config({ id: 'bad-input', input: ['text', 'sound'] })),
    /input must contain only/
  );
  assert.throws(
    () => validateConfig(config({ id: 'bad-audio', input: ['text'], audio: { mode: 'direct' } })),
    /requires input: audio/
  );
  assert.throws(
    () => validateConfig(config({ id: 'bad-realtime', input: ['audio'], audio: { mode: 'realtime' } })),
    /requires transport: realtime/
  );
});

test('TC-LLM-043 discovered known Omni models migrate from text-only capability metadata', () => {
  const normalized = normalizeProviderConfig({
    active_model: 'custom/qwen3.8-omni-flash-realtime',
    providers: {
      custom: {
        type: 'openai_compatible', base_url: 'https://example.invalid/v1', api_key: 'k',
        models: [{
          id: 'qwen3.8-omni-flash-realtime', input: ['text'], output: ['text'], transport: 'request'
        }]
      }
    }
  });
  const [model] = normalized.providers.custom.models;
  assert.deepEqual(model.input, ['text', 'audio', 'video']);
  assert.deepEqual(model.output, ['text', 'audio']);
  assert.equal(model.transport, 'realtime');
  assert.equal(model.audio.mode, 'realtime');
});

test('TC-LLM-036 ChatGPT plan type is restricted to its service-owned provider key', () => {
  const provider = {
    type: 'openai_chatgpt_plan',
    base_url: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-test' }]
  };
  validateConfig({ active_model: 'chatgpt/gpt-test', providers: { chatgpt: provider } });
  assert.throws(() => validateConfig({
    active_model: 'alternate/gpt-test', providers: { alternate: provider }
  }), /reserved provider key chatgpt/);
  assert.throws(() => validateConfig({
    active_model: 'chatgpt/gpt-test',
    providers: { chatgpt: { ...provider, preset: 'deepseek' } }
  }), /cannot define preset/);
  assert.throws(() => validateConfig({
    active_model: 'chatgpt/gpt-test',
    providers: { chatgpt: { ...provider, models: [{ id: 'gpt-test', headers: { authorization: 'Bearer override' } }] } }
  }), /models\[\] cannot define headers/);
});

test('splitModelRef handles model ids containing slashes', () => {
  const providers = { openrouter: {}, open: {} };
  assert.deepEqual(splitModelRef('openrouter/openai/gpt-4o', providers), { provider: 'openrouter', id: 'openai/gpt-4o' });
  assert.equal(splitModelRef('nope/x', providers), null);
});

test('shipped config/providers.yaml template is a valid v2 config with a catalog', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const cfg = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../../../config/providers.yaml'), 'utf8'));
  validateConfig(cfg);
  const { loadModelCatalog } = require('../../../apps/runtime/config/modelCatalog');
  const catalog = loadModelCatalog({ store: { load: () => cfg } });
  assert.equal(catalog.active.ref, 'qwen35_plus/qwen3.5-plus');
  assert.ok(catalog.resolve('deepseek/deepseek-reasoner').reasoning);
  assert.equal(catalog.enabled.length, 3);
  assert.equal(catalog.tts.key, 'qwen_tts');
  assert.equal(catalog.tts.tts_model, 'qwen3-tts-flash');
  assert.equal(catalog.tts.tts_realtime_model, 'qwen3-tts-flash-realtime');
  assert.equal(cfg.voice.active_tts, 'qwen_tts');
});
