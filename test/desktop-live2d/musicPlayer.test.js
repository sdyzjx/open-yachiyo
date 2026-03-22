const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RendererMusicPlayer,
  analyzeFrequencyData,
  normalizeBandLevels
} = require('../../apps/desktop-live2d/renderer/musicPlayer');

class FakeMediaElementSource {
  constructor() {
    this.connections = [];
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }
}

class FakeAnalyser {
  constructor() {
    this.frequencyBinCount = 8;
    this.fftSize = 16;
    this.smoothingTimeConstant = 0;
    this.frequencyData = new Uint8Array([0, 32, 64, 96, 128, 160, 192, 255]);
    this.timeDomainData = new Uint8Array([128, 144, 112, 128, 160, 96, 128, 128, 140, 116, 128, 128, 128, 128, 128, 128]);
  }

  connect(node) {
    this.connectedNode = node;
    return node;
  }

  getByteFrequencyData(target) {
    target.set(this.frequencyData);
  }

  getByteTimeDomainData(target) {
    target.set(this.timeDomainData);
  }
}

class FakeGain {
  constructor() {
    this.gain = { value: 1 };
  }

  connect(node) {
    this.connectedNode = node;
    return node;
  }

  disconnect() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = {};
    this.analyser = new FakeAnalyser();
    this.gain = new FakeGain();
    this.resumeCalls = 0;
  }

  createAnalyser() {
    return this.analyser;
  }

  createGain() {
    return this.gain;
  }

  createMediaElementSource(audioElement) {
    this.mediaElement = audioElement;
    return new FakeMediaElementSource();
  }

  async resume() {
    this.resumeCalls += 1;
    this.state = 'running';
  }
}

class FakeAudioElement {
  constructor() {
    this.autoplay = false;
    this.preload = '';
    this.crossOrigin = '';
    this.loop = false;
    this.volume = 1;
    this.playbackRate = 1;
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.src = '';
    this.playCalls = 0;
    this.pauseCalls = 0;
  }

  async play() {
    this.playCalls += 1;
    this.paused = false;
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  load() {}

  removeAttribute(name) {
    if (name === 'src') {
      this.src = '';
    }
  }
}

test('analyzeFrequencyData resamples spectrum into bands', () => {
  const result = analyzeFrequencyData(new Uint8Array([0, 64, 128, 255]), 3);
  assert.equal(result.bandLevels.length, 3);
  assert.ok(result.energy > 0);
});

test('normalizeBandLevels preserves requested band count', () => {
  const bands = normalizeBandLevels([0.2, 0.8], 5);
  assert.equal(bands.length, 5);
  assert.ok(bands.every((value) => value >= 0 && value <= 1));
});

test('RendererMusicPlayer samples frequency and time-domain energy from analyser data', async () => {
  const audioContext = new FakeAudioContext();
  const audioElement = new FakeAudioElement();
  const player = new RendererMusicPlayer({
    audioContext,
    createAudioElement: () => audioElement
  });

  await player.play({ src: 'file:///tmp/demo.mp3', loop: true, volume: 0.72 });
  const frame = player.sampleFrame({ bandCount: 4 });

  assert.equal(audioElement.playCalls >= 1, true);
  assert.equal(frame.playing, true);
  assert.equal(frame.bandLevels.length, 4);
  assert.ok(frame.energy > 0);
  assert.ok(frame.timeDomainEnergy > 0);

  player.pause();
  assert.equal(player.isPlaying(), false);
});

test('RendererMusicPlayer resume requires a loaded source and stop resets playback', async () => {
  const audioContext = new FakeAudioContext();
  const audioElement = new FakeAudioElement();
  const player = new RendererMusicPlayer({
    audioContext,
    createAudioElement: () => audioElement
  });

  await player.load({ src: 'file:///tmp/demo.mp3' });
  player.pause();
  await player.resume();
  assert.equal(audioElement.playCalls >= 1, true);

  const stopped = player.stop();
  assert.equal(stopped.playing, false);
  assert.equal(audioElement.currentTime, 0);
});
