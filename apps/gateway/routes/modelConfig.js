// Model configuration HTTP API — contract C4.4 (docs/plans/PLAN-android-companion-contracts.md).
// Mounted from apps/gateway/server.js with a single app.use(...) line. api_key values are
// never returned; responses only carry has_api_key.
const express = require('express');
const { normalizeProviderConfig, CHAT_TYPES, splitModelRef } = require('../../runtime/config/providerConfigStore');
const { loadModelCatalog } = require('../../runtime/config/modelCatalog');
const { listPresets } = require('../../runtime/config/providerPresets');

const DEFAULT_TEST_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;
const PROVIDER_KEY_RE = /^[A-Za-z0-9_.-]+$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function publicDescriptor(descriptor, enabledRefs) {
  const { api_key: apiKey, ...rest } = descriptor;
  return {
    ...rest,
    has_api_key: Boolean(apiKey),
    enabled: enabledRefs.has(descriptor.ref)
  };
}

function redact(text, secret) {
  let out = String(text || '');
  if (secret) out = out.split(secret).join('***');
  return out.slice(0, 600);
}

function normalizeEndpoint(url) {
  return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
}

function joinUrl(base, suffix) {
  return `${String(base).replace(/\/+$/, '')}${suffix}`;
}

function clampTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_TIMEOUT_MS);
}

