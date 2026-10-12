// Model Catalog — contract C4.2 in docs/plans/PLAN-android-companion-contracts.md.
// Reads providers.yaml (v1 or v2) through normalizeProviderConfig, so every consumer sees
// the same multi-model view. The exported surface is stable (WS1/WS2/WS3 depend on it).
const { ProviderConfigStore, normalizeProviderConfig } = require('./providerConfigStore');

const CHAT_TYPES = new Map([
  ['openai_compatible', 'openai-completions'],
  ['anthropic', 'anthropic-messages'],
  ['google', 'google-generative-ai']
]);

function resolveApiKey(provider) {
  if (typeof provider.api_key === 'string' && provider.api_key) return provider.api_key;
  if (typeof provider.api_key_env === 'string' && provider.api_key_env) {
    return process.env[provider.api_key_env] || null;
  }
  return null;
}

function toDescriptor(providerKey, provider, model = {}) {
  const id = String(model.id || provider.model || '');
  return {
    ref: `${providerKey}/${id}`,
    provider: providerKey,
    id,
    name: model.name || id,
    api: CHAT_TYPES.get(provider.type),
    base_url: String(provider.base_url || '').replace(/\/$/, ''),
    api_key: resolveApiKey(provider),
    api_key_env: provider.api_key_env || null,
    headers: { ...(provider.headers || {}), ...(model.headers || {}) },
    timeout_ms: Number(provider.timeout_ms) || 20000,
    max_retries: provider.max_retries !== undefined ? Number(provider.max_retries) : null,
    context_window: Number(model.context_window) || null,
    max_tokens: Number(model.max_tokens) || null,
    reasoning: Boolean(model.reasoning),
    input: Array.isArray(model.input) ? model.input : ['text'],
    compat: { ...(provider.compat || {}), ...(model.compat || {}) },
    extra_body: { ...(provider.extra_body || {}), ...(model.extra_body || {}) },
    temperature: model.temperature !== undefined
      ? Number(model.temperature)
      : (provider.temperature !== undefined ? Number(provider.temperature) : null)
  };
}

function findByType(config, types) {
  for (const [key, provider] of Object.entries(config.providers || {})) {
    if (types.includes(provider.type)) {
      return { key, ...provider, api_key: resolveApiKey(provider) };
    }
  }
  return null;
}

const TTS_TYPES = ['tts_dashscope', 'tts_openai_compatible'];
const ASR_TYPES = ['asr_openai_compatible', 'asr_dashscope'];

// Resolution: explicit key (voice.active_*) -> env fallback key (TTS only) -> first provider of that kind.
function resolveVoiceProvider(config, types, candidateKeys) {
  const providers = config.providers || {};
  for (const key of candidateKeys) {
    const provider = key && providers[key];
    if (provider && types.includes(provider.type)) {
      return { key, ...provider, api_key: resolveApiKey(provider) };
    }
  }
  return findByType(config, types);
}

function loadModelCatalog({ store = new ProviderConfigStore() } = {}) {
  const config = normalizeProviderConfig(store.load());
  const models = [];
  for (const [key, provider] of Object.entries(config.providers || {})) {
    if (!CHAT_TYPES.has(provider.type)) continue;
    const list = Array.isArray(provider.models) && provider.models.length > 0
      ? provider.models
      : [{ id: provider.model }];
    for (const model of list) models.push(toDescriptor(key, provider, model));
  }

  const byRef = new Map(models.map((m) => [m.ref, m]));
  const resolve = (ref) => byRef.get(String(ref || '')) || null;

  const active = resolve(config.active_model) || models[0] || null;

  const enabledRefs = Array.isArray(config.enabled_models) ? config.enabled_models : [];
  const enabled = enabledRefs.map(resolve).filter(Boolean);
  const roles = config.roles && typeof config.roles === 'object' ? config.roles : {};
  const fallbackRefs = Array.isArray(config.fallback_models) ? config.fallback_models : [];

  return {
    models,
    enabled: enabled.length > 0 ? enabled : (active ? [active] : []),
    active,
    resolve,
    forRole: (role) => resolve(roles[role]) || active,
    fallbackChain: () => {
      const chain = [active, ...fallbackRefs.map(resolve)].filter(Boolean);
      return chain.filter((m, i) => chain.findIndex((x) => x.ref === m.ref) === i);
    },
    tts: resolveVoiceProvider(config, TTS_TYPES, [config.voice?.active_tts, process.env.TTS_PROVIDER_KEY]),
    asr: resolveVoiceProvider(config, ASR_TYPES, [config.voice?.active_asr])
  };
}

module.exports = { loadModelCatalog, toDescriptor, resolveVoiceProvider, resolveApiKey, TTS_TYPES, ASR_TYPES };
