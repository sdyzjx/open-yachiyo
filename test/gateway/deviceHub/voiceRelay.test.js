const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { fixture } = require('./helpers');

test('Voice relay serves temporary audio, deduplicates and drops stale host output', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.voice-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0; let clock = Date.now(); let afterSynthesis = () => {};
  const bus = new RuntimeEventBus();
  const f = await fixture(t, { bus, voice: { directory, now: () => clock, ttsClient: { async synthesize() { calls++; afterSynthesis(); return { buffer: Buffer.from('wav-bytes'), mime: 'audio/wav' }; } } } });
  const phone = await f.client('phone'); f.hub.avatarHost = 'phone';
  await f.hub.voiceRelay.handle({ request_id: 'r1', text: 'hello', session_id: 's' });
  const play = await phone.next((m) => m.topic === 'voice.play');
  assert.equal(new URL(play.data.url).searchParams.get('token'), 'test-token');
  assert.equal(await (await fetch(play.data.url)).text(), 'wav-bytes');
  await f.hub.voiceRelay.handle({ request_id: 'r1', text: 'hello' }); assert.equal(calls, 1);
  clock += 600001;
  assert.equal((await fetch(play.data.url)).status, 404);
  afterSynthesis = () => { f.hub.avatarHost = 'desktop'; };
  await f.hub.voiceRelay.handle({ request_id: 'r2', text: 'hello' }); await phone.sync();
  assert.equal(phone.inbox.some((m) => m.topic === 'voice.play'), false);
  await f.hub.voiceRelay.handle({ request_id: 'r3', text: 'hello' }); assert.equal(calls, 2);
});

test('TC-VOC-020 voice relay resolves the active tts provider per request (tts_openai_compatible)', async (t) => {
  const http = require('node:http');
  const { once } = require('node:events');
  const directory = fs.mkdtempSync(path.join(__dirname, '.voice-prov-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let speechReq;
  const mock = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    speechReq = { url: req.url, body: JSON.parse(Buffer.concat(chunks)) };
    res.setHeader('content-type', 'audio/mpeg'); res.end('mp3-bytes');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); t.after(() => new Promise((r) => mock.close(r)));
  const configPath = path.join(directory, 'providers.yaml');
  fs.writeFileSync(configPath, [
    'version: 2', 'active_model: c/m', 'voice: { active_tts: oai }', 'providers:',
    '  c: { type: openai_compatible, base_url: "https://x/v1", model: m, api_key: k }',
    `  oai: { type: tts_openai_compatible, base_url: "http://127.0.0.1:${mock.address().port}/v1", api_key: k, tts_model: tts-1, tts_voice: alloy }`
  ].join('\n'));
  const prev = process.env.PROVIDER_CONFIG_PATH; process.env.PROVIDER_CONFIG_PATH = configPath;
  t.after(() => { if (prev === undefined) delete process.env.PROVIDER_CONFIG_PATH; else process.env.PROVIDER_CONFIG_PATH = prev; });
  const f = await fixture(t, { bus: new RuntimeEventBus(), voice: { directory } });
  const phone = await f.client('phone'); f.hub.avatarHost = 'phone';
  await f.hub.voiceRelay.handle({ request_id: 'p1', text: 'hello phone' });
  const play = await phone.next((m) => m.topic === 'voice.play');
  assert.equal(play.data.mime, 'audio/mpeg');
  assert.equal(await (await fetch(play.data.url)).text(), 'mp3-bytes');
  assert.equal(speechReq.url, '/v1/audio/speech'); assert.equal(speechReq.body.input, 'hello phone');
});
