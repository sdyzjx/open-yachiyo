const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');

const TTS_PROVIDER_KEY = process.env.TTS_PROVIDER_KEY || 'qwen3_tts';

function resolveApiKey(provider) {
  if (!provider || typeof provider !== 'object') return '';
  if (typeof provider.api_key === 'string' && provider.api_key.trim()) return provider.api_key.trim();
  if (typeof provider.api_key_env === 'string' && provider.api_key_env.trim()) {
    return String(process.env[provider.api_key_env] || '').trim();
  }
  return '';
}

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim() || 'https://dashscope.aliyuncs.com/api/v1';
  return raw.replace(/\/$/, '');
}

function inferMimeTypeFromUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.ogg')) return 'audio/ogg';
  return 'audio/ogg';
}

class QwenTtsClient {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.providerStore = new ProviderConfigStore();
  }

  loadProviderConfig() {
    const config = this.providerStore.load();
    const provider = config?.providers?.[TTS_PROVIDER_KEY];
    if (!provider || provider.type !== 'tts_dashscope') {
      const err = new Error(`tts provider ${TTS_PROVIDER_KEY} is missing or invalid`);
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }

    const apiKey = resolveApiKey(provider);
    if (!apiKey) {
      const err = new Error('tts provider api key is missing');
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }

    return {
      apiKey,
      baseUrl: normalizeBaseUrl(provider.base_url),
      defaultModel: String(provider.tts_model || 'qwen3-tts-vc-2026-01-22'),
      defaultVoice: String(provider.tts_voice || ''),
      defaultInstructions: String(provider.tts_instructions || '').trim(),
      defaultOptimizeInstructions: provider.tts_optimize_instructions === true,
      provider
    };
  }

  async synthesizeNonStreaming({
    text,
    model,
    voice,
    languageType = 'Chinese',
    timeoutMs = 30000,
    instructions = '',
    optimizeInstructions = false
  } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultModel);
    const finalVoice = String(voice || cfg.defaultVoice);
    const finalInstructions = String(instructions || cfg.defaultInstructions || '').trim();
    const finalOptimizeInstructions = optimizeInstructions === true || cfg.defaultOptimizeInstructions === true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `${cfg.baseUrl}/services/aigc/multimodal-generation/generation`;
      const requestBody = {
        model: finalModel,
        input: {
          text: content,
          voice: finalVoice,
          language_type: languageType
        }
      };
      if (finalInstructions) {
        requestBody.instructions = finalInstructions;
        requestBody.optimize_instructions = finalOptimizeInstructions;
      }
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      const bodyText = await response.text();
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch (_) {
        body = null;
      }

      if (!response.ok) {
        const err = new Error(`tts provider http ${response.status}`);
        err.code = response.status === 401 || response.status === 403 ? 'TTS_PROVIDER_AUTH_FAILED' : 'TTS_PROVIDER_DOWN';
        err.meta = { status: response.status, body: body || bodyText };
        throw err;
      }

      const audioUrl = body?.output?.audio?.url || body?.output?.audio_url || '';
      if (!audioUrl) {
        const err = new Error('tts response missing audio url');
        err.code = 'TTS_PROVIDER_DOWN';
        err.meta = { body };
        throw err;
      }

      return {
        audioUrl,
        model: finalModel,
        voice: finalVoice,
        mimeType: inferMimeTypeFromUrl(audioUrl)
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error('tts timeout');
        timeoutErr.code = 'TTS_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchAudioBuffer({ audioUrl, timeoutMs = 30000 } = {}) {
    const url = String(audioUrl || '').trim();
    if (!url) {
      const err = new Error('audioUrl is required');
      err.code = 'TTS_AUDIO_FETCH_FAILED';
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        const err = new Error(`audio fetch http ${response.status}`);
        err.code = 'TTS_AUDIO_FETCH_FAILED';
        throw err;
      }
      const ab = await response.arrayBuffer();
      return Buffer.from(ab);
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error('audio fetch timeout');
        timeoutErr.code = 'TTS_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  QwenTtsClient
};
