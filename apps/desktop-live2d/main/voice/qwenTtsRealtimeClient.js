const WebSocket = require('ws');
const { randomUUID } = require('node:crypto');

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

function deriveRealtimeWsBaseUrl(httpBaseUrl) {
  const base = normalizeBaseUrl(httpBaseUrl);
  try {
    const parsed = new URL(base);
    const host = parsed.hostname;
    if (host === 'dashscope.aliyuncs.com') {
      return 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    }
    if (host === 'dashscope-intl.aliyuncs.com') {
      return 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
    }
    parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    parsed.pathname = '/api-ws/v1/realtime';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
  }
}

function buildRealtimeWsUrl({ wsBaseUrl, model }) {
  const base = String(wsBaseUrl || '').trim();
  const finalModel = String(model || '').trim() || 'qwen-tts-realtime';
  const parsed = new URL(base);
  parsed.searchParams.set('model', finalModel);
  return parsed.toString();
}

function parseWsMessage(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function estimateBase64Bytes(data) {
  const payload = String(data || '').trim();
  if (!payload) return 0;
  try {
    return Buffer.from(payload, 'base64').byteLength;
  } catch {
    return 0;
  }
}

class QwenTtsRealtimeClient {
  constructor({ WebSocketImpl = WebSocket } = {}) {
    this.providerStore = new ProviderConfigStore();
    this.WebSocketImpl = WebSocketImpl;
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

    const wsBaseUrl = String(
      provider.realtime_ws_url
      || process.env.DASHSCOPE_REALTIME_WS_URL
      || deriveRealtimeWsBaseUrl(provider.base_url)
    ).trim();

    const defaultRealtimeModel = String(provider.tts_realtime_model || provider.realtime_model || 'qwen-tts-realtime');
    const defaultVoice = String(provider.tts_realtime_voice || provider.realtime_voice || provider.tts_voice || '');

    return {
      apiKey,
      wsBaseUrl,
      defaultRealtimeModel,
      defaultVoice
    };
  }

  async streamSynthesis({
    text,
    model,
    voice,
    timeoutMs = 20000,
    maxChunks = 256,
    onEvent = null
  } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultRealtimeModel);
    const finalVoice = String(voice || cfg.defaultVoice);
    if (!finalVoice) {
      const err = new Error('realtime tts voice is required');
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    const wsUrl = buildRealtimeWsUrl({
      wsBaseUrl: cfg.wsBaseUrl,
      model: finalModel
    });

    const emitEvent = (type, payload = {}) => {
      if (typeof onEvent !== 'function') return;
      try {
        onEvent({
          type,
          timestamp: Date.now(),
          ...payload
        });
      } catch {
        // ignore onEvent callback failures
      }
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let completed = false;
      let chunkCount = 0;
      let totalAudioBytes = 0;
      const startedAt = Date.now();

      const socket = new this.WebSocketImpl(wsUrl, {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`
        }
      });

      const timer = setTimeout(() => {
        const err = new Error(`realtime tts timeout after ${timeoutMs}ms`);
        err.code = 'TTS_TIMEOUT';
        finish(err);
      }, Math.max(1, Number(timeoutMs) || 20000));

      const finish = (error, result = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore close errors
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };

      socket.on('open', () => {
        emitEvent('start', {
          model: finalModel,
          voice: finalVoice
        });

        const sessionUpdateMessage = {
          event_id: `event_${randomUUID()}`,
          type: 'session.update',
          session: {
            voice: finalVoice,
            format: 'pcm',
            sample_rate: 24000
          }
        };
        const appendTextMessage = {
          event_id: `event_${randomUUID()}`,
          type: 'input_text_buffer.append',
          text: content
        };
        const commitTextMessage = {
          event_id: `event_${randomUUID()}`,
          type: 'input_text_buffer.commit'
        };

        socket.send(JSON.stringify(sessionUpdateMessage));
        socket.send(JSON.stringify(appendTextMessage));
        socket.send(JSON.stringify(commitTextMessage));
      });

      socket.on('message', (raw) => {
        if (settled) return;
        const payload = parseWsMessage(raw);
        if (!payload) {
          emitEvent('event.invalid_json', {});
          return;
        }

        const type = String(payload.type || '').trim();
        if (type === 'error') {
          const err = new Error(payload?.error?.message || payload?.message || 'realtime tts provider error');
          err.code = 'TTS_REALTIME_PROVIDER_ERROR';
          emitEvent('error', {
            code: err.code,
            error: err.message
          });
          finish(err);
          return;
        }

        if (type === 'response.audio.delta') {
          const audioBase64 = String(payload.delta || payload.audio?.delta || '');
          const bytes = estimateBase64Bytes(audioBase64);
          totalAudioBytes += bytes;
          chunkCount += 1;
          emitEvent('chunk', {
            chunk_index: chunkCount,
            audio_bytes: bytes,
            total_audio_bytes: totalAudioBytes,
            audio_base64: audioBase64
          });
          if (chunkCount >= maxChunks) {
            const result = {
              ok: true,
              model: finalModel,
              voice: finalVoice,
              durationMs: Date.now() - startedAt,
              chunkCount,
              totalAudioBytes,
              truncated: true
            };
            emitEvent('done', result);
            finish(null, result);
          }
          return;
        }

        if (type === 'response.audio.done' || type === 'response.done' || type === 'response.completed' || type === 'session.finished') {
          if (completed) {
            return;
          }
          completed = true;
          const result = {
            ok: true,
            model: finalModel,
            voice: finalVoice,
            durationMs: Date.now() - startedAt,
            chunkCount,
            totalAudioBytes,
            truncated: false
          };
          emitEvent('done', result);
          finish(null, result);
          return;
        }

        emitEvent('event', {
          event_type: type || 'unknown'
        });
      });

      socket.on('error', (rawErr) => {
        const err = new Error(rawErr?.message || String(rawErr || 'realtime tts ws error'));
        err.code = err.code || 'TTS_REALTIME_WS_ERROR';
        emitEvent('error', {
          code: err.code,
          error: err.message
        });
        finish(err);
      });

      socket.on('close', (code, reason) => {
        if (settled) return;
        const hasData = chunkCount > 0 || totalAudioBytes > 0;
        if (hasData) {
          const result = {
            ok: true,
            model: finalModel,
            voice: finalVoice,
            durationMs: Date.now() - startedAt,
            chunkCount,
            totalAudioBytes,
            truncated: false,
            closed: true
          };
          emitEvent('done', result);
          finish(null, result);
          return;
        }
        const err = new Error(`realtime tts ws closed before completion (code=${code}, reason=${String(reason || '')})`);
        err.code = 'TTS_REALTIME_CLOSED';
        emitEvent('error', {
          code: err.code,
          error: err.message
        });
        finish(err);
      });
    });
  }
}

module.exports = {
  QwenTtsRealtimeClient,
  __internal: {
    deriveRealtimeWsBaseUrl,
    buildRealtimeWsUrl,
    estimateBase64Bytes
  }
};
