const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createModelConfigClient,
  normalizeRequest,
  sanitizeErrorMessage
} = require('../../apps/desktop-live2d/main/modelConfigClient');

test('desktop model config IPC accepts only the three renderer operations', () => {
  assert.deepEqual(normalizeRequest({ method: 'get', path: '/api/config/models' }), {
    method: 'GET', path: '/api/config/models', body: undefined
  });
  assert.throws(() => normalizeRequest({ method: 'GET', path: '/api/config/providers/config' }), /unsupported/);
  assert.throws(() => normalizeRequest({ method: 'DELETE', path: '/api/config/models' }), /unsupported/);
  assert.throws(() => normalizeRequest({ method: 'GET', path: '/api/config/models?token=secret' }), /unsupported/);
});

test('desktop model config client uses configured gateway and unwraps public data', async () => {
  let called = null;
  const request = createModelConfigClient({
    gatewayUrl: 'http://127.0.0.1:43123/base/',
    fetchImpl: async (url, init) => {
      called = { url: String(url), init };
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { active: 'demo/model' } }) };
    }
  });
  const result = await request({ method: 'PUT', path: '/api/config/models/selection', body: { active_model: 'demo/model' } });
  assert.deepEqual(result, { active: 'demo/model' });
  assert.equal(called.url, 'http://127.0.0.1:43123/api/config/models/selection');
  assert.deepEqual(called.init, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"active_model":"demo/model"}'
  });
});

test('desktop model config client redacts credentials from failures', async () => {
  assert.equal(sanitizeErrorMessage('Bearer abc123 token=secret api_key:raw'), 'Bearer *** token=*** api_key:***');
  const request = createModelConfigClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: { message: 'token=secret Bearer abc123' } })
    })
  });
  await assert.rejects(() => request({ method: 'GET', path: '/api/config/models' }), /token=\*\*\* Bearer \*\*\*/);
});
