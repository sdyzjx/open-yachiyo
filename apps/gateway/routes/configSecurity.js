// Shared redaction helpers for the configuration HTTP APIs (plan PLAN-desktop-companion-v2 §3).
// Provider snapshots only ever carry a fixed allow-list of fields; secrets and free-form
// objects (headers / extra_body) are reduced to booleans.

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function hasEnvKey(provider) {
  return Boolean(provider.api_key_env && process.env[provider.api_key_env]);
}

function requiresApiKey(provider) {
  return !(provider.requires_api_key === false || provider.auth === 'none' || provider.preset === 'ollama');
}

// Allow-listed compat flags (booleans / short strings only; never free-form objects).
function safeCompat(compat) {
  if (!isObject(compat)) return {};
  const out = {};
  for (const [key, value] of Object.entries(compat)) {
    if (['boolean', 'number'].includes(typeof value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= 64) out[key] = value;
  }
  return out;
}

const VOICE_SAFE_FIELDS = [
  'tts_model', 'tts_voice', 'tts_realtime_model', 'tts_realtime_voice', 'model', 'format', 'language'
];

function safeProviderSnapshot(key, provider) {
  const snapshot = {
    key,
    type: provider.type,
    preset: provider.preset || null,
    display_name: provider.display_name || key,
    base_url: provider.base_url || null,
    realtime_url: provider.realtime_url || null,
    api_key_env: provider.api_key_env || null,
    has_api_key: Boolean(provider.api_key) || hasEnvKey(provider),
    requires_api_key: requiresApiKey(provider),
    timeout_ms: provider.timeout_ms || null,
    has_custom_headers: hasKeys(provider.headers),
    has_extra_body: hasKeys(provider.extra_body),
    models: Array.isArray(provider.models) ? provider.models : []
  };
  if (isObject(provider.compat)) snapshot.compat = safeCompat(provider.compat);
  for (const field of VOICE_SAFE_FIELDS) {
    if (provider[field] !== undefined && typeof provider[field] !== 'object') snapshot[field] = provider[field];
  }
  if (snapshot.type && String(snapshot.type).startsWith('asr_') && snapshot.model === undefined && provider.asr_model) {
    snapshot.model = provider.asr_model;
  }
  // models[] entries may carry per-model headers / extra_body: reduce them too.
  snapshot.models = snapshot.models.map((m) => {
    if (!isObject(m)) return m;
    const { headers, extra_body: extraBody, ...rest } = m;
    return {
      ...rest,
      ...(hasKeys(headers) ? { has_custom_headers: true } : {}),
      ...(hasKeys(extraBody) ? { has_extra_body: true } : {})
    };
  });
  return snapshot;
}

// Descriptor (modelCatalog.toDescriptor) -> public view without credentials or free-form objects.
function safeModelDescriptor(descriptor, enabled) {
  const { api_key: apiKey, headers, extra_body: extraBody, compat, audio, ...rest } = descriptor;
  delete rest.refresh_access_token;
  const safeAudio = isObject(audio) ? {
    mode: ['direct', 'realtime'].includes(audio.mode) ? audio.mode : null,
    input_format: typeof audio.input_format === 'string' ? audio.input_format : null,
    input_sample_rate: Number(audio.input_sample_rate) || null,
    output_format: typeof audio.output_format === 'string' ? audio.output_format : null,
    output_sample_rate: Number(audio.output_sample_rate) || null
  } : null;
  return {
    ...rest,
    compat: safeCompat(compat),
    audio: safeAudio,
    has_api_key: Boolean(apiKey),
    has_custom_headers: hasKeys(headers),
    has_extra_body: hasKeys(extraBody),
    enabled
  };
}

// Legacy GET /api/config/providers/config shape (providers map), redacted to safe snapshots.
function safeLegacyProviderConfig(config) {
  const result = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (key !== 'providers') result[key] = value;
  }
  result.providers = {};
  for (const [key, provider] of Object.entries(config?.providers || {})) {
    if (isObject(provider)) result.providers[key] = safeProviderSnapshot(key, provider);
  }
  return result;
}

// Snapshots hide per-model headers/extra_body, so keep them when the UI writes the list back.
function mergeModels(previous, incoming) {
  const prev = new Map((Array.isArray(previous) ? previous : [])
    .filter(isObject).map((m) => [String(m.id), m]));
  return incoming.map((entry) => {
    const model = isObject(entry) ? { ...entry } : { id: entry };
    delete model.has_custom_headers;
    delete model.has_extra_body;
    const old = prev.get(String(model.id));
    if (!old) return model;
    const kept = {};
    if (model.headers === undefined && old.headers !== undefined) kept.headers = old.headers;
    if (model.extra_body === undefined && old.extra_body !== undefined) kept.extra_body = old.extra_body;
    return { ...kept, ...model };
  });
}

// Provider upsert with patch semantics:
//  - fields absent from `input` keep their stored value (incl. headers/extra_body/compat);
//  - `null` removes an optional field;
//  - empty/absent api_key keeps the stored key; only clear_api_key === true removes it.
function applyProviderPatch(previous, input) {
  const base = isObject(previous) ? previous : {};
  const next = { ...base };
  for (const [field, value] of Object.entries(input)) {
    if (['clear_api_key', 'has_api_key', 'has_custom_headers', 'has_extra_body', 'key'].includes(field)) continue;
    if (field === 'api_key') continue;
    if (value === null) delete next[field];
    else if (field === 'models' && Array.isArray(value)) next.models = mergeModels(base.models, value);
    else next[field] = value;
  }
  if (input.clear_api_key === true) delete next.api_key;
  else if (typeof input.api_key === 'string' && input.api_key !== '') next.api_key = input.api_key;
  return next;
}

module.exports = {
  applyProviderPatch,
  isObject,
  safeCompat,
  safeLegacyProviderConfig,
  safeModelDescriptor,
  safeProviderSnapshot
};
