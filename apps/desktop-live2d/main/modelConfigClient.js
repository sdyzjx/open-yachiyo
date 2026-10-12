const ALLOWED_REQUESTS = new Set([
  'GET /api/config/models',
  'PUT /api/config/models/selection'
]);

const PROVIDER_KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_MODEL_REF_LENGTH = 256;
const MAX_LIST_ITEMS = 512;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowedKeys, message) {
  if (!isObject(value) || Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(message);
  }
}

function normalizeModelRef(value, field) {
  const ref = String(value || '').trim();
  if (!ref || ref.length > MAX_MODEL_REF_LENGTH) {
    throw new Error(`${field} must be a non-empty model ref`);
  }
  return ref;
}

function normalizeRequest(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  const requestPath = String(input.path || '');
  if (!ALLOWED_REQUESTS.has(`${method} ${requestPath}`)) {
    throw new Error('unsupported model config request');
  }
  if (method === 'GET') {
    if (input.body !== undefined) throw new Error('model list request does not accept a body');
    return { method, path: requestPath, body: undefined };
  }

  if (requestPath === '/api/config/models/selection') {
    assertExactKeys(input.body, new Set(['active_model']), 'invalid model selection body');
    const activeModel = normalizeModelRef(input.body.active_model, 'active_model');
    return {
      method,
      path: requestPath,
      body: { active_model: activeModel }
    };
  }
  throw new Error('unsupported model config request');
}

function sanitizeErrorMessage(value, fallback = 'model config request failed') {
  const text = String(value || fallback)
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer ***')
    .replace(/((?:api[_-]?key|token)\s*[:=]\s*)[^\s,;}]+/gi, '$1***')
    .trim();
  return (text || fallback).slice(0, 240);
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function sanitizeModel(model) {
  if (!isObject(model)) return null;
  const ref = safeString(model.ref);
  const id = safeString(model.id);
  if (!ref || !id) return null;
  return {
    ref,
    id,
    name: safeString(model.name, id),
    provider: safeString(model.provider),
    input: Array.isArray(model.input) ? model.input.filter((item) => typeof item === 'string').slice(0, 8) : ['text'],
    output: Array.isArray(model.output) ? model.output.filter((item) => typeof item === 'string').slice(0, 8) : ['text'],
    transport: safeString(model.transport, 'request'),
    audio: isObject(model.audio) ? {
      mode: safeString(model.audio.mode),
      input_format: safeString(model.audio.input_format),
      input_sample_rate: Number(model.audio.input_sample_rate) || null,
      output_format: safeString(model.audio.output_format),
      output_sample_rate: Number(model.audio.output_sample_rate) || null
    } : null,
    has_api_key: model.has_api_key !== false,
    enabled: model.enabled === true
  };
}

function sanitizeSnapshot(value) {
  const snapshot = isObject(value) ? value : {};
  const models = Array.isArray(snapshot.models)
    ? snapshot.models.slice(0, MAX_LIST_ITEMS).map(sanitizeModel).filter(Boolean)
    : [];
  const providers = {};
  if (isObject(snapshot.providers)) {
    for (const [rawKey, rawProvider] of Object.entries(snapshot.providers).slice(0, MAX_LIST_ITEMS)) {
      if (!PROVIDER_KEY_RE.test(rawKey) || !isObject(rawProvider)) continue;
      providers[rawKey] = {
        key: rawKey,
        display_name: safeString(rawProvider.display_name, rawKey),
        has_api_key: rawProvider.has_api_key === true,
        requires_api_key: rawProvider.requires_api_key !== false
      };
    }
  }
  return {
    active: typeof snapshot.active === 'string' ? snapshot.active : null,
    enabled: Array.isArray(snapshot.enabled)
      ? snapshot.enabled.slice(0, MAX_LIST_ITEMS).filter((ref) => typeof ref === 'string')
      : [],
    models,
    providers
  };
}

function sanitizeResponse(_request, value) { return sanitizeSnapshot(value); }

function createModelConfigClient({ gatewayUrl, fetchImpl = (...args) => fetch(...args) } = {}) {
  const baseUrl = new URL(String(gatewayUrl || ''));
  return async function modelConfigRequest(input = {}) {
    const request = normalizeRequest(input);
    const url = new URL(request.path, baseUrl);
    try {
      const response = await fetchImpl(url, {
        method: request.method,
        headers: request.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: request.body === undefined ? undefined : JSON.stringify(request.body)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.ok !== true) {
        const message = payload?.error?.message || payload?.error || `HTTP ${response.status}`;
        throw new Error(sanitizeErrorMessage(message));
      }
      return sanitizeResponse(request, payload.data);
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err?.message || err));
    }
  };
}

module.exports = {
  ALLOWED_REQUESTS,
  createModelConfigClient,
  normalizeRequest,
  sanitizeErrorMessage,
  sanitizeResponse
};
