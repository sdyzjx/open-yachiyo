const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');

const { QwenTtsRealtimeClient, __internal } = require('../../apps/desktop-live2d/main/voice/qwenTtsRealtimeClient');

class FakeRealtimeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeRealtimeSocket.lastInstance = this;
    process.nextTick(() => this.emit('open'));
  }

  send(payload) {
    this.sent.push(String(payload));
    let message = null;
    try {
      message = JSON.parse(String(payload));
    } catch {
      message = null;
    }
    if (message?.type === 'input_text_buffer.commit') {
      process.nextTick(() => {
        this.emit('message', JSON.stringify({ type: 'response.audio.delta', delta: 'AQIDBA==' }));
      });
      process.nextTick(() => {
        this.emit('message', JSON.stringify({ type: 'response.audio.done' }));
      });
    }
  }

  close() {
    process.nextTick(() => this.emit('close', 1000, 'normal'));
  }
}

function setupProviderConfig() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tts-realtime-client-'));
  const configPath = path.join(tmpDir, 'providers.yaml');
  fs.writeFileSync(
    configPath,
    [
      'active_provider: qwen35_plus',
      'providers:',
      '  qwen35_plus:',
      '    type: openai_compatible',
      '    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1',
      '    model: qwen3.5-plus',
      '    api_key_env: DASHSCOPE_API_KEY',
      '  qwen3_tts:',
      '    type: tts_dashscope',
      '    tts_model: qwen3-tts-instruct-flash',
      '    tts_voice: Cherry',
      '    tts_realtime_model: qwen3-tts-instruct-flash-realtime',
      '    tts_realtime_voice: Cherry',
      '    tts_realtime_instructions: speak slower and flatter',
      '    tts_realtime_optimize_instructions: true',
      '    base_url: https://dashscope.aliyuncs.com/api/v1',
      '    api_key_env: DASHSCOPE_API_KEY'
    ].join('\n'),
    'utf8'
  );
  return { configPath };
}

test('realtime ws url helpers build expected endpoint', () => {
  assert.equal(
    __internal.deriveRealtimeWsBaseUrl('https://dashscope.aliyuncs.com/api/v1'),
    'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
  );
  assert.equal(
    __internal.buildRealtimeWsUrl({
      wsBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
      model: 'qwen-tts-realtime'
    }),
    'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-tts-realtime'
  );
  assert.equal(__internal.estimateBase64Bytes('AQIDBA=='), 4);
});

test('qwen realtime tts client streams events and returns stats', async () => {
  const { configPath } = setupProviderConfig();
  const prevConfigPath = process.env.PROVIDER_CONFIG_PATH;
  const prevApiKey = process.env.DASHSCOPE_API_KEY;
  process.env.PROVIDER_CONFIG_PATH = configPath;
  process.env.DASHSCOPE_API_KEY = 'sk-test';

  const events = [];
  const client = new QwenTtsRealtimeClient({
    WebSocketImpl: FakeRealtimeSocket
  });

  try {
    const result = await client.streamSynthesis({
      text: 'こんにちは',
      onEvent: (event) => events.push(event)
    });

    assert.equal(result.ok, true);
    assert.equal(result.chunkCount, 1);
    assert.equal(result.totalAudioBytes, 4);
    assert.equal(events.some((event) => event.type === 'start'), true);
    assert.equal(events.some((event) => event.type === 'chunk'), true);
    assert.equal(events.some((event) => event.type === 'done'), true);
    const firstChunk = events.find((event) => event.type === 'chunk');
    assert.equal(firstChunk?.audio_base64, 'AQIDBA==');
    const outboundRaw = FakeRealtimeSocket.lastInstance?.sent || [];
    const outboundTypes = outboundRaw
      .map((item) => {
        try {
          return JSON.parse(item)?.type || '';
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    assert.deepEqual(outboundTypes, [
      'session.update',
      'input_text_buffer.append',
      'input_text_buffer.commit'
    ]);
    const sessionUpdate = JSON.parse(outboundRaw[0]);
    assert.equal(sessionUpdate.session.instructions, 'speak slower and flatter');
    assert.equal(sessionUpdate.session.optimize_instructions, true);
  } finally {
    if (prevConfigPath !== undefined) process.env.PROVIDER_CONFIG_PATH = prevConfigPath;
    else delete process.env.PROVIDER_CONFIG_PATH;
    if (prevApiKey !== undefined) process.env.DASHSCOPE_API_KEY = prevApiKey;
    else delete process.env.DASHSCOPE_API_KEY;
  }
});
