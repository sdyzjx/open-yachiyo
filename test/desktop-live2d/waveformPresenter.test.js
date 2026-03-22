const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONFIG,
  normalizeMode,
  buildSpeechBands,
  buildMusicBands,
  buildBreathBands,
  computeActionScale,
  createWaveformPresenter
} = require('../../apps/desktop-live2d/renderer/waveformPresenter');

test('normalizeMode defaults unsupported values to live2d', () => {
  assert.equal(normalizeMode('hybrid'), 'hybrid');
  assert.equal(normalizeMode('something-else'), 'live2d');
});

test('band builders produce stable output for speech, music, and breath sources', () => {
  const speechBands = buildSpeechBands({
    energy: 0.8,
    mouthOpen: 0.7,
    mouthForm: 0.2,
    confidence: 0.5,
    visemeWeights: { a: 1, i: 0, u: 0, e: 0, o: 0 }
  }, 24);
  const musicBands = buildMusicBands({ energy: 0.6, bandLevels: [0.1, 0.3, 0.7, 0.9] }, 24);
  const breathBands = buildBreathBands(1.2, 24, 0.12);

  assert.equal(speechBands.length, 24);
  assert.equal(musicBands.length, 24);
  assert.equal(breathBands.length, 24);
  assert.ok(speechBands.every((value) => value >= 0 && value <= 1));
  assert.ok(musicBands.some((value) => value > 0.5));
  assert.ok(breathBands.every((value) => value >= 0.03 && value <= 0.06));
  assert.ok(breathBands.some((value) => value > 0.05));
});

test('computeActionScale raises intensity for reactive actions', () => {
  const scale = computeActionScale({
    type: 'react',
    intensity: 0.9,
    progress: 0.5
  }, 123456);
  assert.ok(scale > 1.2);
});

test('createWaveformPresenter prioritizes speech over music in hybrid mode', () => {
  const presenter = createWaveformPresenter({
    mode: 'hybrid',
    config: {
      waveform: {
        sampleCount: 20,
        widthRatio: 0.8,
        heightRatio: 0.2,
        centerYRatio: 0.6
      }
    }
  });

  presenter.ingestMusicFrame({
    playing: true,
    energy: 0.65,
    bandLevels: [0.2, 0.7, 0.5, 0.8]
  });
  presenter.ingestSpeechFrame({
    speaking: true,
    energy: 0.75,
    mouthOpen: 0.66,
    mouthForm: 0.22,
    visemeWeights: { a: 0.8, i: 0.2, u: 0, e: 0, o: 0 }
  });
  presenter.ingestActionFrame({
    type: 'gesture',
    intensity: 0.4,
    progress: 0.25
  });

  const snapshot = presenter.tick({
    nowMs: 1000,
    stageWidth: 800,
    stageHeight: 600
  });

  assert.equal(snapshot.mode, 'hybrid');
  assert.equal(snapshot.sourceKind, 'speech');
  assert.equal(snapshot.modelVisible, true);
  assert.equal(snapshot.waveformVisible, true);
  assert.ok(snapshot.modelAlpha > 0);
  assert.ok(snapshot.waveformAlpha > 0);
  assert.equal(snapshot.geometry.topPoints.length, 20);
  assert.equal(snapshot.geometry.bottomPoints.length, 20);
  assert.ok(snapshot.actionScale > 1);
});

test('createWaveformPresenter switches to music when speech is absent', () => {
  const presenter = createWaveformPresenter({
    mode: 'waveform',
    config: {
      waveform: {
        sampleCount: 16
      }
    }
  });

  presenter.ingestMusicFrame({
    playing: true,
    energy: 0.6,
    bandLevels: [0.1, 0.3, 0.7, 0.9]
  });

  const snapshot = presenter.tick({
    nowMs: 2000,
    stageWidth: 640,
    stageHeight: 480
  });

  assert.equal(snapshot.sourceKind, 'music');
  assert.equal(snapshot.modelVisible, false);
  assert.equal(snapshot.waveformVisible, true);
  assert.ok(snapshot.geometry.bandLevels.some((value) => value > 0.3));
});

