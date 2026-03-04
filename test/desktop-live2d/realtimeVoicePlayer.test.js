const test = require('node:test');
const assert = require('node:assert/strict');

const { RealtimeVoicePlayer, __internal } = require('../../apps/desktop-live2d/renderer/realtimeVoicePlayer');

test('realtime voice player decodes base64 payload to bytes', () => {
  const bytes = __internal.decodeBase64ToBytes('AQIDBA==');
  assert.equal(bytes.byteLength, 4);
  assert.equal(bytes[0], 1);
  assert.equal(bytes[1], 2);
  assert.equal(bytes[2], 3);
  assert.equal(bytes[3], 4);
});

test('realtime voice player converts pcm16le to float32', () => {
  // Samples: 0, +32767, -32768
  const bytes = new Uint8Array([
    0x00, 0x00,
    0xff, 0x7f,
    0x00, 0x80
  ]);
  const samples = __internal.pcm16leToFloat32(bytes);
  assert.equal(samples.length, 3);
  assert.equal(samples[0], 0);
  assert.equal(Math.abs(samples[1] - 0.999969482421875) < 1e-12, true);
  assert.equal(samples[2], -1);
});

test('realtime voice player applies output delay to first scheduled chunk', async () => {
  const previousWindow = global.window;
  const startedAt = [];
  const fakeAudioContext = {
    currentTime: 10,
    state: 'running',
    destination: {},
    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect() {}
      };
    },
    createGain() {
      return {
        gain: { value: 1 },
        connect() {}
      };
    },
    createBuffer(channelCount, length, sampleRate) {
      return {
        channelCount,
        length,
        sampleRate,
        duration: length / sampleRate,
        copyToChannel() {}
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        start(time) {
          startedAt.push(time);
        }
      };
    },
    async resume() {}
  };

  global.window = {
    AudioContext: function FakeAudioContextCtor() {
      return fakeAudioContext;
    }
  };

  try {
    const player = new RealtimeVoicePlayer({ audioContext: fakeAudioContext });
    await player.startSession({
      requestId: 'req-1',
      sampleRate: 24000,
      prebufferMs: 20,
      outputDelayMs: 50
    });

    const bytes = new Uint8Array(1920);
    const appended = player.appendChunk({
      requestId: 'req-1',
      audioBytes: bytes
    });

    assert.equal(appended, true);
    assert.equal(startedAt.length, 1);
    assert.equal(Math.abs(startedAt[0] - 10.075) < 1e-9, true);
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
  }
});