function createModelConfigRouter({
  llmManager,
  commitConfigChange = () => {},
  fetchImpl = (...args) => fetch(...args)
}) {
  const router = express.Router();
  const store = llmManager.store;

  const ok = (res, data) => res.json({ ok: true, data });
  const fail = (res, status, error) => res.status(status).json({ ok: false, error: error.message || String(error) });

  function snapshot() {
    const catalog = loadModelCatalog({ store });
    const config = normalizeProviderConfig(store.load());
    const enabledRefs = new Set(catalog.enabled.map((m) => m.ref));
    const providers = {};
    for (const [key, provider] of Object.entries(config.providers)) {
      providers[key] = {
        key,
        type: provider.type,
        preset: provider.preset || null,
        display_name: provider.display_name || key,
        base_url: provider.base_url || null,
        api_key_env: provider.api_key_env || null,
        has_api_key: Boolean(provider.api_key || (provider.api_key_env && process.env[provider.api_key_env])),
        requires_api_key: !(provider.requires_api_key === false || provider.auth === 'none' || provider.preset === 'ollama'),
        timeout_ms: provider.timeout_ms || null,
        headers: provider.headers || {},
        compat: provider.compat || {},
        extra_body: provider.extra_body || {},
        models: Array.isArray(provider.models) ? provider.models : []
      };
    }
    return {
      active: catalog.active ? catalog.active.ref : null,
      enabled: catalog.enabled.map((m) => m.ref),
      roles: config.roles,
      fallback_models: config.fallback_models,
      models: catalog.models.map((m) => publicDescriptor(m, enabledRefs)),
      providers
    };
  }

  // ---- GET /api/config/models
  router.get('/api/config/models', (req, res) => {
    try {
      ok(res, snapshot());
    } catch (err) {
      fail(res, 500, err);
    }
  });

  // ---- PUT /api/config/models/selection
  router.put('/api/config/models/selection', (req, res) => {
    const body = req.body;
    if (!isObject(body)) return fail(res, 400, new Error('body must be an object'));
    try {
      const config = JSON.parse(JSON.stringify(store.load()));
      for (const field of ['active_model', 'enabled_models', 'roles', 'fallback_models']) {
        if (body[field] === undefined) continue;
        if (field === 'active_model' && typeof body[field] !== 'string') {
          return fail(res, 400, new Error('active_model must be a string'));
        }
        if (field === 'roles' && !isObject(body[field])) {
          return fail(res, 400, new Error('roles must be an object'));
        }
        if ((field === 'enabled_models' || field === 'fallback_models') && !Array.isArray(body[field])) {
          return fail(res, 400, new Error(`${field} must be an array`));
        }
        config[field] = body[field];
      }
      config.version = 2;
      if (body.active_model !== undefined) {
        const parts = splitModelRef(body.active_model, config.providers);
        if (parts) config.active_provider = parts.provider;
      }
      llmManager.saveConfig(config); // validates: unknown refs throw
      commitConfigChange('providers.yaml');
      ok(res, snapshot());
    } catch (err) {
      fail(res, 400, err);
    }
  });

  // ---- GET /api/config/models/presets
  router.get('/api/config/models/presets', (req, res) => {
    ok(res, listPresets());
  });

  // ---- PUT/DELETE /api/config/models/providers/:key   (additive, used by the config UI)
  router.put('/api/config/models/providers/:key', (req, res) => {
    const key = req.params.key;
    const input = req.body;
    if (!PROVIDER_KEY_RE.test(key)) return fail(res, 400, new Error('invalid provider key'));
    if (!isObject(input)) return fail(res, 400, new Error('body must be an object'));
    try {
      const config = JSON.parse(JSON.stringify(store.load()));
      const previous = isObject(config.providers[key]) ? config.providers[key] : {};
      const next = { ...input };
      delete next.clear_api_key;
      delete next.has_api_key;
      if (typeof next.api_key !== 'string' || next.api_key === '') {
        delete next.api_key;
        if (previous.api_key && input.clear_api_key !== true) next.api_key = previous.api_key;
      }
      config.providers[key] = next;
      config.version = 2;
      llmManager.saveConfig(config);
      commitConfigChange('providers.yaml');
      ok(res, snapshot());
    } catch (err) {
      fail(res, 400, err);
    }
  });

  router.delete('/api/config/models/providers/:key', (req, res) => {
    const key = req.params.key;
    try {
      const config = JSON.parse(JSON.stringify(store.load()));
      if (!config.providers[key]) return fail(res, 404, new Error(`provider not found: ${key}`));
      delete config.providers[key];
      const prefix = `${key}/`;
      const keep = (ref) => !String(ref).startsWith(prefix);
      if (Array.isArray(config.enabled_models)) config.enabled_models = config.enabled_models.filter(keep);
      if (Array.isArray(config.fallback_models)) config.fallback_models = config.fallback_models.filter(keep);
      if (isObject(config.roles)) {
        config.roles = Object.fromEntries(Object.entries(config.roles).filter(([, ref]) => keep(ref)));
      }
      if (config.active_model && !keep(config.active_model)) delete config.active_model;
      if (config.active_provider === key) delete config.active_provider;
      if (!config.active_model && !config.active_provider) {
        const firstChat = Object.entries(normalizeProviderConfig({ ...config, active_provider: undefined }).providers)
          .find(([, p]) => CHAT_TYPES.includes(p.type));
        if (firstChat) config.active_model = `${firstChat[0]}/${firstChat[1].models[0].id}`;
      }
      llmManager.saveConfig(config);
      commitConfigChange('providers.yaml');
      ok(res, snapshot());
    } catch (err) {
      fail(res, 400, err);
    }
  });

  // Resolve {ref} | {provider: key|object, provider_key?, model?} to a provider-level view.
  function resolveTarget(body) {
    if (typeof body.ref === 'string' && body.ref) {
      const descriptor = loadModelCatalog({ store }).resolve(body.ref);
      if (!descriptor) throw new Error(`unknown model ref: ${body.ref}`);
      return descriptor;
    }
    const stored = normalizeProviderConfig(store.load()).providers;
    let provider = body.provider;
    let inheritFrom = typeof body.provider_key === 'string' ? body.provider_key : null;
    if (typeof provider === 'string') {
      inheritFrom = provider;
      provider = stored[provider];
      if (!provider) throw new Error(`unknown provider: ${body.provider}`);
    }
    if (!isObject(provider)) throw new Error('body.ref or body.provider is required');
    const draft = { ...provider };
    // Stored credentials (inline keys or env vars) may only be sent to the endpoint they
    // were configured for; otherwise a draft with a foreign base_url could exfiltrate them.
    const source = inheritFrom ? stored[inheritFrom] : null;
    const sameEndpoint = Boolean(source) && normalizeEndpoint(draft.base_url) === normalizeEndpoint(source.base_url);
    if (typeof body.provider !== 'string' && draft.api_key_env
      && !(sameEndpoint && draft.api_key_env === source.api_key_env)) {
      delete draft.api_key_env;
    }
    if (sameEndpoint && !draft.api_key && !draft.api_key_env) {
      if (source.api_key) draft.api_key = source.api_key;
      if (source.api_key_env) draft.api_key_env = source.api_key_env;
    }
    const modelId = body.model
      || draft.model
      || (Array.isArray(draft.models) && draft.models[0] && (draft.models[0].id || draft.models[0]))
      || null;
    const draftConfig = {
      active_model: modelId ? `draft/${modelId}` : undefined,
      active_provider: modelId ? undefined : 'draft',
      providers: { draft: { ...draft, ...(modelId && !draft.models ? { model: modelId } : {}) } }
    };
    const normalized = normalizeProviderConfig(draftConfig);
    const catalog = loadModelCatalog({ store: { load: () => normalized } });
    const found = (modelId && catalog.resolve(`draft/${modelId}`)) || catalog.models[0];
    if (found) return found;
    // e.g. discover for a provider with no models yet
    const p = normalized.providers.draft;
    return {
      ref: 'draft/',
      provider: 'draft',
      id: modelId || '',
      api: { openai_compatible: 'openai-completions', anthropic: 'anthropic-messages', google: 'google-generative-ai' }[p.type],
      base_url: String(p.base_url || '').replace(/\/$/, ''),
      api_key: p.api_key || (p.api_key_env ? process.env[p.api_key_env] || null : null),
      headers: { ...(p.headers || {}) },
      timeout_ms: Number(p.timeout_ms) || 20000,
      compat: { ...(p.compat || {}) },
      extra_body: {}
    };
  }

  function authHeaders(target) {
    const headers = { 'Content-Type': 'application/json', ...target.headers };
    if (target.api === 'anthropic-messages') {
      if (target.api_key) headers['x-api-key'] = target.api_key;
      headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
    } else if (target.api === 'google-generative-ai') {
      if (target.api_key) headers['x-goog-api-key'] = target.api_key;
    } else if (target.api_key) {
      headers.Authorization = `Bearer ${target.api_key}`;
    }
    return headers;
  }

  async function timedFetch(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- POST /api/config/models/test
  router.post('/api/config/models/test', async (req, res) => {
    const body = req.body;
    if (!isObject(body)) return fail(res, 400, new Error('body must be an object'));
    let target;
    try {
      target = resolveTarget(body);
    } catch (err) {
      return fail(res, 400, err);
    }
    if (!target.api) return fail(res, 400, new Error('target is not a chat model'));
    if (!target.id) return fail(res, 400, new Error('model id is required'));

    const timeoutMs = clampTimeout(body.timeout_ms, Math.min(target.timeout_ms || DEFAULT_TEST_TIMEOUT_MS, DEFAULT_TEST_TIMEOUT_MS));
    let url;
    let payload;
    if (target.api === 'anthropic-messages') {
      const base = target.base_url.replace(/\/v1$/, '');
      url = joinUrl(base, '/v1/messages');
      payload = { model: target.id, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] };
    } else if (target.api === 'google-generative-ai') {
      url = joinUrl(target.base_url, `/models/${encodeURIComponent(target.id)}:generateContent`);
      payload = { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 8 } };
    } else {
      url = joinUrl(target.base_url, '/chat/completions');
      payload = {
        model: target.id,
        messages: [{ role: 'user', content: 'ping' }],
        [target.compat?.max_tokens_field || 'max_tokens']: 8,
        stream: false,
        ...(target.extra_body || {})
      };
    }

    const started = Date.now();
    try {
      const response = await timedFetch(url, {
        method: 'POST',
        headers: authHeaders(target),
        body: JSON.stringify(payload)
      }, timeoutMs);
      const latency = Date.now() - started;
      const text = await response.text();
      if (!response.ok) {
        return ok(res, { ok: false, ref: target.ref, latency_ms: latency, status: response.status, error: redact(text, target.api_key) });
      }
      return ok(res, { ok: true, ref: target.ref, latency_ms: latency, status: response.status, error: null });
    } catch (err) {
      const timedOut = err?.name === 'AbortError';
      return ok(res, {
        ok: false,
        ref: target.ref,
        latency_ms: Date.now() - started,
        status: null,
        error: timedOut ? `timeout after ${timeoutMs}ms` : redact(`${err.message}${err.cause?.message ? `: ${err.cause.message}` : ''}`, target.api_key)
      });
    }
  });

  // ---- POST /api/config/models/discover
  router.post('/api/config/models/discover', async (req, res) => {
    const body = req.body;
    if (!isObject(body)) return fail(res, 400, new Error('body must be an object'));
    let target;
    try {
      target = resolveTarget({ provider: body.provider, provider_key: body.provider_key, model: body.model });
    } catch (err) {
      return fail(res, 400, err);
    }
    if (!target.api) return fail(res, 400, new Error('provider is not a chat provider'));

    const timeoutMs = clampTimeout(body.timeout_ms, DEFAULT_TEST_TIMEOUT_MS);
    let url;
    if (target.api === 'anthropic-messages') url = joinUrl(target.base_url.replace(/\/v1$/, ''), '/v1/models');
    else url = joinUrl(target.base_url, '/models');

    try {
      const response = await timedFetch(url, { method: 'GET', headers: authHeaders(target) }, timeoutMs);
      const text = await response.text();
      if (!response.ok) {
        return ok(res, { ok: false, status: response.status, error: redact(text, target.api_key), models: [] });
      }
      let parsed = {};
      try { parsed = JSON.parse(text); } catch { /* handled below */ }
      let models = [];
      if (Array.isArray(parsed?.data)) {
        models = parsed.data.map((m) => ({ id: String(m.id), name: m.display_name || m.name || null }));
      } else if (Array.isArray(parsed?.models)) {
        models = parsed.models.map((m) => ({
          id: String(m.name || m.id || m.model || '').replace(/^models\//, ''),
          name: m.displayName || m.display_name || null
        }));
      }
      models = models.filter((m) => m.id);
      return ok(res, { ok: true, status: response.status, error: null, models });
    } catch (err) {
      const timedOut = err?.name === 'AbortError';
      return ok(res, {
        ok: false,
        status: null,
        error: timedOut ? `timeout after ${timeoutMs}ms` : redact(`${err.message}${err.cause?.message ? `: ${err.cause.message}` : ''}`, target.api_key),
        models: []
      });
    }
  });

  // ---- Session-level model override validation (PUT /api/sessions/:id/settings {settings:{model_ref}}).
  // Runs before the existing settings handler (which persists model_ref) and only validates.
  router.put('/api/sessions/:sessionId/settings', (req, res, next) => {
    const settings = req.body?.settings;
    if (!isObject(settings) || !Object.prototype.hasOwnProperty.call(settings, 'model_ref')) return next();
    const ref = settings.model_ref;
    if (ref === null || ref === '') return next();
    if (typeof ref !== 'string') return fail(res, 400, new Error('settings.model_ref must be a string or null'));
    try {
      if (!loadModelCatalog({ store }).resolve(ref)) {
        return fail(res, 400, new Error(`settings.model_ref references unknown model: ${ref}`));
      }
    } catch (err) {
      return fail(res, 500, err);
    }
    return next();
  });

  return router;
}

module.exports = { createModelConfigRouter };
