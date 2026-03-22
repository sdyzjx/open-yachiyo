(function initWaveformPresenter(globalScope) {
  const MODE_SET = new Set(['live2d', 'waveform', 'hybrid']);
  const SOURCE_PRIORITY = ['speech', 'music', 'breath'];
  const TAU = Math.PI * 2;

  const DEFAULT_CONFIG = Object.freeze({
    mode: 'live2d',
    sourcePriority: SOURCE_PRIORITY,
    breath: Object.freeze({
      amplitude: 0.028,
      periodMs: 4200,
      phaseOffset: -Math.PI / 2
    }),
    smoothing: Object.freeze({
      energyAttack: 0.24,
      energyRelease: 0.1,
      bandAttack: 0.18,
      bandRelease: 0.08,
      formAttack: 0.18,
      formRelease: 0.1,
      scaleAttack: 0.24,
      scaleRelease: 0.1
    }),
    waveform: Object.freeze({
      sampleCount: 60,
      centerYRatio: 0.54,
      widthRatio: 0.68,
      heightRatio: 0.11,
      minHalfHeight: 8,
      maxHalfHeightRatio: 0.18,
      pointEdgeCurve: 3.4,
      centerCurve: 1,
      backgroundAlpha: 0.015,
      fillAlpha: 0.015,
      strokeAlpha: 1,
      glowAlpha: 0.045
    }),
    hybrid: Object.freeze({
      modelAlpha: 0.28,
      waveformAlpha: 1
    }),
    colors: Object.freeze({
      speech: 0x92e9ff,
      music: 0xf4fbff,
      breath: 0xd0d9e2,
      accent: 0xfbfeff,
      shadow: 0x232c34,
      fill: 0x0d1117,
      glow: 0xc7f2ff
    })
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeMode(mode, fallback = DEFAULT_CONFIG.mode) {
    const normalized = String(mode || fallback).trim().toLowerCase();
    return MODE_SET.has(normalized) ? normalized : fallback;
  }

  function mergeConfig(input = {}) {
    const waveform = {
      ...DEFAULT_CONFIG.waveform,
      ...(input.waveform || {})
    };
    const breath = {
      ...DEFAULT_CONFIG.breath,
      ...(input.breath || {})
    };
    const smoothing = {
      ...DEFAULT_CONFIG.smoothing,
      ...(input.smoothing || {})
    };
    const hybrid = {
      ...DEFAULT_CONFIG.hybrid,
      ...(input.hybrid || {})
    };
    const colors = {
      ...DEFAULT_CONFIG.colors,
      ...(input.colors || {})
    };

    return {
      mode: normalizeMode(input.mode || DEFAULT_CONFIG.mode),
      sourcePriority: Array.isArray(input.sourcePriority) && input.sourcePriority.length > 0
        ? input.sourcePriority.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        : [...DEFAULT_CONFIG.sourcePriority],
      breath,
      smoothing,
      waveform: {
        ...waveform,
        sampleCount: Math.max(16, Math.floor(toFiniteNumber(waveform.sampleCount, DEFAULT_CONFIG.waveform.sampleCount)))
      },
      hybrid,
      colors
    };
  }

  function clamp01(value) {
    return clamp(toFiniteNumber(value, 0), 0, 1);
  }

  function quantizeValue(value, step) {
    const safeStep = Math.max(1, toFiniteNumber(step, 1));
    return Math.round(toFiniteNumber(value, 0) / safeStep) * safeStep;
  }

  function normalizePhase(value) {
    const safeValue = toFiniteNumber(value, 0);
    const wrapped = safeValue % TAU;
    return wrapped < 0 ? wrapped + TAU : wrapped;
  }

  function smoothValue(current, target, attack, release) {
    const safeCurrent = toFiniteNumber(current, 0);
    const safeTarget = toFiniteNumber(target, 0);
    const delta = safeTarget - safeCurrent;
    const alpha = delta >= 0 ? clamp01(attack) : clamp01(release);
    return safeCurrent + delta * alpha;
  }

  function buildFrequencyCurve(levels = [], sampleCount = 72) {
    const safeLevels = Array.isArray(levels) ? levels.map((value) => clamp01(value)) : [];
    const count = Math.max(1, Math.floor(sampleCount));
    if (safeLevels.length === 0) {
      return Array.from({ length: count }, () => 0);
    }
    if (safeLevels.length === 1) {
      return Array.from({ length: count }, () => safeLevels[0]);
    }

    const result = new Array(count);
    const maxIndex = safeLevels.length - 1;
    for (let index = 0; index < count; index += 1) {
      const ratio = count === 1 ? 0 : index / (count - 1);
      const scaled = ratio * maxIndex;
      const left = Math.floor(scaled);
      const right = Math.min(maxIndex, left + 1);
      const local = scaled - left;
      result[index] = safeLevels[left] + (safeLevels[right] - safeLevels[left]) * local;
    }
    return result;
  }

  function buildSpeechBands(frame, sampleCount) {
    const count = Math.max(1, Math.floor(sampleCount));
    const energy = clamp01(frame?.energy);
    const mouthOpen = clamp01(frame?.mouthOpen);
    const mouthForm = clamp(toFiniteNumber(frame?.mouthForm, 0), -1, 1);
    const confidence = clamp01(frame?.confidence);
    const weights = frame?.visemeWeights || {};
    const bias = [
      clamp01(weights.a),
      clamp01(weights.i),
      clamp01(weights.u),
      clamp01(weights.e),
      clamp01(weights.o)
    ];
    const curve = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1);
      const core = Math.pow(Math.sin(Math.PI * t), 1.65);
      const edgeSoftening = 1 - Math.pow(Math.abs(2 * t - 1), 1.2);
      const vowelBlend = bias[0] * 0.24 + bias[1] * 0.16 + bias[2] * 0.14 + bias[3] * 0.2 + bias[4] * 0.22;
      const formTilt = mouthForm * (t - 0.5) * 0.28;
      const openness = mouthOpen * (0.35 + core * 0.72);
      const detail = (vowelBlend * 0.42 + edgeSoftening * 0.16 + confidence * 0.08);
      curve[index] = clamp01(openness + detail + formTilt + energy * 0.2);
    }
    return curve;
  }

  function buildMusicBands(frame, sampleCount) {
    const sourceBands = Array.isArray(frame?.bandLevels) && frame.bandLevels.length > 0
      ? frame.bandLevels
      : Array.isArray(frame?.spectrum) && frame.spectrum.length > 0
        ? frame.spectrum
        : [];
    const energy = clamp01(frame?.energy);
    const curve = buildFrequencyCurve(sourceBands, sampleCount);
    return curve.map((value, index) => {
      const t = curve.length === 1 ? 0 : index / (curve.length - 1);
      const edgeEase = 1 - Math.pow(Math.abs(2 * t - 1), 0.9);
      return clamp01(value * 0.88 + energy * 0.32 + edgeEase * 0.12);
    });
  }

  function buildBreathBands(breathPhase, sampleCount, amplitude) {
    const count = Math.max(1, Math.floor(sampleCount));
    const curve = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1);
      const core = Math.pow(Math.sin(Math.PI * t), 1.45);
      curve[index] = clamp01(0.018 + amplitude * (0.14 + core * 0.18));
    }
    return curve;
  }

  function smoothCurve(currentCurve, targetCurve, attack, release) {
    const safeTarget = Array.isArray(targetCurve) ? targetCurve : [];
    if (!Array.isArray(currentCurve) || currentCurve.length !== safeTarget.length) {
      return [...safeTarget];
    }
    const nextCurve = new Array(safeTarget.length);
    for (let index = 0; index < safeTarget.length; index += 1) {
      nextCurve[index] = smoothValue(currentCurve[index], safeTarget[index], attack, release);
    }
    return nextCurve;
  }

  function selectActiveSource(state, config) {
    const order = config.sourcePriority;
    for (const source of order) {
      if (source === 'speech' && state.speechFrame?.speaking && state.speechFrame.energy > 0) {
        return 'speech';
      }
      if (source === 'music' && state.musicFrame?.playing && state.musicFrame.energy > 0) {
        return 'music';
      }
    }
    return 'breath';
  }

  function resolveModelAlpha(mode, config, sourceKind) {
    if (mode === 'live2d') {
      return 1;
    }
    if (mode === 'waveform') {
      return 0;
    }
    const base = clamp01(config.hybrid?.modelAlpha ?? DEFAULT_CONFIG.hybrid.modelAlpha);
    if (sourceKind === 'speech') {
      return clamp(base + 0.06, 0, 1);
    }
    if (sourceKind === 'music') {
      return clamp(base - 0.02, 0, 1);
    }
    return base;
  }

  function resolveWaveformAlpha(mode, config, sourceKind) {
    if (mode === 'live2d') {
      return 0;
    }
    if (mode === 'waveform') {
      return 1;
    }
    const base = clamp01(config.hybrid?.waveformAlpha ?? DEFAULT_CONFIG.hybrid.waveformAlpha);
    if (sourceKind === 'breath') {
      return clamp(base * 0.92, 0, 1);
    }
    return base;
  }

  function resolveExpressionWaveProfile(actionFrame) {
    const neutral = Object.freeze({
      weight: 0,
      heightBoost: 0,
      centerArch: 0,
      edgePinch: 0,
      asymmetry: 0,
      bandBias: 0
    });
    if (!actionFrame || typeof actionFrame !== 'object') {
      return neutral;
    }
    const type = String(actionFrame.type || '').trim().toLowerCase();
    const name = String(actionFrame.name || '').trim().toLowerCase();
    if (!name || !['expression', 'emote', 'react'].includes(type)) {
      return neutral;
    }

    const weight = clamp01(actionFrame.intensity) * (0.76 + Math.sin(clamp01(actionFrame.progress) * Math.PI) * 0.24);
    if (weight <= 0.01) {
      return neutral;
    }

    if (/(smile|happy|joy|laugh|grin|love|heart)/.test(name)) {
      return {
        weight,
        heightBoost: 0.16,
        centerArch: -0.055,
        edgePinch: 0.08,
        asymmetry: 0.01,
        bandBias: 0.06
      };
    }
    if (/(sad|cry|tear|down|sorrow|hurt)/.test(name)) {
      return {
        weight,
        heightBoost: -0.08,
        centerArch: 0.05,
        edgePinch: 0.12,
        asymmetry: -0.008,
        bandBias: -0.05
      };
    }
    if (/(angry|mad|annoy|rage|frown)/.test(name)) {
      return {
        weight,
        heightBoost: 0.12,
        centerArch: 0.012,
        edgePinch: -0.04,
        asymmetry: 0.024,
        bandBias: 0.08
      };
    }
    if (/(surprise|shock|wow|blink|startled)/.test(name)) {
      return {
        weight,
        heightBoost: 0.2,
        centerArch: -0.018,
        edgePinch: -0.06,
        asymmetry: 0,
        bandBias: 0.1
      };
    }

    return {
      weight,
      heightBoost: 0.08,
      centerArch: -0.014,
      edgePinch: 0.02,
      asymmetry: 0.006,
      bandBias: 0.03
    };
  }

  function buildGeometry({
    stageWidth,
    stageHeight,
    bandLevels,
    sourceKind,
    energy,
    form,
    actionScale,
    breathPhase,
    expressionProfile,
    config
  }) {
    const waveformConfig = config.waveform;
    const width = Math.max(1, Math.round(stageWidth * clamp01(waveformConfig.widthRatio)));
    const height = Math.max(1, Math.round(stageHeight * clamp01(waveformConfig.heightRatio)));
    const originX = Math.max(0, Math.round((stageWidth - width) / 2));
    const originY = Math.max(0, Math.round(stageHeight * clamp01(waveformConfig.centerYRatio) - height / 2));
    const sampleCount = waveformConfig.sampleCount;
    const bandCurve = Array.isArray(bandLevels) && bandLevels.length > 0
      ? buildFrequencyCurve(bandLevels, sampleCount)
      : buildBreathBands(breathPhase, sampleCount, energy);

    const centerY = height / 2;
    const baseHalfHeight = Math.max(
      waveformConfig.minHalfHeight,
      Math.min(
        height * waveformConfig.maxHalfHeightRatio,
        height * clamp01(waveformConfig.heightRatio) * (0.32 + energy * 0.64 + actionScale * 0.1)
      )
    );
    const pointCount = sampleCount;
    const topPoints = [];
    const bottomPoints = [];
    const centerLine = [];
    const sourceShape = sourceKind === 'music'
      ? 0.96
      : sourceKind === 'speech'
        ? 1.04
        : 0.84;
    const expression = expressionProfile || resolveExpressionWaveProfile(null);
    const xQuantum = Math.max(6, Math.round(width / Math.max(10, pointCount * 0.68)));
    const yQuantum = Math.max(4, Math.round(height * 0.055));

    for (let index = 0; index < pointCount; index += 1) {
      const t = pointCount === 1 ? 0 : index / (pointCount - 1);
      const edgeCurve = Math.pow(Math.sin(Math.PI * t), waveformConfig.pointEdgeCurve);
      const smileCurve = Math.sin(Math.PI * t);
      const band = quantizeValue(
        clamp01((bandCurve[index] || 0) + expression.bandBias * expression.weight * smileCurve),
        0.11
      );
      const wobble = sourceKind === 'breath'
        ? 0
        : Math.sin(breathPhase + t * TAU * 1.08) * (0.003 + energy * 0.008);
      const sourceLift = sourceKind === 'speech' ? form * (t - 0.5) * height * 0.07 : 0;
      const actionLift = actionScale > 1 ? Math.sin(t * Math.PI) * (actionScale - 1) * height * 0.025 : 0;
      const expressionHeightBoost = 1 + expression.heightBoost * expression.weight * (0.35 + smileCurve * 0.65);
      const expressionPinch = 1 - expression.edgePinch * expression.weight * (1 - edgeCurve);
      const halfHeight = baseHalfHeight
        * (0.22 + edgeCurve * 0.44 + band * 0.38)
        * sourceShape
        * expressionHeightBoost
        * expressionPinch;
      const x = quantizeValue(Math.round(t * width), xQuantum);
      const centerOffset = Math.sin((t - 0.5) * Math.PI * 2) * height * 0.008;
      const expressionLift = expression.centerArch * expression.weight * Math.pow(smileCurve, 1.08) * height;
      const expressionSkew = expression.asymmetry * expression.weight * Math.sin((t - 0.5) * TAU * 2) * height;
      const yCenter = quantizeValue(centerY
        + centerLift(sourceKind, energy, form, band, t, height)
        + sourceLift
        + actionLift
        + centerOffset
        + expressionLift
        + expressionSkew
        + wobble * height, yQuantum);
      const snappedHalfHeight = quantizeValue(halfHeight, yQuantum);
      const topY = Math.round(yCenter - snappedHalfHeight);
      const bottomY = Math.round(yCenter + snappedHalfHeight);
      topPoints.push({ x, y: topY });
      bottomPoints.push({ x, y: bottomY });
      centerLine.push({ x, y: Math.round(yCenter) });
    }

    return {
      originX,
      originY,
      width,
      height,
      centerY,
      topPoints,
      bottomPoints,
      centerLine,
      bandLevels: bandCurve
    };
  }

  function centerLift(sourceKind, energy, form, band, t, height) {
    if (sourceKind === 'speech') {
      return Math.sin((t - 0.5) * Math.PI * 1.5) * form * height * 0.035;
    }
    if (sourceKind === 'music') {
      return (band - 0.5) * height * 0.012;
    }
    return 0;
  }

  function computeActionScale(actionFrame, nowMs) {
    if (!actionFrame) {
      return 1;
    }

    const base = 1 + clamp01(actionFrame.intensity) * 0.34;
    const typeBias = {
      react: 0.18,
      emote: 0.14,
      gesture: 0.08,
      motion: 0.04,
      expression: 0.06
    }[actionFrame.type] || 0.05;
    const progress = clamp01(actionFrame.progress);
    const pulse = Math.sin(progress * Math.PI) * 0.12;
    const temporal = Math.sin((nowMs / 1000) * 2.4) * (actionFrame.type === 'react' ? 0.08 : 0.04);
    return clamp(base + typeBias + pulse + temporal, 1, 1.7);
  }

  function createWaveformPresenter(options = {}) {
    const config = mergeConfig(options.config || {});
    const state = {
      mode: normalizeMode(options.mode || config.mode),
      speechFrame: null,
      musicFrame: null,
      actionFrame: null,
      breathPhase: 0,
      lastTickMs: null,
      smoothedEnergy: 0,
      smoothedForm: 0,
      smoothedBandLevels: null,
      smoothedScale: 1,
      lastSnapshot: null
    };

    function setMode(mode) {
      state.mode = normalizeMode(mode, state.mode);
      return state.mode;
    }

    function ingestSpeechFrame(frame) {
      state.speechFrame = frame && typeof frame === 'object' ? { ...frame } : null;
      return state.speechFrame;
    }

    function ingestMusicFrame(frame) {
      state.musicFrame = frame && typeof frame === 'object' ? { ...frame } : null;
      return state.musicFrame;
    }

    function ingestActionFrame(frame) {
      state.actionFrame = frame && typeof frame === 'object' ? { ...frame } : null;
      return state.actionFrame;
    }

    function getState() {
      return {
        mode: state.mode,
        speechFrame: state.speechFrame ? { ...state.speechFrame } : null,
        musicFrame: state.musicFrame ? { ...state.musicFrame } : null,
        actionFrame: state.actionFrame ? { ...state.actionFrame } : null,
        breathPhase: state.breathPhase,
        smoothedEnergy: state.smoothedEnergy,
        smoothedForm: state.smoothedForm,
        smoothedScale: state.smoothedScale
      };
    }

    function tick({ nowMs = Date.now(), stageWidth = 640, stageHeight = 640 } = {}) {
      const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
      const safeStageWidth = Math.max(1, Math.round(toFiniteNumber(stageWidth, 640)));
      const safeStageHeight = Math.max(1, Math.round(toFiniteNumber(stageHeight, 640)));
      state.lastTickMs = safeNowMs;
      state.breathPhase = normalizePhase(
        (safeNowMs / Math.max(1, config.breath.periodMs)) * TAU + config.breath.phaseOffset
      );

      const sourceKind = selectActiveSource(state, config);
      const activeFrame = sourceKind === 'speech'
        ? state.speechFrame
        : sourceKind === 'music'
          ? state.musicFrame
          : null;
      const targetEnergy = sourceKind === 'speech'
        ? clamp01(activeFrame?.energy ?? activeFrame?.voiceEnergy ?? 0)
        : sourceKind === 'music'
          ? clamp01(activeFrame?.energy ?? 0)
          : 0;
      const targetScale = computeActionScale(state.actionFrame, safeNowMs);
      state.smoothedEnergy = smoothValue(
        state.smoothedEnergy,
        targetEnergy,
        config.smoothing.energyAttack,
        config.smoothing.energyRelease
      );
      state.smoothedScale = smoothValue(
        state.smoothedScale,
        targetScale,
        config.smoothing.scaleAttack,
        config.smoothing.scaleRelease
      );
      const targetForm = clamp(
        sourceKind === 'speech' ? toFiniteNumber(state.speechFrame?.mouthForm, 0) : 0,
        -1,
        1
      );
      state.smoothedForm = smoothValue(
        state.smoothedForm,
        targetForm,
        config.smoothing.formAttack,
        config.smoothing.formRelease
      );

      const speechWeights = state.speechFrame?.visemeWeights || null;
      const speechBandLevels = sourceKind === 'speech'
        ? buildSpeechBands({
          energy: state.speechFrame?.energy ?? state.speechFrame?.voiceEnergy ?? 0,
          mouthOpen: state.speechFrame?.mouthOpen ?? 0,
          mouthForm: state.speechFrame?.mouthForm ?? 0,
          confidence: state.speechFrame?.confidence ?? 0,
          visemeWeights: speechWeights || {}
        }, config.waveform.sampleCount)
        : null;
      const musicBandLevels = sourceKind === 'music'
        ? buildMusicBands({
          energy: state.musicFrame?.energy ?? 0,
          bandLevels: state.musicFrame?.bandLevels || [],
          spectrum: state.musicFrame?.spectrum || []
        }, config.waveform.sampleCount)
        : null;
      const breathBandLevels = sourceKind === 'breath'
        ? buildBreathBands(state.breathPhase, config.waveform.sampleCount, state.smoothedEnergy)
        : null;
      const rawBandLevels = speechBandLevels || musicBandLevels || breathBandLevels || buildBreathBands(state.breathPhase, config.waveform.sampleCount, 0);
      state.smoothedBandLevels = smoothCurve(
        state.smoothedBandLevels,
        rawBandLevels,
        config.smoothing.bandAttack,
        config.smoothing.bandRelease
      );
      const bandLevels = state.smoothedBandLevels || rawBandLevels;
      const form = clamp(state.smoothedForm, -1, 1);
      const expressionProfile = resolveExpressionWaveProfile(state.actionFrame);
      const geometry = buildGeometry({
        stageWidth: safeStageWidth,
        stageHeight: safeStageHeight,
        bandLevels,
        sourceKind,
        energy: state.smoothedEnergy,
        form,
        actionScale: state.smoothedScale,
        breathPhase: state.breathPhase,
        expressionProfile,
        config
      });
      const mode = state.mode;
      const snapshot = {
        mode,
        sourceKind,
        speechActive: Boolean(state.speechFrame?.speaking && state.speechFrame.energy > 0),
        musicActive: Boolean(state.musicFrame?.playing && state.musicFrame.energy >= 0),
        waveformVisible: mode !== 'live2d',
        modelVisible: mode !== 'waveform',
        modelAlpha: resolveModelAlpha(mode, config, sourceKind),
        waveformAlpha: resolveWaveformAlpha(mode, config, sourceKind),
        energy: state.smoothedEnergy,
        actionScale: state.smoothedScale,
        breathPhase: state.breathPhase,
        colors: {
          primary: config.colors[sourceKind] || config.colors.breath,
          shadow: config.colors.shadow,
          fill: config.colors.fill,
          glow: config.colors.glow,
          accent: config.colors.accent
        },
        geometry
      };
      state.lastSnapshot = snapshot;
      return snapshot;
    }

    return {
      setMode,
      ingestSpeechFrame,
      ingestMusicFrame,
      ingestActionFrame,
      tick,
      getState,
      getLastSnapshot: () => state.lastSnapshot
    };
  }

  const api = {
    MODE_SET,
    SOURCE_PRIORITY,
    DEFAULT_CONFIG,
    normalizeMode,
    mergeConfig,
    buildFrequencyCurve,
    buildSpeechBands,
    buildMusicBands,
    buildBreathBands,
    computeActionScale,
    createWaveformPresenter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererWaveformPresenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
