const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sampleCanvasMetrics,
  buildSiriWaveDebugState
} = require('../../apps/desktop-live2d/renderer/siriWaveDebugTools');

function createCanvas({ width, height, activeRows = [] }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const row of activeRows) {
    for (let x = 0; x < width; x += 1) {
      data[(row * width + x) * 4 + 3] = 255;
    }
  }
  return {
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`
    },
    getContext() {
      return {
        getImageData() {
          return { data };
        }
      };
    }
  };
}

test('sampleCanvasMetrics measures active rows and vertical span', () => {
  const metrics = sampleCanvasMetrics(createCanvas({
    width: 8,
    height: 6,
    activeRows: [2, 3, 4]
  }), {
    stride: 1,
    alphaThreshold: 8
  });

  assert.equal(metrics.available, true);
  assert.equal(metrics.activeRows, 3);
  assert.equal(metrics.verticalSpanPx, 3);
  assert.ok(metrics.activeSampleCount > 0);
  assert.equal(metrics.maxAlpha, 255);
});

test('buildSiriWaveDebugState flags a nearly flat rendered canvas', () => {
  const state = buildSiriWaveDebugState({
    wave: {
      run: true,
      amplitude: 0.84,
      speed: 0.41,
      interpolation: {
        amplitude: 0.92,
        speed: 0.45
      },
      opt: {
        ratio: 2
      },
      heightMax: 59,
      canvas: createCanvas({
        width: 12,
        height: 10,
        activeRows: [4]
      }),
      curves: [
        { definition: { supportLine: true } },
        {
          definition: { supportLine: false },
          noOfCurves: 3,
          amplitudes: [0.36, 0.28, 0.24],
          finalAmplitudes: [0.7, 0.8, 0.9],
          prevMaxY: 1.8
        }
      ]
    },
    motion: {
      amplitude: 0.93,
      speed: 0.46,
      opacity: 1
    },
    layout: {
      left: 120,
      top: 220,
      width: 320,
      height: 108
    },
    snapshot: {
      sourceKind: 'speech'
    },
    generation: 4,
    recreateCount: 2,
    sampleCanvas: true
  });

  assert.equal(state.available, true);
  assert.equal(state.diagnosis, 'canvas_nearly_flat');
  assert.equal(state.generation, 4);
  assert.equal(state.recreateCount, 2);
  assert.equal(state.canvas.sample.verticalSpanPx, 1);
  assert.equal(state.curves.clusterCount, 3);
  assert.equal(state.curves.activeClusterCount, 3);
});
