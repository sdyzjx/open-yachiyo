const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePresenterDebugOverride,
  applyPresenterDebugOverride,
  buildPresenterDebugState
} = require('../../apps/desktop-live2d/renderer/presenterDebugTools');

test('normalizePresenterDebugOverride builds an active speech override by default', () => {
  const override = normalizePresenterDebugOverride({
    sourceKind: 'speech',
    energy: 0.86
  });

  assert.equal(override.enabled, true);
  assert.equal(override.mode, 'waveform');
  assert.equal(override.sourceKind, 'speech');
  assert.equal(override.speechFrame.speaking, true);
  assert.ok(override.speechFrame.energy > 0.8);
  assert.equal(override.musicFrame.playing, false);
  assert.ok(Array.isArray(override.musicFrame.bandLevels));
  assert.ok(override.musicFrame.bandLevels.every((value) => value === 0));
});

test('applyPresenterDebugOverride forces visible music input over an idle snapshot', () => {
  const snapshot = {
    mode: 'live2d',
    speechFrame: null,
    musicFrame: null,
    actionFrame: null
  };

  const overridden = applyPresenterDebugOverride(snapshot, {
    sourceKind: 'music',
    energy: 0.72,
    bandLevels: [0.1, 0.4, 0.8, 0.5]
  });

  assert.equal(overridden.mode, 'waveform');
  assert.equal(overridden.speechFrame.speaking, false);
  assert.equal(overridden.musicFrame.playing, true);
  assert.ok(overridden.musicFrame.energy > 0.7);
  assert.deepEqual(
    overridden.musicFrame.bandLevels.slice(0, 4),
    [0.1, 0.4, 0.8, 0.5]
  );
});

test('buildPresenterDebugState summarizes input and rendered motion for inspection', () => {
  const state = buildPresenterDebugState({
    configuredMode: 'waveform',
    busSnapshot: {
      mode: 'waveform',
      speechFrame: null,
      musicFrame: null,
      actionFrame: null
    },
    effectiveSnapshot: applyPresenterDebugOverride({}, {
      sourceKind: 'music',
      energy: 0.7,
      bandLevels: [0.2, 0.6, 0.9, 0.4],
      action: {
        type: 'react',
        intensity: 0.75,
        progress: 0.3
      }
    }),
    presenterSnapshot: {
      mode: 'waveform',
      sourceKind: 'music',
      waveformVisible: true,
      modelVisible: false,
      energy: 0.64,
      actionScale: 1.28,
      geometry: {
        bandLevels: [0.21, 0.58, 0.87, 0.42]
      }
    },
    motion: {
      amplitude: 0.71,
      speed: 0.27,
      opacity: 1
    },
    layout: {
      left: 120,
      top: 210,
      width: 360,
      height: 124
    },
    siriWave: {
      available: true,
      diagnosis: 'canvas_nearly_flat',
      generation: 3,
      recreateCount: 1,
      actual: {
        amplitude: 0.42,
        speed: 0.18
      },
      target: {
        amplitude: 0.88,
        speed: 0.34
      },
      canvas: {
        cssWidth: 360,
        cssHeight: 124,
        pixelWidth: 720,
        pixelHeight: 248,
        heightMax: 118,
        sample: {
          verticalSpanPx: 2,
          activeRows: 1
        }
      },
      curves: {
        clusterCount: 4,
        activeClusterCount: 1,
        maxPrevMaxY: 1.8
      }
    },
    override: {
      sourceKind: 'music',
      energy: 0.7
    }
  });

  assert.equal(state.configuredMode, 'waveform');
  assert.equal(state.effectiveMode, 'waveform');
  assert.equal(state.input.sourceKind, 'music');
  assert.equal(state.input.music.playing, true);
  assert.ok(state.output.bandPreview.length > 0);
  assert.equal(state.output.motion.amplitude, 0.71);
  assert.deepEqual(state.output.layout, {
    left: 120,
    top: 210,
    width: 360,
    height: 124
  });
  assert.equal(state.output.siriWave.diagnosis, 'canvas_nearly_flat');
  assert.equal(state.output.siriWave.canvas.verticalSpanPx, 2);
  assert.equal(state.output.siriWave.curves.clusterCount, 4);
});
