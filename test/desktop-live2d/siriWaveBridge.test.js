const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CURVE_DEFINITION,
  DEFAULT_RANGES,
  resolveSiriWaveLayout,
  resolveSiriWaveMotion
} = require('../../apps/desktop-live2d/renderer/siriWaveBridge');

test('resolveSiriWaveLayout expands presenter geometry into a siriwave shell', () => {
  const layout = resolveSiriWaveLayout({
    geometry: {
      originX: 120,
      originY: 200,
      width: 420,
      height: 52
    }
  }, {
    width: 800,
    height: 600
  });

  assert.equal(layout.left, 120);
  assert.equal(layout.width, 420);
  assert.ok(layout.height >= 110);
  assert.ok(layout.top < 200);
});

test('resolveSiriWaveMotion keeps breath mode visually static', () => {
  const motion = resolveSiriWaveMotion({
    sourceKind: 'breath',
    energy: 0,
    waveformAlpha: 1
  });

  assert.equal(motion.amplitude, 0);
  assert.equal(motion.speed, 0);
  assert.equal(motion.opacity, 1);
});

test('resolveSiriWaveMotion boosts music more than speech', () => {
  const speech = resolveSiriWaveMotion({
    sourceKind: 'speech',
    energy: 0.5,
    actionScale: 1.1,
    waveformAlpha: 0.8
  });
  const music = resolveSiriWaveMotion({
    sourceKind: 'music',
    energy: 0.5,
    actionScale: 1.1,
    waveformAlpha: 0.8
  });

  assert.ok(music.amplitude > speech.amplitude);
  assert.ok(music.speed > speech.speed);
  assert.equal(DEFAULT_CURVE_DEFINITION.length, 4);
  assert.deepEqual(DEFAULT_RANGES.noOfCurves, [3, 5]);
});
