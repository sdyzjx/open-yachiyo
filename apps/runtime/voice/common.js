// Shared helpers for the voice provider abstraction (TTS / ASR). Contract C8 in
// docs/plans/PLAN-desktop-companion-v2.md.
const { ProviderConfigStore, normalizeProviderConfig } = require('../config/providerConfigStore');
const { resolveVoiceProvider, TTS_TYPES, ASR_TYPES } = require('../config/modelCatalog');

function voiceError(code, message, meta) {
  const err = new Error(message);
  err.code = code;
  if (meta !== undefined) err.meta = meta;
  return err;
}

function resolveSecret(provider) {
  if (!provider || typeof provider !== 'object') return '';
  if (typeof provider.api_key === 'string' && provider.api_key.trim()) return provider.api_key.trim();
  if (typeof provider.api_key_env === 'string' && provider.api_key_env.trim()) {
    return String(process.env[provider.api_key_env] || '').trim();
  }
  return '';
}

function keyOptional(provider) {
  return provider.requires_api_key === false || provider.auth === 'none';
}

function trimSlash(url, fallback = '') {
  return (String(url || '').trim() || fallback).replace(/\/+$/, '');
}

function defaultStore() {
  return new ProviderConfigStore();
}

function loadConfig(store) {
  return normalizeProviderConfig((store || defaultStore()).load());
}

// Returns { key, provider } for the active (or explicitly requested) provider of a kind, or null.
function pickProvider(config, kind, providerKey) {
  const types = kind === 'tts' ? TTS_TYPES : ASR_TYPES;
  if (providerKey) {
    const provider = config.providers?.[providerKey];
    return provider && types.includes(provider.type) ? { key: providerKey, provider } : null;
  }
  const candidates = kind === 'tts'
    ? [config.voice?.active_tts, process.env.TTS_PROVIDER_KEY]
    : [config.voice?.active_asr];
  const found = resolveVoiceProvider(config, types, candidates);
  return found ? { key: found.key, provider: config.providers[found.key] } : null;
}

// fetch with timeout; maps abort to <PREFIX>_TIMEOUT.
async function timedFetch(fetchImpl, url, options, timeoutMs, prefix) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw voiceError(`${prefix}_TIMEOUT`, `${prefix.toLowerCase()} timeout`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { voiceError, resolveSecret, keyOptional, trimSlash, loadConfig, pickProvider, timedFetch, TTS_TYPES, ASR_TYPES };
