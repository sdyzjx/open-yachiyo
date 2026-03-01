(function initLive2dVisemeLipSync(globalScope) {
  const VISEME_NAMES = ['a', 'i', 'u', 'e', 'o'];
  const DEFAULT_CONFIG = Object.freeze({
    bands: {
      low: [120, 360],
      lowMid: [360, 900],
      mid: [900, 1800],
      highMid: [1800, 3200],
      high: [3200, 5200]
    },
    smoothing: {
      attack: 0.58,
      release: 0.34
    },
    fallbackBlend: {
      min: 0.28,
      max: 0.9
    },
    visemeShape: {
      sharpenPower: 1.55,
      targets: {
        a: { open: 0.7, form: 0.24 },
        i: { open: 0.25, form: 1 },
        u: { open: 0.6, form: -1 },
        e: { open: 0.35, form: 1 },
        o: { open: 0.8, form: -0.35 }
      }
    },
    articulation: {
      minOpenScale: 0.48,
      maxOpenScale: 1,
      minFormScale: 0.34,
      maxFormScale: 0.92,
      lowEnergyBias: 0.58
    },
    settle: {
      openAttack: 0.7,
      openRelease: 0.38,
      formAttack: 0.56,
      formRelease: 0.32,
      silenceOpenRelease: 0.44,
      silenceFormRelease: 0.4
    },
    silence: {
      energyThreshold: 0.045,
      confidenceThreshold: 0.12
    }
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, alpha) {
    const safeAlpha = clamp(Number(alpha) || 0, 0, 1);
    return start + (end - start) * safeAlpha;
  }

  function createNeutralWeights() {
    return {
      a: 0.2,
      i: 0.2,
      u: 0.2,
      e: 0.2,
      o: 0.2
    };
  }

  function cloneWeights(weights) {
    return {
      a: Number(weights?.a) || 0,
      i: Number(weights?.i) || 0,
      u: Number(weights?.u) || 0,
      e: Number(weights?.e) || 0,
      o: Number(weights?.o) || 0
    };
  }

  function normalizeWeights(weights) {
    const safeWeights = cloneWeights(weights);
    const total = VISEME_NAMES.reduce((sum, name) => sum + Math.max(0, safeWeights[name]), 0);
    if (total <= 1e-6) {
      return createNeutralWeights();
    }
    const normalized = {};
    for (const name of VISEME_NAMES) {
      normalized[name] = Math.max(0, safeWeights[name]) / total;
    }
    return normalized;
  }

  function sharpenWeights(weights, power = 1.4) {
    const normalized = normalizeWeights(weights);
    const safePower = Math.max(1, Number(power) || 1.4);
    const sharpened = {};
    for (const name of VISEME_NAMES) {
      sharpened[name] = Math.pow(Math.max(0, normalized[name]), safePower);
    }
    return normalizeWeights(sharpened);
  }

  function softmaxScores(scores, temperature = 3.2) {
    const safeTemperature = Math.max(0.1, Number(temperature) || 3.2);
    const values = VISEME_NAMES.map((name) => Number(scores?.[name]) || 0);
    const maxScore = Math.max(...values);
    const exps = values.map((value) => Math.exp((value - maxScore) * safeTemperature));
    const total = exps.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 1e-6) {
      return createNeutralWeights();
    }
    const weights = {};
    VISEME_NAMES.forEach((name, index) => {
      weights[name] = exps[index] / total;
    });
    return weights;
  }

  function createRuntimeState() {
    return {
      previousSpectrum: null,
      smoothedWeights: createNeutralWeights(),
      lastFeatures: null,
      previousResolved: {
        mouthOpen: 0,
        mouthForm: 0
      }
    };
  }

  function getBandEnergy(buffer, sampleRate, minHz, maxHz) {
    if (!buffer || !buffer.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return 0;
    }

    const nyquist = sampleRate / 2;
    const minIndex = clamp(Math.floor((minHz / nyquist) * buffer.length), 0, buffer.length - 1);
    const maxIndex = clamp(Math.ceil((maxHz / nyquist) * buffer.length), minIndex + 1, buffer.length);
    let sum = 0;
    let count = 0;
    for (let index = minIndex; index < maxIndex; index += 1) {
      sum += buffer[index] / 255;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }

  function extractVisemeFeatures(input = {}) {
    const frequencyBuffer = input.frequencyBuffer;
    const sampleRate = Number(input.sampleRate) || 0;
    const voiceEnergy = clamp(Number(input.voiceEnergy) || 0, 0, 1);
    const state = input.state && typeof input.state === 'object' ? input.state : null;
    const bands = input.config?.bands || DEFAULT_CONFIG.bands;

    const previousSpectrum = state?.previousSpectrum;
    const normalizedSpectrum = new Float32Array(frequencyBuffer?.length || 0);
    let spectralSum = 0;
    let weightedIndexSum = 0;
    let fluxSum = 0;
    let peakValue = 0;

    for (let index = 0; index < normalizedSpectrum.length; index += 1) {
      const normalized = (Number(frequencyBuffer[index]) || 0) / 255;
      normalizedSpectrum[index] = normalized;
      spectralSum += normalized;
      weightedIndexSum += normalized * index;
      peakValue = Math.max(peakValue, normalized);
      if (previousSpectrum && previousSpectrum.length === normalizedSpectrum.length) {
        fluxSum += Math.max(0, normalized - previousSpectrum[index]);
      }
    }

    const low = getBandEnergy(frequencyBuffer, sampleRate, bands.low[0], bands.low[1]);
    const lowMid = getBandEnergy(frequencyBuffer, sampleRate, bands.lowMid[0], bands.lowMid[1]);
    const mid = getBandEnergy(frequencyBuffer, sampleRate, bands.mid[0], bands.mid[1]);
    const highMid = getBandEnergy(frequencyBuffer, sampleRate, bands.highMid[0], bands.highMid[1]);
    const high = getBandEnergy(frequencyBuffer, sampleRate, bands.high[0], bands.high[1]);

    const bandTotal = Math.max(1e-6, low + lowMid + mid + highMid + high);
    const centroidIndex = spectralSum > 1e-6 ? weightedIndexSum / spectralSum : 0;
    const centroidNorm = normalizedSpectrum.length > 1
      ? clamp(centroidIndex / (normalizedSpectrum.length - 1), 0, 1)
      : 0;
    const flux = normalizedSpectrum.length > 0
      ? clamp(fluxSum / normalizedSpectrum.length, 0, 1)
      : 0;

    const features = {
      voiceEnergy,
      centroidNorm,
      flux,
      peakValue,
      low,
      lowMid,
      mid,
      highMid,
      high,
      lowRatio: low / bandTotal,
      lowMidRatio: lowMid / bandTotal,
      midRatio: mid / bandTotal,
      highMidRatio: highMid / bandTotal,
      highRatio: high / bandTotal,
      brightness: clamp((highMid + high * 1.1) / bandTotal, 0, 1),
      presence: clamp((mid * 0.4 + highMid + high) / bandTotal, 0, 1),
      roundness: clamp((low * 1.15 + lowMid * 0.75) / bandTotal, 0, 1),
      spreadness: clamp((highMid * 1.05 + high * 0.85 + mid * 0.2) / bandTotal, 0, 1),
      opennessHint: clamp((mid * 0.9 + lowMid * 0.55 + voiceEnergy * 0.6) / bandTotal, 0, 1),
      spectralBalance: clamp((high + highMid - low - lowMid * 0.7) / bandTotal, -1, 1)
    };

    if (state) {
      state.previousSpectrum = normalizedSpectrum;
      state.lastFeatures = features;
    }

    return features;
  }

  function inferVisemeWeights(features = {}) {
    const openness = clamp(Number(features.opennessHint) || 0, 0, 1);
    const brightness = clamp(Number(features.brightness) || 0, 0, 1);
    const roundness = clamp(Number(features.roundness) || 0, 0, 1);
    const spreadness = clamp(Number(features.spreadness) || 0, 0, 1);
    const flux = clamp(Number(features.flux) || 0, 0, 1);
    const voiceEnergy = clamp(Number(features.voiceEnergy) || 0, 0, 1);
    const centroidNorm = clamp(Number(features.centroidNorm) || 0, 0, 1);
    const lowMid = Number(features.lowMid) || 0;
    const mid = Number(features.mid) || 0;
    const highMid = Number(features.highMid) || 0;
    const high = Number(features.high) || 0;
    const low = Number(features.low) || 0;

    const scores = {
      a: mid * 1.15 + lowMid * 0.72 + openness * 0.42 + voiceEnergy * 0.2 + (1 - Math.abs(features.spectralBalance || 0)) * 0.08,
      i: highMid * 1.22 + high * 0.85 + spreadness * 0.38 + centroidNorm * 0.24 + flux * 0.12,
      u: low * 1.18 + lowMid * 0.78 + roundness * 0.34 + (1 - brightness) * 0.18 + (1 - centroidNorm) * 0.12,
      e: mid * 0.9 + highMid * 0.96 + spreadness * 0.34 + centroidNorm * 0.16 + flux * 0.1,
      o: low * 1.02 + mid * 0.82 + roundness * 0.46 + openness * 0.16 + (1 - centroidNorm) * 0.14
    };

    return softmaxScores(scores);
  }

  function smoothWeights(targetWeights, runtimeState, config = {}) {
    const state = runtimeState && typeof runtimeState === 'object' ? runtimeState : createRuntimeState();
    const smoothing = config.smoothing || DEFAULT_CONFIG.smoothing;
    const currentWeights = state.smoothedWeights ? cloneWeights(state.smoothedWeights) : createNeutralWeights();
    const nextWeights = {};

    for (const name of VISEME_NAMES) {
      const target = clamp(Number(targetWeights?.[name]) || 0, 0, 1);
      const current = clamp(Number(currentWeights?.[name]) || 0, 0, 1);
      const alpha = target > current ? smoothing.attack : smoothing.release;
      nextWeights[name] = current + (target - current) * clamp(alpha, 0, 1);
    }

    state.smoothedWeights = normalizeWeights(nextWeights);
    return state.smoothedWeights;
  }

  function computeConfidence(features = {}) {
    const voiceEnergy = clamp(Number(features.voiceEnergy) || 0, 0, 1);
    const spreadness = clamp(Number(features.spreadness) || 0, 0, 1);
    const roundness = clamp(Number(features.roundness) || 0, 0, 1);
    const flux = clamp(Number(features.flux) || 0, 0, 1);
    const peakValue = clamp(Number(features.peakValue) || 0, 0, 1);
    const colorVariance = Math.abs(spreadness - roundness);

    return clamp(
      voiceEnergy * 0.5
      + colorVariance * 0.22
      + flux * 0.12
      + peakValue * 0.16,
      0,
      1
    );
  }

  function stabilizeResolvedFrame(targetFrame, runtimeState, config = {}, silent = false) {
    const state = runtimeState && typeof runtimeState === 'object' ? runtimeState : createRuntimeState();
    const settle = config.settle || DEFAULT_CONFIG.settle;
    const previous = state.previousResolved || { mouthOpen: 0, mouthForm: 0 };
    const targetOpen = clamp(Number(targetFrame?.mouthOpen) || 0, 0, 1);
    const targetForm = clamp(Number(targetFrame?.mouthForm) || 0, -1, 1);
    const openAlpha = silent
      ? clamp(settle.silenceOpenRelease, 0, 1)
      : clamp(targetOpen > previous.mouthOpen ? settle.openAttack : settle.openRelease, 0, 1);
    const formAlpha = silent
      ? clamp(settle.silenceFormRelease, 0, 1)
      : clamp(Math.abs(targetForm) > Math.abs(previous.mouthForm) ? settle.formAttack : settle.formRelease, 0, 1);
    const stabilized = {
      mouthOpen: clamp(lerp(previous.mouthOpen, targetOpen, openAlpha), 0, 1),
      mouthForm: clamp(lerp(previous.mouthForm, targetForm, formAlpha), -1, 1)
    };
    state.previousResolved = stabilized;
    return stabilized;
  }

  function deriveMouthParams(weights, features = {}, config = {}) {
    const safeWeights = normalizeWeights(weights);
    const visemeShape = config.visemeShape || DEFAULT_CONFIG.visemeShape;
    const articulationConfig = config.articulation || DEFAULT_CONFIG.articulation;
    const targets = visemeShape.targets || DEFAULT_CONFIG.visemeShape.targets;
    const shapedWeights = sharpenWeights(safeWeights, visemeShape.sharpenPower);
    const voiceEnergy = clamp(Number(features.voiceEnergy) || 0, 0, 1);
    const opennessHint = clamp(Number(features.opennessHint) || 0, 0, 1);
    const spectralBalance = clamp(Number(features.spectralBalance) || 0, -1, 1);
    let mouthOpen = 0;
    let mouthForm = 0;

    for (const name of VISEME_NAMES) {
      const target = targets[name] || { open: 0.4, form: 0 };
      mouthOpen += shapedWeights[name] * clamp(Number(target.open) || 0, 0, 1);
      mouthForm += shapedWeights[name] * clamp(Number(target.form) || 0, -1, 1);
    }

    const articulation = clamp(
      voiceEnergy * articulationConfig.lowEnergyBias
      + opennessHint * 0.22
      + Math.abs(spectralBalance) * 0.2,
      0,
      1
    );
    const openScale = lerp(articulationConfig.minOpenScale, articulationConfig.maxOpenScale, articulation);
    const formScale = lerp(articulationConfig.minFormScale, articulationConfig.maxFormScale, articulation);
    mouthOpen = clamp(
      mouthOpen * openScale
      + voiceEnergy * 0.05
      + Math.max(0, opennessHint - 0.5) * 0.05,
      0,
      1
    );
    mouthForm = clamp(
      (mouthForm + spectralBalance * 0.04) * formScale,
      -1,
      1
    );

    return { mouthOpen, mouthForm };
  }

  function resolveVisemeFrame(input = {}) {
    const state = input.state && typeof input.state === 'object' ? input.state : createRuntimeState();
    const silenceConfig = input.config?.silence || DEFAULT_CONFIG.silence;
    const rawVoiceEnergy = clamp(Number(input.voiceEnergy) || 0, 0, 1);
    const speaking = input.speaking !== false && rawVoiceEnergy > 0;
    const fallbackOpen = clamp(Number(input.fallbackOpen) || 0, 0, 1);
    const fallbackForm = clamp(Number(input.fallbackForm) || 0, -1, 1);
    const features = extractVisemeFeatures({
      frequencyBuffer: input.frequencyBuffer,
      sampleRate: input.sampleRate,
      voiceEnergy: rawVoiceEnergy,
      state,
      config: input.config
    });
    const targetWeights = speaking ? inferVisemeWeights(features) : createNeutralWeights();
    const smoothedWeights = smoothWeights(targetWeights, state, input.config);
    const derived = deriveMouthParams(smoothedWeights, features, input.config);
    const confidence = speaking ? computeConfidence(features) : 0;
    if (rawVoiceEnergy < silenceConfig.energyThreshold || confidence < silenceConfig.confidenceThreshold) {
      state.smoothedWeights = createNeutralWeights();
      const settledSilent = stabilizeResolvedFrame({
        mouthOpen: fallbackOpen * 0.2,
        mouthForm: fallbackForm * 0.12
      }, state, input.config, true);
      return {
        confidence: 0,
        features,
        weights: state.smoothedWeights,
        dominantViseme: 'a',
        mouthOpen: settledSilent.mouthOpen,
        mouthForm: settledSilent.mouthForm
      };
    }
    const fallbackBlend = lerp(
      DEFAULT_CONFIG.fallbackBlend.min,
      DEFAULT_CONFIG.fallbackBlend.max,
      confidence
    );

    const visemeBlend = lerp(
      DEFAULT_CONFIG.fallbackBlend.min,
      Math.max(DEFAULT_CONFIG.fallbackBlend.max, 0.94),
      confidence
    );

    const settledFrame = stabilizeResolvedFrame({
      mouthOpen: clamp(lerp(fallbackOpen * 0.4, derived.mouthOpen, visemeBlend), 0, 1),
      mouthForm: clamp(lerp(fallbackForm * 0.35, derived.mouthForm, visemeBlend), -1, 1)
    }, state, input.config);

    return {
      confidence,
      features,
      weights: smoothedWeights,
      dominantViseme: VISEME_NAMES.reduce((best, name) => (
        smoothedWeights[name] > smoothedWeights[best] ? name : best
      ), 'a'),
      mouthOpen: settledFrame.mouthOpen,
      mouthForm: settledFrame.mouthForm
    };
  }

  const api = {
    VISEME_NAMES,
    createRuntimeState,
    createNeutralWeights,
    extractVisemeFeatures,
    inferVisemeWeights,
    deriveMouthParams,
    resolveVisemeFrame
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.Live2DVisemeLipSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
