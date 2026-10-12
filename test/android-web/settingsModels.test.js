'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../../apps/android/app/src/main/assets/web/js/settingsModels');

const direct = {
  active: 'qwen/qwen-plus',
  enabled: ['qwen/qwen-plus'],
  models: [{ ref: 'qwen/qwen-plus', name: 'Qwen Plus', provider: 'qwen' }]
};

test('normalizes direct and gateway-wrapped model responses', () => {
  assert.deepEqual(Models.normalizeResponse(direct), direct);
  assert.deepEqual(Models.normalizeResponse({ ok: true, data: direct }), direct);
});

test('defaults optional selection fields and rejects malformed responses', () => {
  assert.deepEqual(Models.normalizeResponse({ models: [{ ref: 'local/model' }, null, {}] }), {
    active: '', enabled: [], models: [{ ref: 'local/model' }]
  });
  assert.equal(Models.normalizeResponse({ ok: true }), null);
  assert.equal(Models.normalizeResponse({ ok: true, data: { models: {} } }), null);
});
