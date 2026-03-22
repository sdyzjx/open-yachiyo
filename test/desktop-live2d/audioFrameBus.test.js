const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RendererAudioFrameBus,
  createRendererAudioFrameBus,
  normalizeMode,
  normalizeSpeechFrame,
  normalizeMusicFrame,
  normalizeActionFrame
} = require('../../apps/desktop-live2d/renderer/audioFrameBus');

test('normalizeMode falls back to live2d for unsupported values', () => {
  assert.equal(normalizeMode('waveform'), 'waveform');
  assert.equal(normalizeMode('unsupported'), 'live2d');
});

test('normalize frame helpers clamp and normalize values', () => {
  const speech = normalizeSpeechFrame({
    speaking: true,
    voiceEnergy: 1.4,
    mouthOpen: 0.9,
    mouthForm: -1.4,
    weights: { a: 1, i: 0, u: 0, e: 0, o: 0 }
  });
  const music = normalizeMusicFrame({
    playing: true,
    energy: 0.8,
    bandLevels: [0.1, 0.5, 1.2]
  });
  const action = normalizeActionFrame({
    type: 'react',
    intensity: 1.8,
    progress: 0.5
  });

  assert.equal(speech.energy, 1);
  assert.equal(speech.mouthForm, -1);
  assert.equal(music.bandLevels[2], 1);
  assert.equal(action.intensity, 1);
});

test('RendererAudioFrameBus stores latest frames and notifies subscribers', () => {
  const bus = createRendererAudioFrameBus({ mode: 'waveform' });
  const snapshots = [];
  const unsubscribe = bus.subscribe((snapshot) => {
    snapshots.push(snapshot);
  });

  bus.setSpeechFrame({ speaking: true, voiceEnergy: 0.7, mouthOpen: 0.5, mouthForm: 0.2 });
  bus.setMusicFrame({ playing: true, energy: 0.6, bandLevels: [0.1, 0.6, 0.4] });
  bus.setActionFrame({ type: 'gesture', intensity: 0.4, progress: 0.2 });

  assert.equal(snapshots.length >= 3, true);
  const snapshot = bus.snapshot();
  assert.equal(snapshot.mode, 'waveform');
  assert.equal(snapshot.speechFrame.speaking, true);
  assert.equal(snapshot.musicFrame.playing, true);
  assert.equal(snapshot.actionFrame.type, 'gesture');

  unsubscribe();
  const afterUnsubscribeCount = snapshots.length;
  bus.setMode('hybrid');
  assert.equal(snapshots.length, afterUnsubscribeCount);
});

test('RendererAudioFrameBus exposes a compatible class constructor', () => {
  const bus = new RendererAudioFrameBus();
  assert.equal(bus.mode, 'live2d');
  assert.equal(bus.snapshot().speechFrame, null);
});
