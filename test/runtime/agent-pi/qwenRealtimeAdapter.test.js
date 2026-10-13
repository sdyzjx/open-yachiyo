const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadPi } = require('../../../apps/runtime/agent-pi/loadPi');
const {
  QWEN_REALTIME_API, createQwenRealtimeStream, replayContext
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
  assert.deepEqual(replay.events[0].item.content, [{ type: 'input_audio', audio: 'AQI=' }]);
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
    { type: 'output_text', text: '旧回答' },
    { type: 'input_audio', audio: 'TkVX' }
  ]);
  assert.deepEqual(replay.audioMarkers.map((audio) => audio.stream_id), ['voice-new']);

  const continued = replayContext(messages, {
    loadAudio: () => { throw new Error('consumed audio must not be loaded again'); },
    audioAlreadySent: (audio) => audio.stream_id === 'voice-new'
  });
  assert.equal(continued.events.at(-1).item.content[0].type, 'input_text');
  assert.equal(continued.events.at(-1).item.content[0].text, '[历史语音消息]');
  assert.deepEqual(continued.audioMarkers, []);
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
