const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadPi } = require('../../../apps/runtime/agent-pi/loadPi');
const {
  QWEN_REALTIME_API, AUDIO_APPEND_BYTES, REALTIME_CONNECTION_IDLE_MS,
  createQwenRealtimeStream, replayContext, audioAppendEvents
} = require('../../../apps/runtime/agent-pi/qwenRealtimeAdapter');

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

test('TC-PI-038 TC-PI-042 realtime context preserves old tool history without replaying connection-scoped call ids', () => {
  const replay = replayContext([
    { role: 'system', content: 'You are Yachiyo', toolsAdded: [{ name: 'device__move', description: 'move', parameters: { type: 'object' } }] },
    { role: 'user', content: '去手机', timestamp: 1 },
    { role: 'assistant', api: 'x', provider: 'x', model: 'x', usage, stopReason: 'toolUse', timestamp: 2, content: [
      { type: 'toolCall', id: 'call-1', name: 'device__move', arguments: { target: 'phone' } }
    ] },
    { role: 'toolResult', toolCallId: 'call-1', toolName: 'device__move', content: [{ type: 'text', text: '{"ok":true}' }], isError: false, timestamp: 3 }
  ]);
  assert.equal(replay.instructions, 'You are Yachiyo');
  assert.deepEqual(replay.tools.map((tool) => tool.function.name), ['device__move']);
  assert.deepEqual(replay.events.map((event) => event.item.type), ['message', 'message', 'message']);
  assert.match(replay.events[1].item.content[0].text, /历史工具调用.*device__move/);
  assert.match(replay.events[2].item.content[0].text, /历史工具结果 device__move.*ok/);
  assert.equal(JSON.stringify(replay.events).includes('function_call_output'), false);
});

test('TC-PI-041 realtime context sends original audio instead of its placeholder text', () => {
  const replay = replayContext([{
    role: 'user',
    content: [{ type: 'text', text: '[实时语音输入]' }],
    timestamp: 1,
    yachiyoInputAudio: { audio_ref: '/private/audio.wav', format: 'wav', stream_id: 'voice-1' }
  }], { loadAudio: (audioRef) => {
    assert.equal(audioRef, '/private/audio.wav');
    return 'AQI=';
  } });
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.audioInputs, [{
    audio: 'AQI=',
    marker: { audio_ref: '/private/audio.wav', format: 'wav', stream_id: 'voice-1' }
  }]);
  assert.equal(JSON.stringify(replay.events).includes('实时语音输入'), false);
});

test('TC-PI-041 realtime context sends only the newest unconsumed audio and replays older voice turns as text', () => {
  const messages = [
    {
      role: 'user', content: [{ type: 'text', text: '[实时语音输入]' }],
      yachiyoInputAudio: { audio_ref: '/private/old.wav', stream_id: 'voice-old', transcribed_text: '旧问题' }
    },
    { role: 'assistant', content: [{ type: 'text', text: '旧回答' }] },
    {
      role: 'user', content: [{ type: 'text', text: '[实时语音输入]' }],
      yachiyoInputAudio: { audio_ref: '/private/new.wav', stream_id: 'voice-new' }
    }
  ];
  const replay = replayContext(messages, { loadAudio: (ref) => ref.endsWith('new.wav') ? 'TkVX' : 'T0xE' });
  assert.deepEqual(replay.events.map((event) => event.item.content?.[0]), [
    { type: 'input_text', text: '旧问题' },
    { type: 'output_text', text: '旧回答' }
  ]);
  assert.deepEqual(replay.audioInputs.map((input) => input.audio), ['TkVX']);
  assert.deepEqual(replay.audioMarkers.map((audio) => audio.stream_id), ['voice-new']);

  const continued = replayContext(messages, {
    loadAudio: () => { throw new Error('consumed audio must not be loaded again'); },
    audioAlreadySent: (audio) => audio.stream_id === 'voice-new'
  });
  assert.equal(continued.events.at(-1).item.content[0].type, 'input_text');
  assert.equal(continued.events.at(-1).item.content[0].text, '[历史语音消息]');
  assert.deepEqual(continued.audioMarkers, []);
});

