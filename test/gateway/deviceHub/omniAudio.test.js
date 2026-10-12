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
    realtime_output: 'native', realtime_voice: 'qwen-omni-vc-yachiyo-test',
    base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  };
  const service = createOmniAudioService({ hub, llmManager: manager(descriptor), WebSocketImpl: FakeWs, timeoutMs: 1000 });
  const stream = service.startRealtime({ device: { device_id: 'phone' }, streamId: 'mic', modelRef: descriptor.ref });
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  assert.equal(ws.sent[0].session.audio.output.voice, 'qwen-omni-vc-yachiyo-test');
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  stream.append('AQI=');
  const finishing = stream.finish();
  ws.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '你好' }));
  await new Promise((resolve) => setImmediate(resolve));
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '你好' }));
  ws.emit('message', JSON.stringify({ type: 'response.audio.delta', delta: 'AwQ=' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  assert.deepEqual(await finishing, { text: '你好', output: '你好', route: 'native' });
  assert.deepEqual(ws.sent.slice(-4).map((event) => event.type), ['input_audio_buffer.append', 'input_audio_buffer.commit', 'session.update', 'response.create']);
  assert.ok(published.some((event) => event.topic === 'chat.delta'));
  assert.ok(published.some((event) => event.topic === 'voice.stream.chunk'));
  assert.ok(published.some((event) => event.topic === 'voice.stream.end'));
});

test('TC-VOC-027 realtime Omni executes tools while text and cloned audio remain independent', async () => {
  class FakeWs extends EventEmitter {
    constructor() { super(); this.sent = []; FakeWs.instance = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const published = [];
  const busEvents = [];
  const hub = { publish: (topic, data) => published.push({ topic, data }) };
  const bus = { publish: (topic, data) => busEvents.push({ topic, data }) };
  let releaseTool;
  const executor = {
    listTools: () => [
      { name: 'desktop.capture.screen', description: 'Capture screen', input_schema: { type: 'object', properties: {} } },
      { name: 'voice.tts_aliyun_vc', description: 'Speak twice', input_schema: { type: 'object', properties: {} } }
    ],
    execute: async (call, context) => {
      await new Promise((resolve) => { releaseTool = resolve; });
      assert.equal(call.name, 'desktop.capture.screen');
      assert.equal(context.permission_level, 'high');
      return { ok: true, result: '{"capture_id":"screen-1"}' };
    }
  };
  const stored = [];
  const sessionStore = {
    getSession: async () => ({ messages: [{ role: 'assistant', content: '上次内容' }] }),
    getSessionSettings: async () => ({ permission_level: 'high', workspace: { root_dir: '/tmp' } }),
    appendMessage: async (_id, message) => stored.push(message)
  };
  const descriptor = {
    ref: 'qwen/rt', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime', input: ['text', 'audio'],
    output: ['text', 'audio'], transport: 'realtime', api_key: 'secret', headers: {},
    realtime_output: 'native', realtime_voice: 'qwen-omni-vc-yachiyo-test',
    base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  };
  const service = createOmniAudioService({
    hub, bus, executor, sessionStore,
    resolvePersonaContext: async () => ({ prompt: 'Yachiyo persona' }),
    resolveSkillsContext: async () => ({ prompt: 'Selected skill' }),
    llmManager: manager(descriptor), WebSocketImpl: FakeWs, timeoutMs: 1000
  });
  const stream = service.startRealtime({ device: { device_id: 'phone' }, streamId: 'mic', modelRef: descriptor.ref });
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  assert.deepEqual(ws.sent[0].session.modalities, ['text', 'audio']);
  assert.equal(ws.sent[0].session.audio.output.voice, 'qwen-omni-vc-yachiyo-test');
  assert.deepEqual(ws.sent[0].session.tools.map((tool) => tool.function.name), ['desktop__capture__screen']);
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  const finishing = stream.finish();
  ws.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '打开电脑设置' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ws.sent.at(-1).session.instructions, /Yachiyo persona/);
  assert.match(ws.sent.at(-1).session.instructions, /Selected skill/);
  assert.match(ws.sent.at(-1).session.instructions, /上次内容/);
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'call-1', name: 'desktop__capture__screen', arguments: '{}' }));
  ws.emit('message', JSON.stringify({ type: 'response.done', response: { output: [{ type: 'function_call' }] } }));
  assert.equal(ws.sent.filter((event) => event.type === 'response.create').length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  releaseTool();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ws.sent.filter((event) => event.type === 'conversation.item.create' && event.item.type === 'function_call_output').length, 1);
  assert.equal(ws.sent.filter((event) => event.type === 'response.create').length, 2);
  ws.emit('message', JSON.stringify({ type: 'response.created' }));
  ws.emit('message', JSON.stringify({ type: 'response.audio.delta', delta: 'AwQ=' }));
  ws.emit('message', JSON.stringify({ type: 'response.audio_transcript.delta', delta: '已经打开' }));
  ws.emit('message', JSON.stringify({ type: 'response.done', response: { output: [{ type: 'message' }] } }));
  assert.deepEqual(await finishing, { text: '打开电脑设置', output: '已经打开', route: 'native' });
  assert.ok(published.some(({ topic }) => topic === 'voice.stream.chunk'));
  assert.ok(published.some(({ topic, data }) => topic === 'chat.delta' && data.channel === 'audio_transcript'));
  assert.ok(busEvents.some(({ topic }) => topic === 'tool_call.started'));
  assert.ok(busEvents.some(({ topic }) => topic === 'tool_call.completed'));
  assert.equal(stored[0].role, 'user');
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
  await new Promise((resolve) => setImmediate(resolve));
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: 'hi' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  const result = await resultPromise;
  assert.equal(result.output, 'hi');
  assert.deepEqual(deltas, ['hi']);
  assert.deepEqual(ws.sent.map((event) => event.type), ['session.update', 'conversation.item.create', 'response.create']);
});

