const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachModelControl } = require('../../../apps/gateway/deviceHub/modelControl');

test('TC-LLM-040 phone catalog exposes enabled capabilities without credentials', () => {
  const descriptor = {
    ref: 'qwen/omni', provider: 'qwen', id: 'omni', name: 'Omni', api: 'openai-completions',
    api_key: 'secret', headers: { Authorization: 'secret' }, extra_body: { secret: true }, compat: {},
    input: ['text', 'audio'], output: ['text'], transport: 'request', audio: { mode: 'direct', input_format: 'wav' }
  };
  const catalog = {
    active: descriptor,
    enabled: [descriptor],
    models: [descriptor]
  };
  const hub = Object.assign(new EventEmitter(), { methods: new Map() });
  attachModelControl({ hub, llmManager: { store: { load: () => ({
    active_model: descriptor.ref,
    enabled_models: [descriptor.ref],
    providers: { qwen: { type: 'openai_compatible', base_url: 'https://example/v1', api_key: 'secret', models: [{ id: 'omni', input: descriptor.input, output: descriptor.output, audio: descriptor.audio }] } }
  }) } } });
  const result = hub.methods.get('model.catalog.get')();
  const serialized = JSON.stringify(result);
  assert.equal(result.active, descriptor.ref);
  assert.deepEqual(result.models[0].input, ['text', 'audio']);
  assert.equal(result.models[0].audio.mode, 'direct');
  assert.equal(serialized.includes('secret'), false);
  hub.emit('shutdown');
  assert.equal(hub.methods.has('model.catalog.get'), false);
  void catalog;
});

test('TC-VOC-026 phone catalog disables realtime models without a workspace endpoint', () => {
  const descriptor = {
    ref: 'qwen/rt', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime', name: 'Realtime',
    input: ['text', 'audio'], output: ['text', 'audio'], transport: 'realtime',
    audio: { mode: 'realtime' }
  };
  const hub = Object.assign(new EventEmitter(), { methods: new Map() });
  attachModelControl({ hub, llmManager: { store: { load: () => ({
    active_model: descriptor.ref,
    enabled_models: [descriptor.ref],
    providers: { qwen: {
      type: 'openai_compatible', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api_key: 'secret',
      models: [{ id: descriptor.id, input: descriptor.input, output: descriptor.output, transport: 'realtime', audio: descriptor.audio }]
    } }
  }) } } });
  const model = hub.methods.get('model.catalog.get')().models[0];
  assert.equal(model.available, false);
  assert.match(model.reason, /workspace-specific/);
  hub.emit('shutdown');
});
