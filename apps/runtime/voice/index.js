// Voice provider abstraction (TTS / ASR). Contract C8: docs/plans/PLAN-desktop-companion-v2.md §2.
const { loadConfig, resolveSecret, pickProvider, TTS_TYPES, ASR_TYPES } = require('./common');
const { createTtsClient, realtimeModelOf } = require('./tts');
const { createAsrClient } = require('./asr');

const SAFE_FIELDS = ['display_name', 'base_url', 'api_key_env', 'timeout_ms', 'tts_model', 'tts_voice', 'tts_realtime_model', 'tts_realtime_voice', 'format', 'model'];

// Secret-free snapshot for UIs/APIs: never returns api_key, headers or extra_body values.
function describeVoiceConfig({ store } = {}) {
  const config = loadConfig(store);
  const tts = pickProvider(config, 'tts');
  const asr = pickProvider(config, 'asr');
  const providers = [];
  for (const [key, provider] of Object.entries(config.providers || {})) {
    const kind = TTS_TYPES.includes(provider.type) ? 'tts' : (ASR_TYPES.includes(provider.type) ? 'asr' : null);
    if (!kind) continue;
    const item = { key, kind, type: provider.type };
    for (const field of SAFE_FIELDS) if (provider[field] !== undefined) item[field] = provider[field];
    if (kind === 'asr' && item.model === undefined && provider.asr_model) item.model = provider.asr_model;
    item.has_api_key = Boolean(resolveSecret(provider));
    if (kind === 'tts') {
      item.supports_realtime = provider.type === 'tts_dashscope' && realtimeModelOf(provider).length > 0;
    }
    item.has_custom_headers = Boolean(provider.headers && Object.keys(provider.headers).length);
    providers.push(item);
  }
  return {
    active_tts: tts ? tts.key : null,
    active_asr: asr ? asr.key : null,
    selected_tts: config.voice?.active_tts || null,
    selected_asr: config.voice?.active_asr || null,
    providers
  };
}

module.exports = { createTtsClient, createAsrClient, describeVoiceConfig };
