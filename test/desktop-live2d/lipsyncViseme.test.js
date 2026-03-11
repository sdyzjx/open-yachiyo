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

function renderFrame(runtimeState, spectrum, voiceEnergy = 0.72) {
  return resolveVisemeFrame({
    frequencyBuffer: spectrum.buffer,
    sampleRate: spectrum.sampleRate,
    voiceEnergy,
    speaking: true,
    fallbackOpen: 0,
    fallbackForm: 0,
    state: runtimeState
  });
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
  assert.ok(frame.mouthOpen > 0.25);
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
  assert.equal(frame.mouthOpen, 0);
  assert.equal(frame.mouthForm, 0);
});

test('resolveVisemeFrame holds the previous speaking mouth shape across brief low-signal gaps', () => {
  const bright = makeSpectrum({
    low: 0.08,
    lowMid: 0.12,
    mid: 0.3,
    highMid: 0.92,
    high: 0.76
  });
  const silent = makeSpectrum();
  const runtimeState = createRuntimeState();

  const activeFrame = resolveVisemeFrame({
    frequencyBuffer: bright.buffer,
    sampleRate: bright.sampleRate,
    voiceEnergy: 0.8,
    speaking: true,
    fallbackOpen: 0,
    fallbackForm: 0,
    state: runtimeState
  });

  const heldFrame = resolveVisemeFrame({
    frequencyBuffer: silent.buffer,
    sampleRate: silent.sampleRate,
    voiceEnergy: 0.01,
    speaking: true,
    fallbackOpen: 0,
    fallbackForm: 0,
    state: runtimeState,
    config: {
      silence: {
        holdFrames: 2,
        holdDecay: 0.82
      }
    }
  });

  assert.ok(activeFrame.mouthOpen > 0.25);
  assert.ok(heldFrame.mouthOpen > 0.05);
  assert.ok(Math.abs(heldFrame.mouthForm) > 0.05);
  assert.ok(heldFrame.mouthOpen < activeFrame.mouthOpen);
});

test('deriveMouthParams gives distinct vowel mouth shapes', () => {
  const aShape = deriveMouthParams({ a: 1, i: 0, u: 0, e: 0, o: 0 }, { voiceEnergy: 0.7, opennessHint: 0.8, spectralBalance: 0 });
  const iShape = deriveMouthParams({ a: 0, i: 1, u: 0, e: 0, o: 0 }, { voiceEnergy: 0.4, opennessHint: 0.35, spectralBalance: 0.6 });
  const uShape = deriveMouthParams({ a: 0, i: 0, u: 1, e: 0, o: 0 }, { voiceEnergy: 0.45, opennessHint: 0.4, spectralBalance: -0.6 });
  const oShape = deriveMouthParams({ a: 0, i: 0, u: 0, e: 0, o: 1 }, { voiceEnergy: 0.6, opennessHint: 0.55, spectralBalance: -0.4 });

  assert.ok(aShape.mouthOpen > oShape.mouthOpen);
  assert.ok(oShape.mouthOpen > uShape.mouthOpen);
  assert.ok(uShape.mouthOpen > iShape.mouthOpen);
  assert.ok(iShape.mouthForm > 0.7);
  assert.ok(uShape.mouthForm < -0.6);
  assert.ok(oShape.mouthForm < uShape.mouthForm);
});

test('resolveVisemeFrame detects stop-like transients and adds positive form overlay', () => {
  const runtimeState = createRuntimeState();
  renderFrame(runtimeState, makeSpectrum({
    low: 0.08,
    lowMid: 0.24,
    mid: 0.34,
    highMid: 0.02,
    high: 0.01
  }), 0.58);
  renderFrame(runtimeState, makeSpectrum({
    low: 0.08,
    lowMid: 0.38,
    mid: 0.66,
    highMid: 0.03,
    high: 0.01
  }), 0.8);
  const overlayFrame = renderFrame(runtimeState, makeSpectrum({
    low: 0.08,
    lowMid: 0.44,
    mid: 0.78,
    highMid: 0.04,
    high: 0.01
  }), 0.84);

  assert.equal(overlayFrame.consonantOverlay?.kind, 'stopLike');
  assert.ok((overlayFrame.consonantOverlay?.mouthFormDelta || 0) > 0.04);
});

test('resolveVisemeFrame detects fricative-like transients and narrows the mouth', () => {
  const runtimeState = createRuntimeState();
  renderFrame(runtimeState, makeSpectrum({
    low: 0.02,
    lowMid: 0.04,
    mid: 0.14,
    highMid: 0.28,
    high: 0.42
  }), 0.5);
  renderFrame(runtimeState, makeSpectrum({
    low: 0.02,
    lowMid: 0.05,
    mid: 0.2,
    highMid: 0.56,
    high: 0.82
  }), 0.74);
  const overlayFrame = renderFrame(runtimeState, makeSpectrum({
    low: 0.02,
    lowMid: 0.05,
    mid: 0.22,
    highMid: 0.62,
    high: 0.92
  }), 0.78);

  assert.equal(overlayFrame.consonantOverlay?.kind, 'fricativeLike');
  assert.ok((overlayFrame.consonantOverlay?.mouthFormDelta || 0) > 0.03);
  assert.ok((overlayFrame.consonantOverlay?.mouthOpenDelta || 0) < 0);
});

test('resolveVisemeFrame detects bilabial-like transients and briefly closes the mouth', () => {
  const runtimeState = createRuntimeState();
  renderFrame(runtimeState, makeSpectrum({
    low: 0.18,
    lowMid: 0.14,
    mid: 0.04,
    highMid: 0.01,
    high: 0
  }), 0.5);
  renderFrame(runtimeState, makeSpectrum({
    low: 0.44,
    lowMid: 0.28,
    mid: 0.06,
    highMid: 0.01,
    high: 0
  }), 0.78);
  const overlayFrame = renderFrame(runtimeState, makeSpectrum({
    low: 0.62,
    lowMid: 0.36,
    mid: 0.06,
    highMid: 0.01,
    high: 0
  }), 0.82);

  assert.equal(overlayFrame.consonantOverlay?.kind, 'bilabialLike');
  assert.ok((overlayFrame.consonantOverlay?.mouthOpenDelta || 0) < -0.08);
});
