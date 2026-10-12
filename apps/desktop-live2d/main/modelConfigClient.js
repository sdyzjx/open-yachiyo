const ALLOWED_REQUESTS = new Set([
  'GET /api/config/models',
  'PUT /api/config/models/selection',
  'POST /api/config/models/discover'
]);

function normalizeRequest(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  const requestPath = String(input.path || '');
  if (!ALLOWED_REQUESTS.has(`${method} ${requestPath}`)) {
    throw new Error('unsupported model config request');
  }
  return { method, path: requestPath, body: input.body };
}

function sanitizeErrorMessage(value, fallback = 'model config request failed') {
  const text = String(value || fallback)
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer ***')
    .replace(/((?:api[_-]?key|token)\s*[:=]\s*)[^\s,;}]+/gi, '$1***')
    .trim();
  return (text || fallback).slice(0, 240);
}

function createModelConfigClient({ gatewayUrl, fetchImpl = (...args) => fetch(...args) } = {}) {
  const baseUrl = new URL(String(gatewayUrl || ''));
  return async function modelConfigRequest(input = {}) {
    const request = normalizeRequest(input);
    const url = new URL(request.path, baseUrl);
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
    return payload.data;
  };
}

module.exports = { ALLOWED_REQUESTS, createModelConfigClient, normalizeRequest, sanitizeErrorMessage };
