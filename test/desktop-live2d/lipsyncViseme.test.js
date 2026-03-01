const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRuntimeState,
  deriveMouthParams,
  extractVisemeFeatures,
  resolveVisemeFrame
} = require('../../apps/desktop-live2d/renderer/lipsyncViseme');

function makeSpectrum({ low = 0, lowMid = 0, mid = 0, highMid = 0, high = 0 } = {}) {
  const sampleRate = 48000;
  const buffer = new Uint8Array(128);
  const bands = [
    { range: [120, 360], value: low },
    { range: [360, 900], value: lowMid },
    { range: [900, 1800], value: mid },
    { range: [1800, 3200], value: highMid },
    { range: [3200, 5200], value: high }
  ];

  const nyquist = sampleRate / 2;
  for (const band of bands) {
    const minIndex = Math.max(0, Math.floor((band.range[0] / nyquist) * buffer.length));
    const maxIndex = Math.min(buffer.length, Math.ceil((band.range[1] / nyquist) * buffer.length));
    for (let index = minIndex; index < maxIndex; index += 1) {
      buffer[index] = Math.round(Math.max(0, Math.min(255, band.value * 255)));
    }
  }

  return { buffer, sampleRate };
}

test('extractVisemeFeatures captures brighter spectra as spreadness', () => {
  const { buffer, sampleRate } = makeSpectrum({
    low: 0.1,
    lowMid: 0.18,
    mid: 0.35,
    highMid: 0.82,
    high: 0.7
  });

  const features = extractVisemeFeatures({
    frequencyBuffer: buffer,
    sampleRate,
    voiceEnergy: 0.72,
    state: createRuntimeState()
  });

  assert.ok(features.spreadness > features.roundness);
  assert.ok(features.spectralBalance > 0);
});

test('resolveVisemeFrame favors i/e and positive form for bright spectrum', () => {
  const { buffer, sampleRate } = makeSpectrum({
    low: 0.08,
    lowMid: 0.12,
    mid: 0.3,
    highMid: 0.92,
    high: 0.76
  });

  const runtimeState = createRuntimeState();
  const frame = resolveVisemeFrame({
    frequencyBuffer: buffer,
    sampleRate,
    voiceEnergy: 0.8,
    speaking: true,
    fallbackOpen: 0.22,
    fallbackForm: 0,
    state: runtimeState
  });

  assert.ok(frame.weights.i + frame.weights.e > frame.weights.o + frame.weights.u);
  assert.ok(frame.mouthForm > 0);
  assert.ok(frame.mouthOpen > 0.15);
});

test('resolveVisemeFrame favors o/u and negative form for darker spectrum', () => {
  const { buffer, sampleRate } = makeSpectrum({
    low: 0.82,
    lowMid: 0.7,
    mid: 0.28,
    highMid: 0.08,
    high: 0.04
  });

  const runtimeState = createRuntimeState();
  const frame = resolveVisemeFrame({
    frequencyBuffer: buffer,
    sampleRate,
    voiceEnergy: 0.78,
    speaking: true,
    fallbackOpen: 0.24,
    fallbackForm: 0,
    state: runtimeState
  });

  assert.ok(frame.weights.o + frame.weights.u > frame.weights.i + frame.weights.e);
  assert.ok(frame.mouthForm < 0);
  assert.ok(frame.confidence > 0.3);
});

test('resolveVisemeFrame falls back when speech energy is absent', () => {
  const { buffer, sampleRate } = makeSpectrum();
  const runtimeState = createRuntimeState();

  const frame = resolveVisemeFrame({
    frequencyBuffer: buffer,
    sampleRate,
    voiceEnergy: 0,
    speaking: false,
    fallbackOpen: 0.18,
    fallbackForm: -0.07,
    state: runtimeState
  });

  assert.equal(frame.confidence, 0);
  assert.ok(frame.mouthOpen < 0.05);
  assert.ok(Math.abs(frame.mouthForm) < 0.02);
});