test('TC-PI-047 realtime input audio is chunked below the provider frame limit and committed once', () => {
  const pcm = Buffer.alloc(AUDIO_APPEND_BYTES * 9 + 17, 7);
  const events = audioAppendEvents([{ audio: pcm.toString('base64') }]);
  const appends = events.filter((event) => event.type === 'input_audio_buffer.append');
  assert.equal(appends.length, 10);
  assert.equal(events.at(-1).type, 'input_audio_buffer.commit');
  assert.deepEqual(Buffer.concat(appends.map((event) => Buffer.from(event.audio, 'base64'))), pcm);
  for (const event of appends) assert.ok(Buffer.byteLength(JSON.stringify(event)) < 64 * 1024);
});

test('TC-PI-039 realtime provider emits standard Pi text/tool events and keeps audio side-channel independent', async () => {
  class FakeWs extends EventEmitter {
    constructor() { super(); this.sent = []; FakeWs.instance = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const { ai } = await loadPi();
  const audio = [];
  const model = {
    id: 'qwen3.8-omni-flash-realtime', name: 'Realtime', provider: 'qwen', api: QWEN_REALTIME_API,
    input: ['text'], reasoning: false, contextWindow: 65536, maxTokens: 8192, cost: usage.cost
  };
  const descriptor = {
    ...model, base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', api_key: 'secret',
    headers: {}, realtime_output: 'native', realtime_voice: 'yachiyo'
  };
  const stream = createQwenRealtimeStream({
    ai, descriptor, model,
    context: { messages: [
      { role: 'system', content: 'Use tools', toolsAdded: [
        { name: 'desktop__capture', description: 'capture', parameters: { type: 'object' } },
        { name: 'voice__tts_aliyun_vc', description: 'tts', parameters: { type: 'object' } }
      ] },
      { role: 'user', content: '看屏幕', timestamp: 1 }
    ] },
    options: { apiKey: 'secret', sessionId: 'device-phone' },
    WebSocketImpl: FakeWs,
    onAudio: (event) => audio.push(event)
  });
  const eventsPromise = (async () => {
    const events = [];
    for await (const event of stream) events.push(event);
    return events;
  })();
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  assert.deepEqual(ws.sent[0].session.modalities, ['text', 'audio']);
  assert.deepEqual(ws.sent[0].session.tools.map((tool) => tool.function.name), ['desktop__capture']);
  assert.match(ws.sent[0].session.instructions, /Never call a TTS tool/);
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '我先看看' }));
  ws.emit('message', JSON.stringify({ type: 'response.audio.delta', delta: 'AQI=' }));
  ws.emit('message', JSON.stringify({
    type: 'response.function_call_arguments.done', call_id: 'call-1', name: 'desktop__capture', arguments: '{}'
  }));
  ws.emit('message', JSON.stringify({ type: 'response.done', response: { usage: { input_tokens: 3, output_tokens: 4 } } }));
  const events = await eventsPromise;
  assert.deepEqual(events.map((event) => event.type), [
    'start', 'text_start', 'text_delta', 'toolcall_start', 'toolcall_end', 'text_end', 'done'
  ]);
  assert.equal(events.at(-1).reason, 'toolUse');
  assert.equal(events.at(-1).message.usage.totalTokens, 7);
  assert.deepEqual(audio.map((event) => event.topic), ['voice.stream.start', 'voice.stream.chunk', 'voice.stream.end']);
});

