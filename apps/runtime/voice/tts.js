const { voiceError, resolveSecret, keyOptional, trimSlash, loadConfig, pickProvider, timedFetch } = require('./common');

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const DASHSCOPE_DEFAULT_MODEL = 'qwen3-tts-vc-2026-01-22';
const FORMAT_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/pcm' };

function inferMimeFromUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.ogg')) return 'audio/ogg';
  return 'audio/ogg';
}

// tts_realtime_model, or the legacy realtime_model field.
function realtimeModelOf(provider) {
  return String(provider.tts_realtime_model || provider.realtime_model || '').trim();
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function httpError(response, bodyText) {
  const body = parseJson(bodyText);
  const auth = response.status === 401 || response.status === 403;
  return voiceError(auth ? 'TTS_PROVIDER_AUTH_FAILED' : 'TTS_PROVIDER_DOWN', `tts provider http ${response.status}`, { status: response.status, body: body || bodyText });
}

// DashScope step 1: ask for a synthesized audio URL.
async function dashscopeRequestAudioUrl({ fetchImpl, baseUrl, apiKey, model, voice, text, languageType = 'Chinese', timeoutMs = 30000 }) {
  const response = await timedFetch(fetchImpl, `${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: { text, voice, language_type: languageType } })
  }, timeoutMs, 'TTS');
  const bodyText = await response.text();
  if (!response.ok) throw httpError(response, bodyText);
  const body = parseJson(bodyText);
  const audioUrl = body?.output?.audio?.url || body?.output?.audio_url || '';
  if (!audioUrl) throw voiceError('TTS_PROVIDER_DOWN', 'tts response missing audio url', { body });
  return { audioUrl, mime: inferMimeFromUrl(audioUrl) };
}

// DashScope step 2 (also used standalone): download the audio bytes.
async function fetchAudioBuffer({ fetchImpl, audioUrl, timeoutMs = 30000 }) {
  const url = String(audioUrl || '').trim();
  if (!url) throw voiceError('TTS_AUDIO_FETCH_FAILED', 'audioUrl is required');
  const response = await timedFetch(fetchImpl, url, {}, timeoutMs, 'TTS');
  if (!response.ok) throw voiceError('TTS_AUDIO_FETCH_FAILED', `audio fetch http ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function resolveTtsProvider({ store, providerKey }) {
  const config = loadConfig(store);
  const picked = pickProvider(config, 'tts', providerKey);
  if (!picked) {
    throw voiceError('TTS_CONFIG_MISSING', providerKey
      ? `tts provider ${providerKey} is missing or not a tts_* provider`
      : 'no tts provider configured (add a tts_* provider to providers.yaml)');
  }
  const apiKey = resolveSecret(picked.provider);
  if (!apiKey && !keyOptional(picked.provider)) {
    throw voiceError('TTS_CONFIG_MISSING', `tts provider ${picked.key} api key is missing`);
  }
  return { key: picked.key, provider: picked.provider, apiKey };
}

function createTtsClient({ store, providerKey, fetchImpl = globalThis.fetch } = {}) {
  const { key, provider, apiKey } = resolveTtsProvider({ store, providerKey });
  const requireText = (text) => {
    const content = String(text || '').trim();
    if (!content) throw voiceError('TTS_INVALID_PARAMS', 'text is required');
    return content;
  };

  if (provider.type === 'tts_dashscope') {
    const baseUrl = trimSlash(provider.base_url, DASHSCOPE_BASE);
    return {
      providerKey: key,
      type: provider.type,
      supportsRealtime: realtimeModelOf(provider).length > 0,
      async synthesize({ text, voice, model, languageType, timeoutMs = 30000 } = {}) {
        const content = requireText(text);
        const finalModel = String(model || provider.tts_model || DASHSCOPE_DEFAULT_MODEL);
        const finalVoice = String(voice || provider.tts_voice || '');
        const { audioUrl, mime } = await dashscopeRequestAudioUrl({ fetchImpl, baseUrl, apiKey, model: finalModel, voice: finalVoice, text: content, languageType, timeoutMs });
        const buffer = await fetchAudioBuffer({ fetchImpl, audioUrl, timeoutMs });
        return { buffer, mime, model: finalModel, voice: finalVoice, audioUrl };
      },
      // DashScope-only: resolve the remote URL without downloading (desktop remote playback).
      async synthesizeUrl({ text, voice, model, languageType, timeoutMs = 30000 } = {}) {
        const content = requireText(text);
        const finalModel = String(model || provider.tts_model || DASHSCOPE_DEFAULT_MODEL);
        const finalVoice = String(voice || provider.tts_voice || '');
        const { audioUrl, mime } = await dashscopeRequestAudioUrl({ fetchImpl, baseUrl, apiKey, model: finalModel, voice: finalVoice, text: content, languageType, timeoutMs });
        return { audioUrl, mime, model: finalModel, voice: finalVoice };
      },
      fetchAudioBuffer: ({ audioUrl, timeoutMs } = {}) => fetchAudioBuffer({ fetchImpl, audioUrl, timeoutMs })
    };
  }

  // tts_openai_compatible
  const baseUrl = trimSlash(provider.base_url);
  const format = String(provider.format || 'mp3');
  return {
    providerKey: key,
    type: provider.type,
    supportsRealtime: false,
    async synthesize({ text, voice, model, timeoutMs = 30000 } = {}) {
      const content = requireText(text);
      const finalModel = String(model || provider.tts_model);
      const finalVoice = String(voice || provider.tts_voice);
      const response = await timedFetch(fetchImpl, `${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { ...(provider.headers || {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), 'content-type': 'application/json' },
        body: JSON.stringify({ model: finalModel, voice: finalVoice, input: content, response_format: format })
      }, timeoutMs, 'TTS');
      if (!response.ok) throw httpError(response, await response.text());
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw voiceError('TTS_PROVIDER_DOWN', 'tts response is empty');
      const headerType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim();
      const mime = headerType.startsWith('audio/') ? headerType : (FORMAT_MIME[format] || 'audio/mpeg');
      return { buffer, mime, model: finalModel, voice: finalVoice };
    }
  };
}

module.exports = { createTtsClient, realtimeModelOf, resolveTtsProvider, fetchAudioBuffer, dashscopeRequestAudioUrl, inferMimeFromUrl, FORMAT_MIME };
