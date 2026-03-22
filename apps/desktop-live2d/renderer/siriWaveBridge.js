(function initSiriWaveBridge(globalScope) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const DEFAULT_CURVE_DEFINITION = Object.freeze([
    Object.freeze({
      color: '255,255,255',
      supportLine: true
    }),
    Object.freeze({
      color: '72, 184, 255'
    }),
    Object.freeze({
      color: '118, 150, 255'
    }),
    Object.freeze({
      color: '255, 105, 214'
    })
  ]);

  const DEFAULT_RANGES = Object.freeze({
    noOfCurves: Object.freeze([3, 5]),
    amplitude: Object.freeze([0.25, 1]),
    offset: Object.freeze([-2.4, 2.4]),
    width: Object.freeze([1, 2.2]),
    speed: Object.freeze([0.6, 1.1]),
    despawnTimeout: Object.freeze([900, 1800])
  });

  function resolveSiriWaveLayout(snapshot, stageSize = {}) {
    const stageWidth = Math.max(1, Math.round(toFiniteNumber(stageSize.width, 640)));
    const stageHeight = Math.max(1, Math.round(toFiniteNumber(stageSize.height, 640)));
    const geometry = snapshot?.geometry && typeof snapshot.geometry === 'object'
      ? snapshot.geometry
      : null;
    const width = geometry
      ? Math.max(180, Math.round(toFiniteNumber(geometry.width, stageWidth * 0.68)))
      : Math.max(180, Math.round(stageWidth * 0.68));
    const rawHeight = geometry
      ? Math.max(72, Math.round(toFiniteNumber(geometry.height, 72) * 2.2))
      : Math.max(72, Math.round(stageHeight * 0.18));
    const height = Math.min(Math.max(72, rawHeight), Math.max(96, stageHeight - 24));
    const left = geometry
      ? clamp(Math.round(toFiniteNumber(geometry.originX, 0)), 0, Math.max(0, stageWidth - width))
      : Math.max(0, Math.round((stageWidth - width) / 2));
    const centerY = geometry
      ? Math.round(toFiniteNumber(geometry.originY, 0) + toFiniteNumber(geometry.height, height / 2) / 2)
      : Math.round(stageHeight * 0.54);
    const top = clamp(Math.round(centerY - height / 2), 8, Math.max(8, stageHeight - height - 8));
    return {
      left,
      top,
      width,
      height
    };
  }

  function resolveSiriWaveMotion(snapshot) {
    const sourceKind = String(snapshot?.sourceKind || 'breath').trim().toLowerCase();
    const energy = clamp(toFiniteNumber(snapshot?.energy, 0), 0, 1);
    const actionScale = clamp(toFiniteNumber(snapshot?.actionScale, 1), 1, 1.8);
    const actionBoost = clamp((actionScale - 1) / 0.8, 0, 1);
    const waveformAlpha = clamp(toFiniteNumber(snapshot?.waveformAlpha, 0), 0, 1);

    if (sourceKind === 'breath') {
      return {
        amplitude: 0,
        speed: 0,
        opacity: waveformAlpha
      };
    }

    const baseAmplitude = sourceKind === 'music' ? 0.26 : 0.18;
    const baseSpeed = sourceKind === 'music' ? 0.16 : 0.12;
    return {
      amplitude: clamp(baseAmplitude + energy * 0.7 + actionBoost * 0.12, 0, 1),
      speed: clamp(baseSpeed + energy * 0.16 + actionBoost * 0.06, 0.08, 0.38),
      opacity: waveformAlpha
    };
  }

  const api = {
    DEFAULT_CURVE_DEFINITION,
    DEFAULT_RANGES,
    resolveSiriWaveLayout,
    resolveSiriWaveMotion
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererSiriWaveBridge = api;
})(typeof window !== 'undefined' ? window : globalThis);
