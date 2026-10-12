// Voice configuration HTTP API — contract C8 (docs/plans/PLAN-desktop-companion-v2.md §2).
// Mounted from apps/gateway/server.js; the whole /api/config/** tree is loopback-only
// (configLoopbackOnly). Responses are `{ok, data}` and never contain api_key values.
//
// Runtime adapter: when workstream V's `apps/runtime/voice` exists it is preferred for
// synthesis (createTtsClient / describeVoiceConfig); otherwise providers.yaml is read
// directly and a minimal non-streaming client is used, so the routes work before and
// after V merges.
const express = require('express');
const { applyProviderPatch, isObject, safeProviderSnapshot } = require('./configSecurity');

const TTS_TYPES = ['tts_dashscope', 'tts_openai_compatible'];
const ASR_TYPES = ['asr_dashscope', 'asr_openai_compatible'];
const VOICE_TYPES = [...TTS_TYPES, ...ASR_TYPES];
const PROVIDER_KEY_RE = /^[A-Za-z0-9_.-]+$/;
const PATCH_FIELDS = [
  'type', 'display_name', 'base_url', 'api_key_env', 'timeout_ms', 'tts_model', 'tts_voice',
  'tts_realtime_model', 'tts_realtime_voice', 'model', 'format', 'api_key', 'clear_api_key'
];
const MAX_TEST_TEXT = 300;
const TEST_TIMEOUT_MS = 30000;

function loadVoiceRuntime() {
  try {
    // eslint-disable-next-line global-require
    return require('../../runtime/voice');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /runtime\/voice/.test(String(err.message))) return null;
    throw err;
  }
}

function inferMime(url, fallback = 'audio/mpeg') {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.ogg')) return 'audio/ogg';
  return fallback;
}

