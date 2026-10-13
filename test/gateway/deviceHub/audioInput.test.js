const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { pcmToWav, attachAudioInput } = require('../../../apps/gateway/deviceHub/audioInput');
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

test('TC-VOC-024 Omni direct audio bypasses ASR and keeps the selected model for the agent turn', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-omni-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const calls = [];
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish() {},
    async runInput(_device, input) { calls.push(input); }
  });
  let asrCalls = 0;
  const audio = attachAudioInput({
    hub,
    directory,
    transcribe: async () => { asrCalls += 1; return { text: 'wrong' }; },
    omniAudio: { transcribe: async ({ modelRef, wav }) => {
      assert.equal(modelRef, 'qwen/qwen3.8-omni-flash');
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      return { text: 'direct request' };
    } }
  });
  t.after(() => hub.emit('shutdown'));
  await audio.handle(audioEvent('audio.input.start', device, {
    ...startData('direct'), audio_mode: 'direct', model_ref: 'qwen/qwen3.8-omni-flash'
  }));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'direct', seq: 0, data_b64: Buffer.alloc(3200, 1).toString('base64') }));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'direct', reason: 'released' }));
  assert.equal(asrCalls, 0);
  assert.equal(calls[0].text, 'direct request');
  assert.equal(calls[0].model_ref, 'qwen/qwen3.8-omni-flash');
});

test('TC-VOC-038 Realtime audio enters Pi once as the original WAV without a separate ASR call', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-realtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const runs = [];
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]), publish() {}, async runInput(_device, input) { runs.push(input); }
  });
  const audio = attachAudioInput({
    hub, directory, transcribe: async () => { throw new Error('ASR must not run'); }
  });
  t.after(() => hub.emit('shutdown'));
  const data = Buffer.alloc(3200, 2).toString('base64');
  await audio.handle(audioEvent('audio.input.start', device, {
    ...startData('rt'), audio_mode: 'realtime', model_ref: 'qwen/qwen3.8-omni-flash-realtime'
  }));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'rt', seq: 0, data_b64: data }));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'rt', reason: 'released' }));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, '');
  assert.equal(runs[0].model_ref, 'qwen/qwen3.8-omni-flash-realtime');
  assert.equal(runs[0].input_audio.format, 'wav');
  assert.equal(runs[0].input_audio.stream_id, 'rt');
  assert.equal(fs.readFileSync(runs[0].input_audio.audio_ref).toString('ascii', 0, 4), 'RIFF');
});

test('a new recording can start after realtime audio has been handed to Pi', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-realtime-interrupt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const runs = [];
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish() {},
    async runInput(_device, input) { runs.push(input); }
  });
  const audio = attachAudioInput({ hub, directory });
  t.after(() => hub.emit('shutdown'));
  const pcm = Buffer.alloc(3200, 2).toString('base64');

  await audio.handle(audioEvent('audio.input.start', device, {
    ...startData('old-rt'), audio_mode: 'realtime', model_ref: 'qwen/realtime'
  }));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'old-rt', seq: 0, data_b64: pcm }));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'old-rt', reason: 'released' }));

  await audio.handle(audioEvent('audio.input.start', device, {
    ...startData('new-rt'), audio_mode: 'realtime', model_ref: 'qwen/realtime'
  }));
  assert.equal(audio.streams.get(device)?.stream_id, 'new-rt');
  assert.equal(runs.length, 1);

  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'new-rt', reason: 'cancel' }));
});

test('Realtime capture never opens the removed transcription-only socket', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-realtime-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const runs = [];
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish() {},
    async runInput(_device, input) { runs.push(input); }
  });
  const audio = attachAudioInput({
    hub, directory,
    omniAudio: { startRealtime() { throw new Error('must not be called'); } }
  });
  t.after(() => hub.emit('shutdown'));

  await audio.handle(audioEvent('audio.input.start', device, {
    ...startData('bad-rt'), audio_mode: 'realtime', model_ref: 'qwen/realtime'
  }));

  await audio.handle(audioEvent('audio.input.chunk', device, {
    stream_id: 'bad-rt', seq: 0, data_b64: Buffer.alloc(4).toString('base64')
  }));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'bad-rt', reason: 'released' }));
  assert.equal(runs.length, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function audioEvent(topic, device, data) {
  return { topic, device, data };
}

function startData(streamId) {
  return { stream_id: streamId, format: 'pcm_s16le', sample_rate: 16000, channels: 1, mode: 'push_to_talk', lang: 'auto' };
}

test('ASR completion releases capture while the accepted runtime turn is pending', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-race-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const runStarted = deferred();
  const releaseRun = deferred();
  const published = [];
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish(topic, data) { published.push({ topic, data }); },
    async runInput() { runStarted.resolve(); await releaseRun.promise; }
  });
  const audio = attachAudioInput({ hub, directory, transcribe: async () => ({ text: 'first' }) });
  t.after(() => hub.emit('shutdown'));
  const pcm = Buffer.alloc(3200, 1).toString('base64');

  await audio.handle(audioEvent('audio.input.start', device, startData('first')));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'first', seq: 0, data_b64: pcm }));
  const firstEnd = audio.handle(audioEvent('audio.input.end', device, { stream_id: 'first', reason: 'released' }));
  await runStarted.promise;

  await audio.handle(audioEvent('audio.input.start', device, startData('second')));
  assert.equal(audio.streams.get(device)?.stream_id, 'second');
  assert.equal(published.some(({ data }) => data.error?.message === 'Audio stream already active'), false);

  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'second', reason: 'cancel' }));
  releaseRun.resolve();
  await firstEnd;
});

