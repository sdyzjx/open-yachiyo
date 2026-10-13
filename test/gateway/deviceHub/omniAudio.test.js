const test = require('node:test');
const assert = require('node:assert/strict');
const { createOmniAudioService } = require('../../../apps/gateway/deviceHub/omniAudio');
const { realtimeUrl } = require('../../../apps/runtime/agent-pi/qwenRealtimeAdapter');

function manager(descriptor) {
  return { getCatalog: () => ({ resolve: (ref) => ref === descriptor.ref ? descriptor : null }) };
}

test('TC-VOC-024 direct Omni sends WAV as input_audio and returns transcript text', async () => {
  let request;
  const descriptor = {
    ref: 'qwen/qwen3.8-omni-flash', provider: 'qwen', id: 'qwen3.8-omni-flash',
    input: ['text', 'audio'], transport: 'request', api_key: 'secret', headers: {}, extra_body: {},
    base_url: 'https://workspace.example/compatible-mode/v1', timeout_ms: 1000
  };
  const service = createOmniAudioService({
    llmManager: manager(descriptor),
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '你好八千代' } }] }) };
    }
  });
  assert.deepEqual(await service.transcribe({ wav: Buffer.from('wav'), modelRef: descriptor.ref }), { text: '你好八千代' });
  assert.equal(request.url, 'https://workspace.example/compatible-mode/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer secret');
  assert.match(request.body.messages[0].content[1].input_audio.data, /^data:audio\/wav;base64,/);
});

test('TC-VOC-025 realtime URL uses workspace endpoint and rejects public DashScope host', () => {
  assert.equal(realtimeUrl({ id: 'qwen3.8-omni-flash-realtime', base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }),
    'wss://wsid.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime');
  assert.throws(
    () => realtimeUrl({ id: 'x', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
    (error) => error.code === -32602 && /workspace-specific/.test(error.message)
  );
});

test('TC-VOC-038 gateway Omni service has no second realtime model loop', () => {
  const descriptor = {
    ref: 'qwen/rt', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime', input: ['text', 'audio'],
    transport: 'realtime', api_key: 'secret', headers: {},
    base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  };
  const service = createOmniAudioService({ llmManager: manager(descriptor) });
  assert.equal(service.startRealtime, undefined);
  assert.equal(typeof service.transcribe, 'function');
});
