const test = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const { validateConfig, normalizeProviderConfig } = require('../../../apps/runtime/config/providerConfigStore');
const { loadModelCatalog } = require('../../../apps/runtime/config/modelCatalog');

const BASE = `
version: 2
active_model: chat/m
providers:
  chat: { type: openai_compatible, base_url: 'https://x/v1', model: m, api_key: k }
  qwen_tts: { type: tts_dashscope, base_url: 'https://d/api/v1', api_key: k, tts_model: a, tts_voice: Cherry }
  oai_tts: { type: tts_openai_compatible, base_url: 'https://o/v1', api_key: k, tts_model: tts-1, tts_voice: alloy, format: wav }
  asr1: { type: asr_dashscope, base_url: 'https://d/api/v1', api_key: k, asr_model: legacy-asr }
  asr2: { type: asr_openai_compatible, base_url: 'https://o/v1', api_key: k, model: whisper-1 }
`;
const parse = (extra = '') => YAML.parse(BASE + extra);

test('TC-VOC-001 v1/v2 configs without voice stay valid and resolve first provider', () => {
  const cfg = parse();
  validateConfig(cfg);
  assert.deepEqual(normalizeProviderConfig(cfg).voice, {});
  const catalog = loadModelCatalog({ store: { load: () => cfg } });
  assert.equal(catalog.tts.key, 'qwen_tts');
  assert.equal(catalog.asr.key, 'asr1');
});

test('TC-VOC-002 tts_openai_compatible validation', () => {
  const cfg = parse();
  delete cfg.providers.oai_tts.tts_voice;
  assert.throws(() => validateConfig(cfg), /provider oai_tts must define tts_voice/);
  const bad = parse(); bad.providers.oai_tts.format = 'ogg';
  assert.throws(() => validateConfig(bad), /oai_tts format must be one of/);
  const nobase = parse(); delete nobase.providers.oai_tts.base_url;
  assert.throws(() => validateConfig(nobase), /oai_tts must define base_url/);
});

test('TC-VOC-003 voice.active_* selects provider; validation errors are clear', () => {
  const cfg = parse('voice: { active_tts: oai_tts, active_asr: asr2 }\n');
  validateConfig(cfg);
  const catalog = loadModelCatalog({ store: { load: () => cfg } });
  assert.equal(catalog.tts.key, 'oai_tts');
  assert.equal(catalog.asr.key, 'asr2');
  assert.throws(() => validateConfig(parse('voice: { active_tts: nope }\n')), /voice\.active_tts references unknown provider: nope/);
  assert.throws(() => validateConfig(parse('voice: { active_tts: chat }\n')), /voice\.active_tts provider chat must be a tts_\* type/);
  assert.throws(() => validateConfig(parse('voice: { active_asr: qwen_tts }\n')), /voice\.active_asr provider qwen_tts must be a asr_\* type/);
  assert.throws(() => validateConfig(parse('voice: [a]\n')), /voice must be an object/);
  assert.throws(() => validateConfig(parse('voice: { active_tts: 3 }\n')), /voice\.active_tts must be a non-empty string/);
});

test('TC-VOC-004 TTS resolution order: voice.active_tts > TTS_PROVIDER_KEY > first', () => {
  const prev = process.env.TTS_PROVIDER_KEY;
  try {
    process.env.TTS_PROVIDER_KEY = 'oai_tts';
    const store = (extra) => ({ load: () => parse(extra) });
    assert.equal(loadModelCatalog({ store: store('') }).tts.key, 'oai_tts');
    assert.equal(loadModelCatalog({ store: store('voice: { active_tts: qwen_tts }\n') }).tts.key, 'qwen_tts');
    process.env.TTS_PROVIDER_KEY = 'missing';
    assert.equal(loadModelCatalog({ store: store('') }).tts.key, 'qwen_tts');
    process.env.TTS_PROVIDER_KEY = 'chat'; // wrong kind is ignored
    assert.equal(loadModelCatalog({ store: store('') }).tts.key, 'qwen_tts');
  } finally {
    if (prev === undefined) delete process.env.TTS_PROVIDER_KEY; else process.env.TTS_PROVIDER_KEY = prev;
  }
});

test('TC-VOC-005 ASR reads model with legacy asr_model fallback', () => {
  const cfg = parse();
  validateConfig(cfg);
  assert.equal(loadModelCatalog({ store: { load: () => cfg } }).asr.model, 'legacy-asr');
  const missing = parse(); delete missing.providers.asr1.asr_model;
  assert.throws(() => validateConfig(missing), /provider asr1 must define model/);
});

test('TC-VOC-006 legacy qwen3_tts key keeps working without a voice section', () => {
  const cfg = parse();
  cfg.providers.qwen3_tts = { type: 'tts_dashscope', base_url: 'https://d/api/v1', api_key: 'k', tts_model: 'old', tts_voice: 'v' };
  validateConfig(cfg);
  const prev = process.env.TTS_PROVIDER_KEY;
  try {
    process.env.TTS_PROVIDER_KEY = 'qwen3_tts';
    assert.equal(loadModelCatalog({ store: { load: () => cfg } }).tts.key, 'qwen3_tts');
  } finally {
    if (prev === undefined) delete process.env.TTS_PROVIDER_KEY; else process.env.TTS_PROVIDER_KEY = prev;
  }
});