test('default config remains usable for live2d mode', () => {
  const presenter = createWaveformPresenter();
  const snapshot = presenter.tick({
    nowMs: 3000,
    stageWidth: 640,
    stageHeight: 480
  });

  assert.equal(snapshot.mode, DEFAULT_CONFIG.mode);
  assert.equal(snapshot.waveformVisible, false);
  assert.equal(snapshot.modelVisible, true);
  assert.equal(DEFAULT_CONFIG.colors.speech, 0xa9e8ff);
  assert.equal(DEFAULT_CONFIG.colors.music, 0xff8bdf);
  assert.equal(DEFAULT_CONFIG.colors.accent, 0xffe3f3);
  assert.equal(DEFAULT_CONFIG.colors.shadow, 0x1a2036);
});

test('expression name deforms waveform geometry beyond generic action scaling', () => {
  const buildSnapshot = (name) => {
    const presenter = createWaveformPresenter({
      mode: 'waveform',
      config: {
        waveform: {
          sampleCount: 20
        }
      }
    });

    presenter.ingestSpeechFrame({
      speaking: true,
      energy: 0.82,
      mouthOpen: 0.72,
      mouthForm: 0.18,
      visemeWeights: { a: 0.75, i: 0.15, u: 0.1, e: 0, o: 0 }
    });
    presenter.ingestActionFrame({
      type: 'expression',
      name,
      intensity: 0.8,
      progress: 0.5
    });
    return presenter.tick({
      nowMs: 1200,
      stageWidth: 720,
      stageHeight: 520
    });
  };

  const smile = buildSnapshot('smile');
  const sad = buildSnapshot('sad');

  assert.equal(smile.actionScale, sad.actionScale);
  assert.notDeepEqual(smile.geometry.topPoints, sad.geometry.topPoints);
  assert.notDeepEqual(smile.geometry.centerLine, sad.geometry.centerLine);
});

test('silent waveform stays effectively static across ticks', () => {
  const presenter = createWaveformPresenter({
    mode: 'waveform'
  });

  const first = presenter.tick({
    nowMs: 1000,
    stageWidth: 640,
    stageHeight: 480
  });
  const second = presenter.tick({
    nowMs: 1600,
    stageWidth: 640,
    stageHeight: 480
  });

  assert.equal(first.sourceKind, 'breath');
  assert.equal(second.sourceKind, 'breath');
  assert.deepEqual(second.geometry.bandLevels, first.geometry.bandLevels);
  assert.deepEqual(second.geometry.topPoints, first.geometry.topPoints);
  assert.ok(second.energy < 0.01);
});

test('waveform presenter phase advances continuously without compounded jumps', () => {
  const presenter = createWaveformPresenter({
    mode: 'waveform'
  });

  presenter.ingestMusicFrame({
    playing: true,
    energy: 0.7,
    bandLevels: [0.2, 0.8, 0.4, 0.9]
  });

  const first = presenter.tick({
    nowMs: 1000,
    stageWidth: 640,
    stageHeight: 480
  });
  const second = presenter.tick({
    nowMs: 1016,
    stageWidth: 640,
    stageHeight: 480
  });

  const delta = second.breathPhase - first.breathPhase;
  assert.ok(delta > 0);
  assert.ok(delta < 0.05);
});

test('waveform presenter smooths abrupt band changes between ticks', () => {
  const presenter = createWaveformPresenter({
    mode: 'waveform',
    config: {
      waveform: {
        sampleCount: 16
      }
    }
  });

  presenter.ingestMusicFrame({
    playing: true,
    energy: 1,
    bandLevels: [1, 1, 1, 1]
  });
  const hot = presenter.tick({
    nowMs: 1000,
    stageWidth: 640,
    stageHeight: 480
  });

  presenter.ingestMusicFrame({
    playing: true,
    energy: 0,
    bandLevels: [0, 0, 0, 0]
  });
  const cooled = presenter.tick({
    nowMs: 1040,
    stageWidth: 640,
    stageHeight: 480
  });

  assert.ok(hot.geometry.bandLevels.some((value) => value > 0.6));
  assert.ok(cooled.geometry.bandLevels.some((value) => value > 0.08));
  assert.notDeepEqual(cooled.geometry.topPoints, hot.geometry.topPoints);
  assert.ok(
    cooled.geometry.topPoints.some((point, index) => point.y !== hot.geometry.topPoints[index]?.y)
  );
});
