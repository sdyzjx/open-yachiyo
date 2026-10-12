const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { getRuntimePaths } = require('../skills/runtimePaths');

const DEFAULT_CONFIG = {
  active_provider: 'openai',
  providers: {
    openai: {
      type: 'openai_compatible',
      display_name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      api_key_env: 'OPENAI_API_KEY',
      timeout_ms: 20000
    }
  }
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const CHAT_TYPES = ['openai_compatible', 'openai_chatgpt_plan', 'anthropic', 'google'];
const ASR_TYPES = ['asr_openai_compatible', 'asr_dashscope'];
const TTS_TYPES = ['tts_dashscope', 'tts_openai_compatible'];
const TTS_FORMATS = ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'];
const MODEL_INPUT_TYPES = ['text', 'image', 'audio', 'video'];
const MODEL_OUTPUT_TYPES = ['text', 'audio'];
const MODEL_TRANSPORTS = ['request', 'realtime'];
const MODEL_AUDIO_MODES = ['direct', 'realtime'];
const SUPPORTED_TYPES = [...CHAT_TYPES, ...TTS_TYPES, ...ASR_TYPES];
const DEFAULT_BASE_URLS = {
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta'
};

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Split "<provider_key>/<model_id>"; the model id may itself contain "/" (e.g. OpenRouter).
function splitModelRef(ref, providers) {
  const text = String(ref || '');
  let best = null;
  for (const key of Object.keys(providers || {})) {
    if (text.startsWith(`${key}/`) && text.length > key.length + 1) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? { provider: best, id: text.slice(best.length + 1) } : null;
}

let canonicalModelHints = null;

function getCanonicalModelHint(id) {
  if (!canonicalModelHints) {
    canonicalModelHints = new Map();
    for (const preset of require('./providerPresets').listPresets()) {
      for (const model of preset.models || []) {
        if (!model.audio || canonicalModelHints.has(model.id)) continue;
        canonicalModelHints.set(model.id, {
          input: model.input,
          output: model.output,
          transport: model.transport,
          audio: model.audio
        });
      }
    }
  }
  return canonicalModelHints.get(id) || null;
}

function normalizeModelEntry(entry, presetModels) {
  const base = isObject(entry) ? { ...entry } : { id: entry };
  const id = base.id === undefined || base.id === null ? '' : String(base.id);
  const hint = presetModels.find((m) => m.id === id) || getCanonicalModelHint(id) || {};
  const normalized = { ...hint, ...base, id };
  // Capability fields describe the upstream model itself. Keep known models canonical
  // even when an older discovery result persisted the former text-only defaults.
  for (const field of ['input', 'output', 'transport', 'audio']) {
    if (hint[field] !== undefined) normalized[field] = structuredClone(hint[field]);
  }
  return normalized;
}

function normalizeProvider(raw) {
  if (!isObject(raw)) return raw;
  // eslint-disable-next-line global-require
  const isChatGPTPlan = raw.type === 'openai_chatgpt_plan';
  const preset = !isChatGPTPlan && nonEmptyString(raw.preset) ? require('./providerPresets').getPreset(raw.preset) : null;
  const provider = { ...raw };
  if (isChatGPTPlan) {
    provider.base_url = 'https://api.openai.com/v1';
    provider.requires_api_key = false;
    delete provider.preset;
    delete provider.api_key;
    delete provider.api_key_env;
    delete provider.headers;
    delete provider.extra_body;
  }
  if (preset) {
    if (provider.type === undefined) provider.type = preset.type;
    if (provider.base_url === undefined && preset.base_url) provider.base_url = preset.base_url;
    if (provider.api_key_env === undefined && preset.api_key_env) provider.api_key_env = preset.api_key_env;
    if (provider.display_name === undefined) provider.display_name = preset.name;
    provider.compat = { ...preset.compat, ...(isObject(raw.compat) ? raw.compat : {}) };
  }
  if (provider.base_url === undefined && DEFAULT_BASE_URLS[provider.type]) {
    provider.base_url = DEFAULT_BASE_URLS[provider.type];
  }
  if (ASR_TYPES.includes(provider.type) && !nonEmptyString(provider.model) && nonEmptyString(provider.asr_model)) {
    provider.model = provider.asr_model; // legacy field
  }
  if (!CHAT_TYPES.includes(provider.type)) return provider;

  const presetModels = preset?.models || [];
  let list = Array.isArray(raw.models) ? raw.models : null;
  if (!list || list.length === 0) {
    if (nonEmptyString(raw.model)) list = [{ id: raw.model }];
    else list = presetModels;
  }
  provider.models = list.map((m) => normalizeModelEntry(m, presetModels));
  if (isChatGPTPlan) {
    provider.models = provider.models.map((model) => ({
      id: model.id,
      ...(nonEmptyString(model.name) ? { name: model.name } : {})
    }));
  }
  if (!nonEmptyString(provider.model) && provider.models[0]?.id) provider.model = provider.models[0].id;
  return provider;
}

// Returns a schema-v2 view of any (v1 or v2) config without mutating the input.
// Safe on malformed input: validateConfig reports the problems.
function normalizeProviderConfig(config) {
  if (!isObject(config)) return config;
  const providers = {};
  for (const [key, raw] of Object.entries(isObject(config.providers) ? config.providers : {})) {
    providers[key] = normalizeProvider(raw);
  }

  let activeModel = nonEmptyString(config.active_model) ? config.active_model : null;
  const activeProviderV1 = nonEmptyString(config.active_provider) ? config.active_provider : null;
  if (!activeModel && activeProviderV1 && isObject(providers[activeProviderV1])) {
    const first = providers[activeProviderV1].model || providers[activeProviderV1].models?.[0]?.id;
    if (first) activeModel = `${activeProviderV1}/${first}`;
  }
  const activeParts = activeModel ? splitModelRef(activeModel, providers) : null;

  return {
    ...config,
    version: 2,
    active_provider: activeParts ? activeParts.provider : activeProviderV1,
    active_model: activeModel,
    enabled_models: Array.isArray(config.enabled_models) ? [...config.enabled_models] : [],
    roles: isObject(config.roles) ? { ...config.roles } : {},
    fallback_models: Array.isArray(config.fallback_models) ? [...config.fallback_models] : [],
    voice: isObject(config.voice) ? { ...config.voice } : {},
    providers
  };
}

function apiKeyOptional(provider) {
  return provider.type === 'openai_chatgpt_plan'
    || provider.requires_api_key === false || provider.auth === 'none' || provider.preset === 'ollama';
}

function validateVoiceSection(voice, providers) {
  if (voice === undefined || voice === null) return;
  if (!isObject(voice)) throw new Error('voice must be an object');
  const rules = [['active_tts', TTS_TYPES, 'tts_*'], ['active_asr', ASR_TYPES, 'asr_*']];
  for (const [field, types, label] of rules) {
    const key = voice[field];
    if (key === undefined || key === null) continue;
    if (!nonEmptyString(key)) throw new Error(`voice.${field} must be a non-empty string`);
    const provider = providers[key];
    if (!provider) throw new Error(`voice.${field} references unknown provider: ${key}`);
    if (!types.includes(provider.type)) {
      throw new Error(`voice.${field} provider ${key} must be a ${label} type (got ${provider.type})`);
    }
  }
}

function validateConfig(config) {
  if (!isObject(config)) {
    throw new Error('providers.yaml root must be an object');
  }

  if (!isObject(config.providers) || Object.keys(config.providers).length === 0) {
    throw new Error('providers must be a non-empty map');
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (isObject(provider) && provider.type === 'openai_chatgpt_plan') {
      if (name !== 'chatgpt') {
        throw new Error('openai_chatgpt_plan must use the reserved provider key chatgpt');
      }
      if (provider.base_url !== undefined && provider.base_url !== 'https://api.openai.com/v1') {
        throw new Error(`provider ${name} must use https://api.openai.com/v1`);
      }
      for (const field of ['api_key', 'api_key_env', 'headers', 'extra_body']) {
        if (Object.prototype.hasOwnProperty.call(provider, field)) {
          throw new Error(`provider ${name} cannot define ${field}`);
        }
      }
      if (Object.prototype.hasOwnProperty.call(provider, 'preset')) {
        throw new Error(`provider ${name} cannot define preset`);
      }
      for (const model of Array.isArray(provider.models) ? provider.models : []) {
        if (!isObject(model)) continue;
        for (const field of ['headers', 'extra_body', 'api_key', 'api_key_env']) {
          if (Object.prototype.hasOwnProperty.call(model, field)) {
            throw new Error(`provider ${name} models[] cannot define ${field}`);
          }
        }
      }
    }
  }

  const hasActiveModel = nonEmptyString(config.active_model);
  if (!hasActiveModel && !nonEmptyString(config.active_provider)) {
    throw new Error('active_provider must be a non-empty string');
  }
  if (!hasActiveModel && !config.providers[config.active_provider]) {
    throw new Error(`active_provider not found in providers: ${config.active_provider}`);
  }

  const normalized = normalizeProviderConfig(config);
  const providers = normalized.providers;

  for (const [name, provider] of Object.entries(providers)) {
    if (!isObject(provider)) {
      throw new Error(`provider ${name} must be an object`);
    }

    const type = provider.type;
    if (!SUPPORTED_TYPES.includes(type)) {
      throw new Error(`provider ${name} type must be one of: ${SUPPORTED_TYPES.join(', ')}`);
    }

    if (CHAT_TYPES.includes(type) || type === 'asr_openai_compatible' || type === 'tts_openai_compatible') {
      if (!nonEmptyString(provider.base_url)) {
        throw new Error(`provider ${name} must define base_url`);
      }
    }

    if (CHAT_TYPES.includes(type)) {
      if (!Array.isArray(provider.models) || provider.models.length === 0) {
        throw new Error(`provider ${name} must define model`);
      }
      for (const model of provider.models) {
        if (!nonEmptyString(model.id)) {
          throw new Error(`provider ${name} models[].id must be a non-empty string`);
        }
        for (const [field, allowed] of [['input', MODEL_INPUT_TYPES], ['output', MODEL_OUTPUT_TYPES]]) {
          if (model[field] === undefined) continue;
          if (!Array.isArray(model[field]) || model[field].length === 0 || model[field].some((item) => !allowed.includes(item))) {
            throw new Error(`provider ${name} model ${model.id} ${field} must contain only: ${allowed.join(', ')}`);
          }
        }
        if (model.transport !== undefined && !MODEL_TRANSPORTS.includes(model.transport)) {
          throw new Error(`provider ${name} model ${model.id} transport must be one of: ${MODEL_TRANSPORTS.join(', ')}`);
        }
        if (model.audio !== undefined) {
          if (!isObject(model.audio) || !MODEL_AUDIO_MODES.includes(model.audio.mode)) {
            throw new Error(`provider ${name} model ${model.id} audio.mode must be one of: ${MODEL_AUDIO_MODES.join(', ')}`);
          }
          if (!Array.isArray(model.input) || !model.input.includes('audio')) {
            throw new Error(`provider ${name} model ${model.id} audio configuration requires input: audio`);
          }
          if (model.audio.mode === 'realtime' && model.transport !== 'realtime') {
            throw new Error(`provider ${name} model ${model.id} realtime audio requires transport: realtime`);
          }
        }
      }
    }

    if (type === 'openai_chatgpt_plan' && provider.base_url !== 'https://api.openai.com/v1') {
      throw new Error(`provider ${name} must use https://api.openai.com/v1`);
    }

    if (ASR_TYPES.includes(type) && !nonEmptyString(provider.model)) {
      throw new Error(`provider ${name} must define model`);
    }

    // tts_dashscope 需要 tts_model + tts_voice + base_url
    if (type === 'tts_dashscope') {
      if (!nonEmptyString(provider.tts_model)) {
        throw new Error(`provider ${name} must define tts_model`);
      }
      if (!nonEmptyString(provider.tts_voice)) {
        throw new Error(`provider ${name} must define tts_voice`);
      }
      if (!nonEmptyString(provider.base_url)) {
        throw new Error(`provider ${name} must define base_url`);
      }
    }
    if (type === 'tts_openai_compatible') {
      if (!nonEmptyString(provider.tts_model)) {
        throw new Error(`provider ${name} must define tts_model`);
      }
      if (!nonEmptyString(provider.tts_voice)) {
        throw new Error(`provider ${name} must define tts_voice`);
      }
      if (provider.format !== undefined && !TTS_FORMATS.includes(provider.format)) {
        throw new Error(`provider ${name} format must be one of: ${TTS_FORMATS.join(', ')}`);
      }
    }
    const hasInlineKey = nonEmptyString(provider.api_key);
    const hasEnvKey = nonEmptyString(provider.api_key_env);
    if (!hasInlineKey && !hasEnvKey && !apiKeyOptional(provider)) {
      throw new Error(`provider ${name} must define api_key or api_key_env`);
    }
  }

  validateVoiceSection(config.voice, providers);

  const known = new Set();
  for (const [name, provider] of Object.entries(providers)) {
    if (CHAT_TYPES.includes(provider.type)) {
      for (const model of provider.models) known.add(`${name}/${model.id}`);
    }
  }
  const assertRef = (field, ref) => {
    if (!known.has(String(ref))) {
      throw new Error(`${field} references unknown model: ${ref}`);
    }
  };
  if (hasActiveModel) assertRef('active_model', config.active_model);
  if (config.enabled_models !== undefined) {
    if (!Array.isArray(config.enabled_models)) throw new Error('enabled_models must be an array');
    config.enabled_models.forEach((ref) => assertRef('enabled_models', ref));
  }
  if (config.fallback_models !== undefined) {
    if (!Array.isArray(config.fallback_models)) throw new Error('fallback_models must be an array');
    config.fallback_models.forEach((ref) => assertRef('fallback_models', ref));
  }
  if (config.roles !== undefined) {
    if (!isObject(config.roles)) throw new Error('roles must be an object');
    for (const ref of Object.values(config.roles)) assertRef('roles', ref);
  }
}

class ProviderConfigStore {
  constructor({ configPath } = {}) {
    this.configPath = configPath
      || process.env.PROVIDER_CONFIG_PATH
      || path.join(getRuntimePaths().configDir, 'providers.yaml');
    this.ensureExists();
  }

  ensureExists() {
    if (fs.existsSync(this.configPath)) return;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, YAML.stringify(DEFAULT_CONFIG), 'utf8');
  }

  loadRawYaml() {
    this.ensureExists();
    return fs.readFileSync(this.configPath, 'utf8');
  }

  loadNormalized() {
    return normalizeProviderConfig(this.load());
  }

  load() {
    const raw = this.loadRawYaml();
    const parsed = YAML.parse(raw);
    validateConfig(parsed);
    return parsed;
  }

  saveRawYaml(rawYaml) {
    const parsed = YAML.parse(rawYaml);
    validateConfig(parsed);
    fs.writeFileSync(this.configPath, YAML.stringify(parsed), 'utf8');
    return parsed;
  }

  save(config) {
    validateConfig(config);
    fs.writeFileSync(this.configPath, YAML.stringify(config), 'utf8');
  }
}

module.exports = {
  ProviderConfigStore,
  validateConfig,
  normalizeProviderConfig,
  splitModelRef,
  CHAT_TYPES,
  ASR_TYPES,
  TTS_TYPES,
  SUPPORTED_TYPES
};
