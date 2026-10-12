// Backward-compatible desktop TTS wrapper. The real logic lives in apps/runtime/voice (contract C8);
// the provider is resolved on every call so switching voice.active_tts takes effect immediately.
const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');
const { createTtsClient } = require('../../../runtime/voice');
const { fetchAudioBuffer } = require('../../../runtime/voice/tts');

class QwenTtsClient {
  constructor({ fetchImpl = globalThis.fetch, store = null } = {}) {
    this.fetchImpl = fetchImpl;
    this.store = store;
  }

  createClient() {
    if (!this.store) this.store = new ProviderConfigStore();
    return createTtsClient({ store: this.store, fetchImpl: this.fetchImpl });
  }

  // Active provider capabilities, used to gate realtime transport.
  describeActive() {
    try {
      const client = this.createClient();
      return { providerKey: client.providerKey, type: client.type, supportsRealtime: client.supportsRealtime };
    } catch (_) {
      return null;
    }
  }

  // Returns { audioUrl, model, voice, mimeType }. Providers without a remote URL (e.g.
  // tts_openai_compatible) are returned as a data: URL so callers keep a single playback path.
  async synthesizeNonStreaming({ text, model, voice, languageType, timeoutMs = 30000 } = {}) {
    const client = this.createClient();
    if (typeof client.synthesizeUrl === 'function') {
      const r = await client.synthesizeUrl({ text, model, voice, languageType, timeoutMs });
      return { audioUrl: r.audioUrl, model: r.model, voice: r.voice, mimeType: r.mime };
    }
    const r = await client.synthesize({ text, model, voice, timeoutMs });
    return { audioUrl: `data:${r.mime};base64,${r.buffer.toString('base64')}`, model: r.model, voice: r.voice, mimeType: r.mime };
  }

  async fetchAudioBuffer({ audioUrl, timeoutMs = 30000 } = {}) {
    const url = String(audioUrl || '').trim();
    const dataMatch = /^data:[^,]*;base64,(.*)$/s.exec(url);
    if (dataMatch) return Buffer.from(dataMatch[1], 'base64');
    return fetchAudioBuffer({ fetchImpl: this.fetchImpl, audioUrl: url, timeoutMs });
  }
}

module.exports = { QwenTtsClient };