test('TC-LLM-044 realtime keyboard chat can call computer tools and continue once', async () => {
  class FakeWs extends EventEmitter {
    constructor() { super(); this.sent = []; FakeWs.instance = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const descriptor = {
    ref: 'qwen/rt', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime', input: ['text', 'audio'],
    transport: 'realtime', api_key: 'secret', headers: {}, base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  };
  const calls = [];
  const events = [];
  const service = createOmniAudioService({
    hub: { publish() {} }, llmManager: manager(descriptor), WebSocketImpl: FakeWs, timeoutMs: 1000,
    executor: {
      listTools: () => [{ name: 'desktop.capture.screen', description: 'screen', input_schema: { type: 'object', properties: {} } }],
      execute: async (call) => { calls.push(call); return { ok: true, result: 'captured' }; }
    },
    sessionStore: {
      getSession: async () => ({ messages: [] }), getSessionSettings: async () => ({ permission_level: 'high' }), appendMessage: async () => {}
    }
  });
  const resultPromise = service.generateText({ text: '看一下屏幕', modelRef: descriptor.ref, sessionId: 'desktop-1', onEvent: (event) => events.push(event) });
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ws.sent[0].session.tools[0].function.name, 'desktop__capture__screen');
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'text-call', name: 'desktop__capture__screen', arguments: '{}' }));
  ws.emit('message', JSON.stringify({ type: 'response.done', response: { output: [{ type: 'function_call' }] } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ name: 'desktop.capture.screen', args: {} }]);
  assert.equal(ws.sent.filter((event) => event.type === 'response.create').length, 2);
  ws.emit('message', JSON.stringify({ type: 'response.created' }));
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '我看到了' }));
  ws.emit('message', JSON.stringify({ type: 'response.done', response: { output: [{ type: 'message' }] } }));
  assert.equal((await resultPromise).output, '我看到了');
  assert.ok(events.some((event) => event.event === 'tool_call.started' && event.payload.name === 'desktop.capture.screen'));
  assert.ok(events.some((event) => event.event === 'tool_call.completed'));
});
