const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CURVE_DEFINITION,
  DEFAULT_RANGES,
  resolveSiriWaveLayout,
  resolveSiriWaveMotion,
  stabilizeSiriWaveInstance
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

test('resolveSiriWaveMotion gives speech a stronger visible baseline than music', () => {
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

  assert.ok(speech.amplitude > music.amplitude);
  assert.ok(speech.speed > music.speed);
  assert.ok(speech.amplitude >= 0.9);
  assert.ok(speech.speed <= 0.34);
  assert.ok(music.speed >= 0.1);
  assert.equal(DEFAULT_CURVE_DEFINITION.length, 4);
  assert.deepEqual(DEFAULT_RANGES.noOfCurves, [3, 5]);
  assert.deepEqual(DEFAULT_RANGES.speed, [0.34, 0.62]);
});

test('stabilizeSiriWaveInstance seeds flat ios9 curves into motion', () => {
  const wave = {
    heightMax: 56,
    curves: [
      {
        definition: { supportLine: true }
      },
      {
        definition: { color: '72, 184, 255' },
        noOfCurves: 0,
        amplitudes: [],
        finalAmplitudes: [],
        despawnTimeouts: [],
        offsets: [],
        speeds: [],
        widths: [],
        verses: [],
        phases: [],
        prevMaxY: 0,
        spawnAt: 0,
        spawn() {
          this.noOfCurves = 3;
          this.amplitudes = [0, 0, 0];
          this.finalAmplitudes = [0.48, 0.52, 0.56];
          this.despawnTimeouts = [900, 900, 900];
          this.offsets = [0, 0, 0];
          this.speeds = [0.72, 0.82, 0.9];
          this.widths = [1.1, 1.2, 1.3];
          this.verses = [0, 0.01, -0.02];
          this.phases = [0, 0, 0];
          this.spawnAt = Date.now();
        }
      }
    ]
  };

  const changed = stabilizeSiriWaveInstance(wave, {
    amplitude: 0.62,
    speed: 0.34
  }, {
    sourceKind: 'speech'
  });

  const curve = wave.curves[1];
  assert.equal(changed, true);
  assert.equal(curve.noOfCurves, 3);
  assert.ok(curve.amplitudes.every((value) => value >= 0.32));
  assert.ok(curve.finalAmplitudes.every((value) => value >= 0.48));
  assert.ok(curve.despawnTimeouts.every((value) => value >= 2200));
  assert.ok(curve.verses.every((value) => Math.abs(value) >= 0.12));
  assert.ok(curve.prevMaxY >= 1.2);
});