function createVoiceConfigRouter({
  llmManager,
  commitConfigChange = () => {},
  desktopLive2dConfigPath = null,
  fetchImpl = (...args) => fetch(...args),
  voiceRuntime = undefined // undefined: auto-detect; null: force legacy adapter; object: inject
}) {
  const router = express.Router();
  const store = llmManager.store;
  const runtime = voiceRuntime === undefined ? loadVoiceRuntime() : voiceRuntime;

  const ok = (res, data) => res.json({ ok: true, data });
  const fail = (res, status, error) => {
    let message = String(error.message || error).split('\n')[0];
    try {
      for (const p of Object.values(store.load().providers || {})) {
        if (typeof p?.api_key === 'string' && p.api_key.length >= 4) message = message.split(p.api_key).join('***');
      }
    } catch { /* ignore */ }
    res.status(status).json({ ok: false, error: message.slice(0, 600) });
  };

  const loadConfig = () => JSON.parse(JSON.stringify(store.load()));

  function firstOfTypes(config, types) {
    return Object.entries(config.providers || {}).find(([, p]) => isObject(p) && types.includes(p.type))?.[0] || null;
  }

  function resolveActive(config) {
    const voice = isObject(config.voice) ? config.voice : {};
    const valid = (key, types) => (key && isObject(config.providers[key]) && types.includes(config.providers[key].type) ? key : null);
    return {
      active_tts: valid(voice.active_tts, TTS_TYPES)
        || valid(process.env.TTS_PROVIDER_KEY, TTS_TYPES)
        || firstOfTypes(config, TTS_TYPES),
      active_asr: valid(voice.active_asr, ASR_TYPES) || firstOfTypes(config, ASR_TYPES)
    };
  }

  function desktopVoice() {
    const fallback = { path: 'electron_native', transport: 'non_streaming' };
    if (!desktopLive2dConfigPath) return fallback;
    try {
      const fs = require('node:fs');
      const { parseJsonWithComments, normalizeUiConfig } = require('../../desktop-live2d/main/config');
      if (!fs.existsSync(desktopLive2dConfigPath)) return fallback;
      const voice = normalizeUiConfig(parseJsonWithComments(fs.readFileSync(desktopLive2dConfigPath, 'utf8'))).voice;
      return { path: voice.path, transport: voice.transport };
    } catch {
      return fallback;
    }
  }

  function snapshot() {
    const config = store.load();
    const active = resolveActive(config);
    const providers = Object.entries(config.providers)
      .filter(([, p]) => isObject(p) && VOICE_TYPES.includes(p.type))
      .map(([key, p]) => ({
        ...safeProviderSnapshot(key, p),
        kind: TTS_TYPES.includes(p.type) ? 'tts' : 'asr',
        supports_realtime: p.type === 'tts_dashscope'
      }));
    return { ...active, providers, desktop: desktopVoice(), runtime: runtime ? 'voice-module' : 'providers-yaml' };
  }

  function saveConfig(config) {
    config.version = config.version || 2;
    llmManager.saveConfig(config); // validates
    commitConfigChange('providers.yaml');
  }

  // ---- GET /api/config/voice
  router.get('/api/config/voice', (req, res) => {
    try { ok(res, snapshot()); } catch (err) { fail(res, 500, err); }
  });

  // ---- PUT /api/config/voice/selection
  router.put('/api/config/voice/selection', (req, res) => {
    const body = req.body;
    if (!isObject(body)) return fail(res, 400, new Error('body must be an object'));
    try {
      const config = loadConfig();
      const voice = isObject(config.voice) ? { ...config.voice } : {};
      for (const [field, types] of [['active_tts', TTS_TYPES], ['active_asr', ASR_TYPES]]) {
        if (body[field] === undefined) continue;
        if (body[field] === null || body[field] === '') { delete voice[field]; continue; }
        const provider = config.providers[body[field]];
        if (typeof body[field] !== 'string' || !isObject(provider) || !types.includes(provider.type)) {
          return fail(res, 400, new Error(`${field} must reference a ${types[0].split('_')[0]} provider`));
        }
        voice[field] = body[field];
      }
      if (Object.keys(voice).length) config.voice = voice; else delete config.voice;
      saveConfig(config);
      return ok(res, snapshot());
    } catch (err) {
      return fail(res, 400, err);
    }
  });

  // ---- PUT /api/config/voice/providers/:key  (patch semantics)
  router.put('/api/config/voice/providers/:key', (req, res) => {
    const key = req.params.key;
    const input = req.body;
    if (!PROVIDER_KEY_RE.test(key)) return fail(res, 400, new Error('invalid provider key'));
    if (!isObject(input)) return fail(res, 400, new Error('body must be an object'));
    try {
      const config = loadConfig();
      const previous = config.providers[key];
      if (previous !== undefined && !(isObject(previous) && VOICE_TYPES.includes(previous.type))) {
        return fail(res, 400, new Error(`provider ${key} is not a voice provider`));
      }
      const patch = {};
      for (const field of PATCH_FIELDS) if (input[field] !== undefined) patch[field] = input[field];
      const next = applyProviderPatch(previous, patch);
      if (!VOICE_TYPES.includes(next.type)) {
        return fail(res, 400, new Error(`type must be one of: ${VOICE_TYPES.join(', ')}`));
      }
      if (patch.model !== undefined) delete next.asr_model; // `model` supersedes the legacy field
      config.providers[key] = next;
      saveConfig(config);
      return ok(res, snapshot());
    } catch (err) {
      return fail(res, 400, err);
    }
  });

  router.delete('/api/config/voice/providers/:key', (req, res) => {
    const key = req.params.key;
    try {
      const config = loadConfig();
      const provider = config.providers[key];
      if (!provider) return fail(res, 404, new Error(`provider not found: ${key}`));
      if (!VOICE_TYPES.includes(provider.type)) return fail(res, 400, new Error(`provider ${key} is not a voice provider`));
      delete config.providers[key];
      if (isObject(config.voice)) {
        for (const field of ['active_tts', 'active_asr']) if (config.voice[field] === key) delete config.voice[field];
        if (!Object.keys(config.voice).length) delete config.voice;
      }
      saveConfig(config);
      return ok(res, snapshot());
    } catch (err) {
      return fail(res, 400, err);
    }
  });

  // ---- synthesis for the 试听 button
  function resolveApiKey(provider) {
    if (typeof provider.api_key === 'string' && provider.api_key) return provider.api_key;
    if (provider.api_key_env && process.env[provider.api_key_env]) return process.env[provider.api_key_env];
    return '';
  }

  async function timedFetch(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function legacySynthesize(provider, text) {
    const apiKey = resolveApiKey(provider);
    if (!apiKey) throw new Error('该服务商缺少 API Key');
    const base = String(provider.base_url || '').replace(/\/+$/, '');
    if (provider.type === 'tts_openai_compatible') {
      const response = await timedFetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: provider.tts_model, voice: provider.tts_voice, input: text, response_format: provider.format || 'mp3'
        })
      });
      if (!response.ok) throw new Error(`TTS 服务返回 HTTP ${response.status}`);
      const mime = response.headers.get('content-type') || (provider.format === 'wav' ? 'audio/wav' : 'audio/mpeg');
      return { buffer: Buffer.from(await response.arrayBuffer()), mime };
    }
    const response = await timedFetch(`${base || 'https://dashscope.aliyuncs.com/api/v1'}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: provider.tts_model, input: { text, voice: provider.tts_voice, language_type: 'Chinese' } })
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`TTS 服务返回 HTTP ${response.status}`);
    let body = null;
    try { body = JSON.parse(bodyText); } catch { /* handled below */ }
    const audioUrl = body?.output?.audio?.url || body?.output?.audio_url || '';
    if (!/^https?:\/\//i.test(audioUrl)) throw new Error('TTS 响应缺少音频地址');
    const audio = await timedFetch(audioUrl, {});
    if (!audio.ok) throw new Error(`音频下载失败 HTTP ${audio.status}`);
    return { buffer: Buffer.from(await audio.arrayBuffer()), mime: inferMime(audioUrl, 'audio/ogg') };
  }

  router.post('/api/config/voice/test-tts', async (req, res) => {
    const body = req.body;
    if (!isObject(body)) return fail(res, 400, new Error('body must be an object'));
    const text = String(body.text || '').trim();
    if (!text) return fail(res, 400, new Error('text is required'));
    if (text.length > MAX_TEST_TEXT) return fail(res, 400, new Error(`text must be at most ${MAX_TEST_TEXT} characters`));
    let config;
    try { config = loadConfig(); } catch (err) { return fail(res, 500, err); }
    const key = typeof body.key === 'string' && body.key ? body.key : resolveActive(config).active_tts;
    const provider = key ? config.providers[key] : null;
    if (!isObject(provider) || !TTS_TYPES.includes(provider.type)) {
      return fail(res, 400, new Error('没有可用的 TTS 服务商'));
    }
    try {
      let result;
      if (runtime && typeof runtime.createTtsClient === 'function') {
        // Present the requested provider as the active one without touching the file.
        const view = { load: () => ({ ...config, voice: { ...(config.voice || {}), active_tts: key } }) };
        result = await runtime.createTtsClient({ store: view, fetchImpl }).synthesize({ text });
      } else {
        result = await legacySynthesize(provider, text);
      }
      if (!result || !result.buffer || !result.buffer.length) throw new Error('TTS 未返回音频');
      res.set({ 'Content-Type': result.mime || 'audio/mpeg', 'Cache-Control': 'no-store' });
      return res.send(Buffer.from(result.buffer));
    } catch (err) {
      const apiKey = resolveApiKey(provider);
      let message = err?.name === 'AbortError' ? 'TTS 请求超时' : String(err.message || err).split('\n')[0];
      if (apiKey) message = message.split(apiKey).join('***');
      return fail(res, 502, new Error(message));
    }
  });

  return router;
}

module.exports = { createVoiceConfigRouter, TTS_TYPES, ASR_TYPES };
