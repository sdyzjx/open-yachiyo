const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCodec() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../apps/gateway/public/config-v2-models.js'), 'utf8');
  const CV2 = {
    h() {}, api() {}, toast() {}, chip() {}, field() {}, card() {}, register() {}
  };
  vm.runInNewContext(source, { window: { CV2 } });
  return CV2.modelCodec;
}

test('TC-CFG-018 model editor round-trips Omni input, output, transport and audio mode', () => {
  const codec = loadCodec();
  const source = [{
    id: 'qwen3.8-omni-flash-realtime',
    name: 'Qwen Omni Realtime',
    input: ['text', 'audio'],
    output: ['text', 'audio'],
    transport: 'realtime',
    audio: { mode: 'realtime', input_format: 'pcm_s16le', input_sample_rate: 16000 }
  }];
  const text = codec.modelsToText(source);
  assert.match(text, /text,audio \| text,audio \| realtime \| realtime/);
  const [decoded] = codec.textToModels(text, source);
  assert.deepEqual(Array.from(decoded.input), ['text', 'audio']);
  assert.deepEqual(Array.from(decoded.output), ['text', 'audio']);
  assert.equal(decoded.transport, 'realtime');
  assert.equal(decoded.audio.mode, 'realtime');
  assert.equal(decoded.audio.input_sample_rate, 16000);
  assert.equal(decoded.audio.output_sample_rate, 24000);
});

test('model editor keeps the previous four-column format compatible', () => {
  const codec = loadCodec();
  const [decoded] = codec.textToModels('legacy | Legacy | text,image | request', []);
  assert.deepEqual(Array.from(decoded.input), ['text', 'image']);
  assert.deepEqual(Array.from(decoded.output), ['text']);
  assert.equal(decoded.transport, 'request');
});