test('a late frame from an ended stream cannot clear its replacement', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-late-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish() {},
    async runInput() {}
  });
  const audio = attachAudioInput({ hub, directory, transcribe: async () => ({ text: 'ok' }) });
  t.after(() => hub.emit('shutdown'));
  const pcm = Buffer.alloc(3200, 1).toString('base64');

  await audio.handle(audioEvent('audio.input.start', device, startData('old')));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'old', reason: 'cancel' }));
  await audio.handle(audioEvent('audio.input.start', device, startData('current')));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'old', seq: 0, data_b64: pcm }));
  assert.equal(audio.streams.get(device)?.stream_id, 'current');
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'current', seq: 0, data_b64: pcm }));
  assert.equal(audio.streams.get(device)?.nextSeq, 1);
});

test('a malformed chunk without a stream id cannot clear the active recording', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-malformed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish() {},
    async runInput() {}
  });
  const audio = attachAudioInput({ hub, directory, transcribe: async () => ({ text: 'ok' }) });
  t.after(() => hub.emit('shutdown'));
  const pcm = Buffer.alloc(3200, 1).toString('base64');

  await audio.handle(audioEvent('audio.input.start', device, startData('current')));
  await audio.handle(audioEvent('audio.input.chunk', device, { seq: 0, data_b64: pcm }));
  assert.equal(audio.streams.get(device)?.stream_id, 'current');
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: '', seq: 0, data_b64: pcm }));
  assert.equal(audio.streams.get(device)?.stream_id, 'current');
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'current', seq: 0, data_b64: pcm }));
  assert.equal(audio.streams.get(device)?.nextSeq, 1);
});

test('empty ASR result reports once and never enqueues a user turn', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-empty-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const published = [];
  let runs = 0;
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish(topic, data) { published.push({ topic, data }); },
    async runInput() { runs += 1; }
  });
  const audio = attachAudioInput({ hub, directory, transcribe: async () => ({ text: '   ' }) });
  t.after(() => hub.emit('shutdown'));
  const pcm = Buffer.alloc(3200, 1).toString('base64');

  await audio.handle(audioEvent('audio.input.start', device, startData('silent')));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'silent', seq: 0, data_b64: pcm }));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'silent', reason: 'released' }));

  assert.equal(runs, 0);
  assert.deepEqual(published.map(({ data }) => data.error?.message).filter(Boolean), ['Empty transcription']);
  await audio.handle(audioEvent('audio.input.start', device, startData('next')));
  assert.equal(audio.streams.get(device)?.stream_id, 'next');
});

test('a rejected recording reports its start error once without Unknown stream noise', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.audio-rejected-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const device = { device_id: 'phone', ws: {} };
  const releaseAsr = deferred();
  const asrStarted = deferred();
  const published = [];
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[device.device_id, device]]),
    publish(topic, data) { published.push({ topic, data }); },
    async runInput() {}
  });
  const audio = attachAudioInput({
    hub,
    directory,
    transcribe: async () => { asrStarted.resolve(); await releaseAsr.promise; return { text: 'first' }; }
  });
  t.after(() => hub.emit('shutdown'));
  const pcm = Buffer.alloc(3200, 1).toString('base64');

  await audio.handle(audioEvent('audio.input.start', device, startData('first')));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'first', seq: 0, data_b64: pcm }));
  const firstEnd = audio.handle(audioEvent('audio.input.end', device, { stream_id: 'first', reason: 'released' }));
  await asrStarted.promise;
  await audio.handle(audioEvent('audio.input.start', device, startData('rejected')));
  await audio.handle(audioEvent('audio.input.chunk', device, { stream_id: 'rejected', seq: 0, data_b64: pcm }));
  await audio.handle(audioEvent('audio.input.end', device, { stream_id: 'rejected', reason: 'released' }));

  const errors = published.map(({ data }) => data.error?.message).filter(Boolean);
  assert.deepEqual(errors, ['Audio stream already active']);
  releaseAsr.resolve();
  await firstEnd;
});

test('TC-VOC-023 asrService loadAsrProvider honours voice.active_asr', () => {
  const fsx = require('node:fs'); const os = require('node:os');
  const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'asr-active-'));
  const file = path.join(dir, 'providers.yaml');
  fsx.writeFileSync(file, ['version: 2', 'active_model: c/m', 'voice: { active_asr: second }', 'providers:',
    '  c: { type: openai_compatible, base_url: "https://x/v1", model: m, api_key: k }',
    '  first: { type: asr_dashscope, base_url: "https://d/api/v1", api_key: k, model: a }',
    '  second: { type: asr_openai_compatible, base_url: "https://o/v1", api_key: k, asr_model: legacy }'].join('\n'));
  const prev = process.env.PROVIDER_CONFIG_PATH; process.env.PROVIDER_CONFIG_PATH = file;
  try {
    const provider = require('../../../apps/gateway/deviceHub/asrService').loadAsrProvider();
    assert.equal(provider.key, 'second'); assert.equal(provider.model, 'legacy');
  } finally { if (prev === undefined) delete process.env.PROVIDER_CONFIG_PATH; else process.env.PROVIDER_CONFIG_PATH = prev; }
});
