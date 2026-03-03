const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../../apps/desktop-live2d/renderer/realtimeVoicePlayer');

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