test('TC-PI-045 ui.chat.post continuation closes silently with text-only modality', async () => {
  class FakeWs extends EventEmitter {
    constructor() { super(); this.sent = []; this.readyState = 1; FakeWs.instance = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const { ai } = await loadPi();
  const connectionPool = new Map();
  const model = {
    id: 'qwen3.8-omni-flash-realtime', name: 'Realtime', provider: 'qwen', api: QWEN_REALTIME_API,
    input: ['text'], reasoning: false, contextWindow: 65536, maxTokens: 8192, cost: usage.cost
  };
  const descriptor = {
    ...model, ref: 'qwen/realtime', base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    api_key: 'secret', headers: {}, realtime_output: 'native', realtime_voice: 'yachiyo'
  };
  const firstMessages = [
    { role: 'system', content: 'Use explicit chat', toolsAdded: [{ name: 'ui__chat__post', description: 'post', parameters: { type: 'object' } }] },
    { role: 'user', content: '只发文字' }
  ];
  const first = createQwenRealtimeStream({ ai, descriptor, model, context: { messages: firstMessages },
    options: { sessionId: 'device-phone' }, WebSocketImpl: FakeWs, connectionPool });
  const drainFirst = (async () => { for await (const event of first) void event; })();
  const ws = FakeWs.instance;
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({
    type: 'response.function_call_arguments.done', call_id: 'ui-call', name: 'ui__chat__post',
    arguments: '{"text":"只显示这段"}'
  }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  await drainFirst;

  const continuationMessages = [
    ...firstMessages,
    { role: 'assistant', content: [{ type: 'toolCall', id: 'ui-call', name: 'ui__chat__post', arguments: { text: '只显示这段' } }] },
    { role: 'toolResult', toolCallId: 'ui-call', toolName: 'ui__chat__post', content: [{ type: 'text', text: 'delivered' }] }
  ];
  const second = createQwenRealtimeStream({ ai, descriptor, model, context: { messages: continuationMessages },
    options: { sessionId: 'device-phone' }, WebSocketImpl: FakeWs, connectionPool });
  const drainSecond = (async () => { for await (const event of second) void event; })();
  await new Promise((resolve) => setImmediate(resolve));
  const responseCreates = ws.sent.filter((event) => event.type === 'response.create');
  assert.deepEqual(responseCreates.at(-1).response.modalities, ['text']);
  ws.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '内部收口' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  await drainSecond;
});

test('TC-PI-049 realtime provider keeps one cloud session across consecutive user turns', async () => {
  class FakeWs extends EventEmitter {
    static instances = [];
    constructor() {
      super();
      this.sent = [];
      this.readyState = 1;
      this.closed = 0;
      FakeWs.instances.push(this);
    }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.closed += 1; }
  }
  const { ai } = await loadPi();
  const connectionPool = new Map();
  const model = {
    id: 'qwen3.8-omni-flash-realtime', name: 'Realtime', provider: 'qwen', api: QWEN_REALTIME_API,
    input: ['text', 'audio'], reasoning: false, contextWindow: 65536, maxTokens: 8192, cost: usage.cost
  };
  const descriptor = {
    ...model, ref: 'qwen/realtime', base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    api_key: 'secret', headers: {}, realtime_output: 'native', realtime_voice: 'yachiyo'
  };
  const firstMessages = [
    { role: 'system', content: 'Answer briefly', toolsAdded: [{ name: 'clock', description: 'time', parameters: { type: 'object' } }] },
    { role: 'user', content: '第一轮' }
  ];
  const first = createQwenRealtimeStream({ ai, descriptor, model, context: { messages: firstMessages },
    options: { sessionId: 'device-phone' }, WebSocketImpl: FakeWs, connectionPool });
  const drainFirst = (async () => { for await (const event of first) void event; })();
  const ws = FakeWs.instances[0];
  ws.emit('message', JSON.stringify({ type: 'session.created' }));
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  ws.emit('message', JSON.stringify({ type: 'response.audio_transcript.delta', delta: '第一答' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  await drainFirst;
  assert.equal(connectionPool.size, 1);
  assert.equal(ws.closed, 0);

  const secondMessages = [
    ...firstMessages,
    { role: 'assistant', content: [{ type: 'text', text: '第一答' }] },
    { role: 'system', content: '', toolsRemoved: [{ name: 'clock' }] },
    { role: 'system', content: '', toolsAdded: [{ name: 'clock', description: 'time', parameters: { type: 'object' } }] },
    { role: 'user', content: '第二轮' }
  ];
  const second = createQwenRealtimeStream({ ai, descriptor, model, context: { messages: secondMessages },
    options: { sessionId: 'device-phone' }, WebSocketImpl: FakeWs, connectionPool });
  const drainSecond = (async () => { for await (const event of second) void event; })();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeWs.instances.length, 1);
  assert.equal(ws.sent.at(-1).type, 'session.update');
  ws.emit('message', JSON.stringify({ type: 'session.updated' }));
  const secondUser = ws.sent.filter((event) => event.item?.role === 'user').at(-1);
  assert.equal(secondUser.item.content[0].text, '第二轮');
  assert.equal(ws.sent.filter((event) => event.type === 'response.create').length, 2);
  ws.emit('message', JSON.stringify({ type: 'response.audio_transcript.delta', delta: '第二答' }));
  ws.emit('message', JSON.stringify({ type: 'response.done' }));
  await drainSecond;
  assert.equal(connectionPool.size, 1);
  assert.equal(ws.closed, 0);
  assert.equal(REALTIME_CONNECTION_IDLE_MS, 30 * 60 * 1000);
  connectionPool.get('device-phone:qwen/realtime').cleanup();
  ws.close();
});
