'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAudio(windowOverrides = {}, contextOverrides = {}) {
  const window = { setTimeout, clearTimeout, ...windowOverrides };
  const source = fs.readFileSync(path.join(__dirname, '../../apps/android/app/src/main/assets/web/js/audio.js'), 'utf8');
  vm.runInNewContext(source, { window, AbortController, fetch: contextOverrides.fetch }, { filename: 'audio.js' });
  return window.YachiyoVoice;
}

test('AudioContext requests the stable playback latency path', () => {
  let options;
  function Context(value) { options = value; }
  const { createPlaybackAudioContext } = loadAudio();

  const context = createPlaybackAudioContext(Context);

  assert.ok(context instanceof Context);
  assert.equal(options.latencyHint, 'playback');
});

test('AudioContext falls back when an old WebView rejects options', () => {
  const calls = [];
  function LegacyContext(options) {
    calls.push(options);
    if (arguments.length) throw new TypeError('options unsupported');
  }
  const { createPlaybackAudioContext } = loadAudio();

  assert.ok(createPlaybackAudioContext(LegacyContext) instanceof LegacyContext);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].latencyHint, 'playback');
  assert.equal(calls[1], undefined);
});

test('resume must reach running and cannot hang forever', async () => {
  const { ensureAudioContextRunning } = loadAudio();
  const resumed = { state: 'suspended', async resume() { this.state = 'running'; } };
  await ensureAudioContextRunning(resumed, 20);
  assert.equal(resumed.state, 'running');

  await assert.rejects(
    ensureAudioContextRunning({ state: 'suspended', resume: async () => {} }, 20),
    /remained suspended/
  );
  await assert.rejects(
    ensureAudioContextRunning({ state: 'suspended', resume: () => new Promise(() => {}) }, 5),
    /timed out/
  );
});

test('playback watchdog requires the audio clock to advance and remain running', async () => {
  const { waitForAudioContextProgress } = loadAudio();
  const progressing = { state: 'running', currentTime: 0 };
  setTimeout(() => { progressing.currentTime = 0.02; }, 5);
  await waitForAudioContextProgress(progressing, 0, 50);

  const failed = { state: 'running', currentTime: 0 };
  setTimeout(() => { failed.state = 'suspended'; }, 5);
  await assert.rejects(waitForAudioContextProgress(failed, 0, 50), /became suspended/);

  await assert.rejects(
    waitForAudioContextProgress({ state: 'running', currentTime: 0 }, 0, 25),
    /clock did not advance/
  );
});

test('voice.play waits for clock progress before reporting started', async () => {
  let sourceStarted = false;
  class FailingAfterStartContext {
    constructor(options) {
      this.options = options;
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
    }
    createAnalyser() { return { connect() {} }; }
    createGain() { return { connect() {}, gain: { value: 1 } }; }
    async resume() { this.state = 'running'; }
    async decodeAudioData() { return {}; }
    createBufferSource() {
      return {
        connect() {},
        start: () => { sourceStarted = true; setTimeout(() => { this.state = 'suspended'; }, 5); },
        stop() {},
        set buffer(value) { this.value = value; }
      };
    }
  }
  const published = [];
  const api = loadAudio({
    AudioContext: FailingAfterStartContext,
    YachiyoServerAddress: { baseUrl: () => 'http://127.0.0.1:3002' }
  }, {
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })
  });
  const voice = api.createVoice({
    bridge: {
      publish(topic) { published.push(topic); },
      subscribe() { return () => {}; }
    },
    lipsync: { start() {}, stop() {} },
    getConfig: () => ({ server: {}, audio: {} })
  });

  await voice.playUrl({ request_id: 'hal-failure', url: '/voice.wav' });

  assert.equal(sourceStarted, true);
  assert.equal(voice.speaking, false);
  assert.deepEqual(published, ['voice.playback.ended']);
});

test('voice.play reports started only after the context clock advances', async () => {
  class WorkingContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    createAnalyser() { return { connect() {} }; }
    createGain() { return { connect() {}, gain: { value: 1 } }; }
    async resume() { this.state = 'running'; }
    async decodeAudioData() { return {}; }
    createBufferSource() {
      return {
        connect() {},
        start: () => { setTimeout(() => { this.currentTime = 0.02; }, 5); },
        stop() {},
        set buffer(value) { this.value = value; }
      };
    }
  }
  const published = [];
  const api = loadAudio({
    AudioContext: WorkingContext,
    YachiyoServerAddress: { baseUrl: () => 'http://127.0.0.1:3002' }
  }, {
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })
  });
  const voice = api.createVoice({
    bridge: {
      publish(topic) { published.push(topic); },
      subscribe() { return () => {}; }
    },
    lipsync: { start() {}, stop() {} },
    getConfig: () => ({ server: {}, audio: {} })
  });

  await voice.playUrl({ request_id: 'working', url: '/voice.wav' });
  assert.equal(voice.speaking, true);
  assert.deepEqual(published, ['voice.playback.started']);

  voice.stop('test');
  assert.equal(voice.speaking, false);
  assert.deepEqual(published, ['voice.playback.started', 'voice.playback.ended']);
});

test('voice.play does not report started or remain occupied when audio stays suspended', async () => {
  class SuspendedContext {
    constructor() { this.state = 'suspended'; this.destination = {}; }
    createAnalyser() { return { connect() {} }; }
    createGain() { return { connect() {}, gain: { value: 1 } }; }
    async resume() {}
  }
  const published = [];
  let fetchCalls = 0;
  const api = loadAudio({ AudioContext: SuspendedContext }, { fetch: async () => { fetchCalls += 1; } });
  const voice = api.createVoice({
    bridge: {
      publish(topic, data) { published.push({ topic, data }); },
      subscribe() { return () => {}; }
    },
    lipsync: { start() {}, stop() {} },
    getConfig: () => ({ server: {}, audio: {} })
  });

  await voice.playUrl({ request_id: 'stuck', url: '/voice.wav' });

  assert.equal(fetchCalls, 0);
  assert.equal(voice.speaking, false);
  assert.deepEqual(published.map((item) => item.topic), ['voice.playback.ended']);
});
