const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOmniAudioService, realtimeUrl } = require('../../../apps/gateway/deviceHub/omniAudio');

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
    hub: {}, llmManager: manager(descriptor),
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
  assert.throws(
    () => realtimeUrl({ id: 'x', base_url: 'https://workspace.example/v1', realtime_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/realtime' }),
    (error) => error.code === -32602 && /wss:\/\//.test(error.message)
  );
});

test('TC-VOC-025 realtime Omni relays text/audio deltas to one device', async () => {
  class FakeWs extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; FakeWs.instance = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const published = [];
  const hub = { publish: (topic, data, options) => published.push({ topic, data, options }) };
  const descriptor = {
    ref: 'qwen/rt', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime', input: ['text', 'audio'],
    output: ['text', 'audio'], transport: 'realtime', api_key: 'secret', headers: {},
    base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  };
  const service = createOmniAudioService({ hub, llmManager: manager(descriptor), WebSocketImpl: FakeWs, timeoutMs: 1000 });
  const stream = service.startRealtime({ device: { device_id: 'phone' }, streamId: 'mic', modelRef: descriptor.ref });
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  stream.append('AQI=');
  const finishing = stream.finish();
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '你好' }));
  ws.emit('message', JSON.stringify({ type: 'response.audio.delta', delta: 'AwQ=' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  assert.deepEqual(await finishing, { text: '', output: '你好' });
  assert.deepEqual(ws.sent.slice(-3).map((event) => event.type), ['input_audio_buffer.append', 'input_audio_buffer.commit', 'response.create']);
  assert.ok(published.some((event) => event.topic === 'chat.delta'));
  assert.ok(published.some((event) => event.topic === 'voice.stream.chunk'));
  assert.ok(published.some((event) => event.topic === 'voice.stream.end'));
});

test('TC-LLM-041 realtime model accepts keyboard text over its WebSocket transport', async () => {
  class FakeWs extends EventEmitter {
    constructor() { super(); this.sent = []; FakeWs.instance = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const descriptor = {
    ref: 'qwen/rt', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime', input: ['text', 'audio'],
    transport: 'realtime', api_key: 'secret', headers: {}, base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  };
  const deltas = [];
  const service = createOmniAudioService({ hub: { publish() {} }, llmManager: manager(descriptor), WebSocketImpl: FakeWs, timeoutMs: 1000 });
  const resultPromise = service.generateText({ text: 'hello', modelRef: descriptor.ref, onDelta: (delta) => deltas.push(delta) });
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: 'hi' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  const result = await resultPromise;
  assert.equal(result.output, 'hi');
  assert.deepEqual(deltas, ['hi']);
  assert.deepEqual(ws.sent.map((event) => event.type), ['session.update', 'conversation.item.create', 'response.create']);
});
