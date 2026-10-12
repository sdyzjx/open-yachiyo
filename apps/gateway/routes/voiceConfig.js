// Voice configuration HTTP API — contract C8 (docs/plans/PLAN-desktop-companion-v2.md §2).
// Mounted from apps/gateway/server.js; the whole /api/config/** tree is loopback-only
// (configLoopbackOnly). Responses are `{ok, data}` and never contain api_key values.
//
const express = require('express');
const { createTtsClient, describeVoiceConfig } = require('../../runtime/voice');
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

function createVoiceConfigRouter({
  llmManager,
  commitConfigChange = () => {},
  desktopLive2dConfigPath = null,
  fetchImpl = (...args) => fetch(...args),
  createTtsClientImpl = createTtsClient,
  describeVoiceConfigImpl = describeVoiceConfig
}) {
  const router = express.Router();
  const store = llmManager.store;

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
    const described = describeVoiceConfigImpl({ store });
    const providers = described.providers.map((provider) => {
      const safe = safeProviderSnapshot(provider.key, config.providers[provider.key]);
      return {
        ...provider,
        preset: safe.preset,
        requires_api_key: safe.requires_api_key,
        has_custom_headers: safe.has_custom_headers,
        has_extra_body: safe.has_extra_body
      };
    });
    return { ...described, providers, desktop: desktopVoice() };
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

  router.post('/api/config/voice/test-tts', async (req, res) => {
    const body = req.body;
    if (!isObject(body)) return fail(res, 400, new Error('body must be an object'));
    const text = String(body.text || '').trim();
    if (!text) return fail(res, 400, new Error('text is required'));
    if (text.length > MAX_TEST_TEXT) return fail(res, 400, new Error(`text must be at most ${MAX_TEST_TEXT} characters`));
    const key = typeof body.key === 'string' && body.key ? body.key : undefined;
    if (key) {
      try {
        const provider = store.load().providers[key];
        if (!isObject(provider) || !TTS_TYPES.includes(provider.type)) {
          return fail(res, 400, new Error('key must reference a TTS provider'));
        }
      } catch (err) {
        return fail(res, 500, err);
      }
    }
    try {
      const result = await createTtsClientImpl({ store, providerKey: key, fetchImpl }).synthesize({ text });
      if (!result || !result.buffer || !result.buffer.length) throw new Error('TTS 未返回音频');
      res.set({ 'Content-Type': result.mime || 'audio/mpeg', 'Cache-Control': 'no-store' });
      return res.send(Buffer.from(result.buffer));
    } catch (err) {
      return fail(res, 502, err);
    }
  });

  return router;
}

module.exports = { createVoiceConfigRouter, TTS_TYPES, ASR_TYPES };
