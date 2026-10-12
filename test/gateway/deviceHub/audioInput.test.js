const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { pcmToWav } = require('../../../apps/gateway/deviceHub/audioInput');
const { createAsrService } = require('../../../apps/gateway/deviceHub/asrService');

test('Audio PCM becomes WAV, mock HTTP ASR yields transcript and device run', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pcm = Buffer.alloc(3200, 1); const wav = pcmToWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 3200); assert.deepEqual(wav.subarray(44), pcm);
  let received;
  const mock = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = { url: req.url, type: req.headers['content-type'], body: Buffer.concat(chunks) };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: 'hello phone' }));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); t.after(() => new Promise((r) => mock.close(r)));
  const transcribe = createAsrService({ getProvider: () => ({ type: 'asr_openai_compatible', base_url: `http://127.0.0.1:${mock.address().port}/v1`, model: 'mock' }) });
  const runs = [];
  const f = await fixture(t, { bus: new RuntimeEventBus(), enqueueRun: async (_, request) => runs.push(request), audio: { directory, transcribe } });
  const phone = await f.client('phone');
  const start = (id) => phone.send('pub', { stream_id: id, format: 'pcm_s16le', sample_rate: 16000, channels: 1, mode: 'push_to_talk' }, { topic: 'audio.input.start' });
  start('recording');
  phone.send('pub', { stream_id: 'recording', seq: 0, data_b64: pcm.toString('base64') }, { topic: 'audio.input.chunk' });
  phone.send('pub', { stream_id: 'recording', reason: 'released' }, { topic: 'audio.input.end' });
  const msg = await phone.next((m) => m.topic === 'audio.input.transcript');
  assert.equal(msg.data.text, 'hello phone');
  assert.equal(received.url, '/v1/audio/transcriptions'); assert.match(received.type, /multipart\/form-data/); assert.ok(received.body.includes(wav));
  assert.equal(runs[0].params.input_audio.transcribed_text, 'hello phone');
  assert.equal(runs[0].params.session_id, 'device-phone');
  start('cancelled'); phone.send('pub', { stream_id: 'cancelled', reason: 'cancel' }, { topic: 'audio.input.end' }); await phone.sync();
  assert.equal(runs.length, 1); assert.equal(fs.existsSync(path.join(directory, 'cancelled.wav')), false);
  start('invalid'); phone.send('pub', { stream_id: 'invalid', seq: 2, data_b64: pcm.toString('base64') }, { topic: 'audio.input.chunk' });
  assert.equal((await phone.next((m) => m.topic === 'audio.input.transcript')).data.error.code, -32602);
});

test('ASR DashScope inline WAV and legacy fallback are deterministic', async () => {
  let sent;
  const wav = pcmToWav(Buffer.alloc(4));
  const service = createAsrService({ getProvider: () => ({ type: 'asr_dashscope', base_url: 'https://mock.invalid/api/v1' }), fetchImpl: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'recognized' } }] }) }; } });
  assert.equal((await service({ wav })).text, 'recognized');
  assert.equal(sent.url, 'https://mock.invalid/compatible-mode/v1/chat/completions');
  assert.match(sent.body.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
  const fallback = createAsrService({ getProvider: () => null, fallback: async () => JSON.stringify({ text: 'fallback' }) });
  assert.equal((await fallback({ wav, file: 'test.wav' })).text, 'fallback');
});