test('deriveMouthParams gives distinct vowel mouth shapes', () => {
  const aShape = deriveMouthParams({ a: 1, i: 0, u: 0, e: 0, o: 0 }, { voiceEnergy: 0.7, opennessHint: 0.8, spectralBalance: 0 });
  const eShape = deriveMouthParams({ a: 0, i: 0, u: 0, e: 1, o: 0 }, { voiceEnergy: 0.5, opennessHint: 0.4, spectralBalance: 0.5 });
  const iShape = deriveMouthParams({ a: 0, i: 1, u: 0, e: 0, o: 0 }, { voiceEnergy: 0.4, opennessHint: 0.35, spectralBalance: 0.6 });
  const uShape = deriveMouthParams({ a: 0, i: 0, u: 1, e: 0, o: 0 }, { voiceEnergy: 0.45, opennessHint: 0.4, spectralBalance: -0.6 });
  const oShape = deriveMouthParams({ a: 0, i: 0, u: 0, e: 0, o: 1 }, { voiceEnergy: 0.6, opennessHint: 0.55, spectralBalance: -0.4 });

  assert.ok(oShape.mouthOpen > aShape.mouthOpen);
  assert.ok(oShape.mouthOpen > uShape.mouthOpen);
  assert.ok(aShape.mouthOpen > eShape.mouthOpen);
  assert.ok(eShape.mouthOpen > iShape.mouthOpen);
  assert.ok(iShape.mouthForm > 0.55);
  assert.ok(eShape.mouthForm > 0.5);
  assert.ok(aShape.mouthForm > 0);
  assert.ok(uShape.mouthForm < -0.45);
  assert.ok(oShape.mouthForm > uShape.mouthForm);
});

test('resolveVisemeFrame keeps weak speech restrained', () => {
  const { buffer, sampleRate } = makeSpectrum({
    low: 0.15,
    lowMid: 0.22,
    mid: 0.2,
    highMid: 0.12,
    high: 0.08
  });

  const frame = resolveVisemeFrame({
    frequencyBuffer: buffer,
    sampleRate,
    voiceEnergy: 0.18,
    speaking: true,
    fallbackOpen: 0.18,
    fallbackForm: 0,
    state: createRuntimeState()
  });

  assert.ok(frame.confidence > 0);
  assert.ok(frame.mouthOpen < 0.16);
  assert.ok(Math.abs(frame.mouthForm) < 0.08);
});

test('resolveVisemeFrame smooths abrupt viseme transitions across frames', () => {
  const bright = makeSpectrum({
    low: 0.08,
    lowMid: 0.12,
    mid: 0.3,
    highMid: 0.92,
    high: 0.76
  });
  const dark = makeSpectrum({
    low: 0.82,
    lowMid: 0.7,
    mid: 0.28,
    highMid: 0.08,
    high: 0.04
  });
  const state = createRuntimeState();

  const first = resolveVisemeFrame({
    frequencyBuffer: bright.buffer,
    sampleRate: bright.sampleRate,
    voiceEnergy: 0.8,
    speaking: true,
    fallbackOpen: 0.22,
    fallbackForm: 0,
    state
  });
  const second = resolveVisemeFrame({
    frequencyBuffer: dark.buffer,
    sampleRate: dark.sampleRate,
    voiceEnergy: 0.8,
    speaking: true,
    fallbackOpen: 0.22,
    fallbackForm: 0,
    state
  });
  const third = resolveVisemeFrame({
    frequencyBuffer: dark.buffer,
    sampleRate: dark.sampleRate,
    voiceEnergy: 0.8,
    speaking: true,
    fallbackOpen: 0.22,
    fallbackForm: 0,
    state
  });

  assert.ok(first.mouthForm > 0.1);
  assert.ok(second.mouthForm > -0.1);
  assert.ok(third.mouthForm < second.mouthForm);
  assert.ok(third.mouthForm < -0.1);
});

test('resolveVisemeFrame opens mouth more for sustained i vowel frames', () => {
  const bright = makeSpectrum({
    low: 0.08,
    lowMid: 0.12,
    mid: 0.3,
    highMid: 0.92,
    high: 0.76
  });
  const state = createRuntimeState();
  let frame = null;

  for (let index = 0; index < 5; index += 1) {
    frame = resolveVisemeFrame({
      frequencyBuffer: bright.buffer,
      sampleRate: bright.sampleRate,
      voiceEnergy: 0.8,
      speaking: true,
      fallbackOpen: 0.22,
      fallbackForm: 0,
      state
    });
  }

  assert.equal(frame.dominantViseme, 'i');
  assert.ok(frame.mouthOpen > 0.2);
  assert.ok(frame.mouthForm > 0.45);
});
