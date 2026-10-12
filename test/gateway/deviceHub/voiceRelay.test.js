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
  const f = await fixture(t, { bus, voice: { directory, now: () => clock, ttsClient: { async synthesizeNonStreaming() { calls++; afterSynthesis(); return { audioUrl: 'mock://audio', mimeType: 'audio/wav' }; }, async fetchAudioBuffer() { return Buffer.from('wav-bytes'); } } } });
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
