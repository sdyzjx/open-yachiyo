const { voiceError, resolveSecret, keyOptional, trimSlash, loadConfig, pickProvider, timedFetch } = require('./common');

function languageName(lang) {
  return lang === 'zh' ? 'Chinese' : 'English';
}

// Builds an ASR client from an already-resolved provider object (api key resolved here).
function buildAsrClient({ key = null, provider, fetchImpl = globalThis.fetch }) {
  const apiKey = String(provider.api_key || resolveSecret(provider) || '');
  const base = trimSlash(provider.base_url);
  const timeoutMs = Number(provider.timeout_ms) || 60000;
  const model = provider.model || provider.asr_model;
  const headers = { ...(provider.headers || {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };

  return {
    providerKey: key,
    type: provider.type,
    async transcribe({ buffer, mime = 'audio/wav', lang = 'auto' } = {}) {
      let endpoint; let body; const reqHeaders = { ...headers };
      if (provider.type === 'asr_openai_compatible') {
        endpoint = `${base}/audio/transcriptions`;
        body = new FormData();
        body.append('file', new Blob([buffer], { type: mime }), mime.includes('wav') ? 'input.wav' : 'input.audio');
        body.append('model', model || 'whisper-1');
        if (lang !== 'auto') body.append('language', lang);
      } else if (provider.type === 'asr_dashscope') {
        // Qwen ASR supports inline audio via the OpenAI-compatible multimodal endpoint.
        endpoint = `${base.replace(/\/api\/v1$/, '/compatible-mode/v1')}/chat/completions`;
        reqHeaders['content-type'] = 'application/json';
        body = JSON.stringify({
          model: model || 'qwen3-asr-flash',
          messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${Buffer.from(buffer).toString('base64')}` } }] }],
          stream: false,
          asr_options: { enable_itn: false, ...(lang !== 'auto' ? { language: languageName(lang) } : {}) }
        });
      } else {
        throw voiceError('ASR_CONFIG_MISSING', `unsupported asr provider type: ${provider.type}`);
      }
      const response = await timedFetch(fetchImpl, endpoint, { method: 'POST', headers: reqHeaders, body }, timeoutMs, 'ASR');
      if (!response.ok) throw voiceError('ASR_HTTP_ERROR', `ASR HTTP ${response.status}`, { status: response.status });
      const result = await response.json();
      const text = result.text || result.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw voiceError('ASR_EMPTY', 'Empty ASR transcript');
      return { text: text.trim() };
    }
  };
}

function createAsrClient({ store, providerKey, fetchImpl = globalThis.fetch } = {}) {
  const config = loadConfig(store);
  const picked = pickProvider(config, 'asr', providerKey);
  if (!picked) {
    throw voiceError('ASR_CONFIG_MISSING', providerKey
      ? `asr provider ${providerKey} is missing or not an asr_* provider`
      : 'no asr provider configured (add an asr_* provider to providers.yaml)');
  }
  if (!resolveSecret(picked.provider) && !keyOptional(picked.provider)) {
    throw voiceError('ASR_CONFIG_MISSING', `asr provider ${picked.key} api key is missing`);
  }
  return buildAsrClient({ key: picked.key, provider: picked.provider, fetchImpl });
}

module.exports = { createAsrClient, buildAsrClient };
