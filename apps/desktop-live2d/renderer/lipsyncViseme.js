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
      attack: 0.74,
      release: 0.22
    },
    fallbackBlend: {
      min: 0.28,
      max: 0.9
    },
    visemeShape: {
      sharpenPower: 1.94,
      targets: {
        a: { open: 1.0, form: 0.38 },
        i: { open: 0.24, form: 0.94 },
        u: { open: 0.36, form: -0.8 },
        e: { open: 0.52, form: 0.72 },
        o: { open: 0.8, form: -0.92 }
      }
    },
    articulation: {
      minOpenScale: 0.7,
      maxOpenScale: 1.22,
      minFormScale: 0.7,
      maxFormScale: 1.2,
      lowEnergyBias: 0.62
    },
    silence: {
      energyThreshold: 0.028,
      confidenceThreshold: 0.08,
      holdFrames: 3,
      holdDecay: 0.66,
      energyDrivenOpenFloor: 0.012,
      energyDrivenOpenScale: 1.7
    },
    transients: {
      confirmFrames: 2,
      cooldownFrames: 6,
      thresholds: {
        stopLike: 0.24,
        fricativeLike: 0.26,
        bilabialLike: 0.24
      },
      envelopes: {
        stopLike: {
          durationFrames: 7,
          openCloseAmount: 0.15,
          openReleaseAmount: 0.02,
          formAmount: 0.46
        },
        fricativeLike: {
          durationFrames: 8,
          openAmount: -0.05,
          formAmount: 0.18
        },
        bilabialLike: {
          durationFrames: 8,
          closeAmount: 0.34,
          releaseAmount: 0.08
        }
      }
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
      lowSignalFrames: 0,
      lastResolvedFrame: null,
      transientDetector: {
        candidateKind: null,
        candidateFrames: 0,
        cooldownFrames: 0,
        activeEvent: null
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
    const openMidBias = Math.max(0, mid - low);
    const openHighBias = Math.max(0, mid - lowMid);

    const scores = {
      a: mid * 1.22 + lowMid * 0.24 + openness * 0.38 + voiceEnergy * 0.2 + (1 - brightness) * 0.08 + openMidBias * 0.26 + openHighBias * 0.1 - roundness * 0.1,
      i: high * 1.16 + highMid * 0.76 + spreadness * 0.32 + brightness * 0.16 + centroidNorm * 0.18 + flux * 0.08 - openness * 0.04,
      u: low * 0.56 + lowMid * 1.12 + mid * 0.48 + roundness * 0.3 + openness * 0.08 + (1 - brightness) * 0.12 + (1 - centroidNorm) * 0.06,
      e: high * 0.56 + highMid * 1.14 + mid * 0.52 + spreadness * 0.18 + brightness * 0.04 + openness * 0.18 + flux * 0.08,
      o: low * 0.34 + mid * 1.02 + lowMid * 0.32 + openness * 0.22 + roundness * 0.46 + (1 - brightness) * 0.16 + (1 - centroidNorm) * 0.1 - spreadness * 0.06
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

  function computeTransientScores(features = {}) {
    const flux = clamp(Number(features.flux) || 0, 0, 1);
    const voiceEnergy = clamp(Number(features.voiceEnergy) || 0, 0, 1);
    const peakValue = clamp(Number(features.peakValue) || 0, 0, 1);
    const lowRatio = clamp(Number(features.lowRatio) || 0, 0, 1);
    const lowMidRatio = clamp(Number(features.lowMidRatio) || 0, 0, 1);
    const midRatio = clamp(Number(features.midRatio) || 0, 0, 1);
    const highMidRatio = clamp(Number(features.highMidRatio) || 0, 0, 1);
    const highRatio = clamp(Number(features.highRatio) || 0, 0, 1);
    const brightness = clamp(Number(features.brightness) || 0, 0, 1);
    const spreadness = clamp(Number(features.spreadness) || 0, 0, 1);
    const highBurst = highMidRatio * 0.65 + highRatio;
    const stopLike = clamp(
      flux * 1.55
      + midRatio * 0.72
      + lowMidRatio * 0.44
      + voiceEnergy * 0.22
      - highBurst * 0.82
      - brightness * 0.12,
      0,
      1
    );
    const fricativeLike = clamp(
      flux * 1.15
      + highBurst * 1.18
      + spreadness * 0.32
      + brightness * 0.18
      - lowRatio * 0.44,
      0,
      1
    );
    const bilabialLike = clamp(
      flux * 1.4
      + lowRatio * 0.96
      + lowMidRatio * 0.56
      + peakValue * 0.18
      - highBurst * 0.98
      - brightness * 0.18,
      0,
      1
    );
    return { stopLike, fricativeLike, bilabialLike };
  }

  function pickTransientCandidate(scores = {}, thresholds = {}) {
    const bilabialLike = Number(scores.bilabialLike) || 0;
    const stopLike = Number(scores.stopLike) || 0;
    const fricativeLike = Number(scores.fricativeLike) || 0;
    if (bilabialLike >= (thresholds.bilabialLike || 0) && bilabialLike >= stopLike * 0.88) {
      return { kind: 'bilabialLike', strength: bilabialLike };
    }
    if (fricativeLike >= (thresholds.fricativeLike || 0) && fricativeLike >= stopLike * 0.92) {
      return { kind: 'fricativeLike', strength: fricativeLike };
    }
    if (stopLike >= (thresholds.stopLike || 0)) {
      return { kind: 'stopLike', strength: stopLike };
    }
    return null;
  }

  function sampleTransientEnvelope(activeEvent, transientsConfig = {}) {
    if (!activeEvent || !activeEvent.kind) {
      return null;
    }
    const envelopes = transientsConfig.envelopes || DEFAULT_CONFIG.transients.envelopes;
    const envelope = envelopes[activeEvent.kind];
    if (!envelope) {
      return null;
    }
    const durationFrames = Math.max(1, Number(envelope.durationFrames) || 1);
    const progress = clamp((Number(activeEvent.frame) || 0) / durationFrames, 0, 1);
    const strength = clamp(Number(activeEvent.strength) || 0, 0, 1);
    if (activeEvent.kind === 'stopLike') {
      const closePhase = progress < 0.35 ? 1 - (progress / 0.35) : 0;
      const releasePhase = progress > 0.28 ? Math.sin(((progress - 0.28) / 0.72) * Math.PI) : 0;
      return {
        kind: activeEvent.kind,
        strength,
        mouthOpenDelta: clamp(
          -closePhase * envelope.openCloseAmount * strength
          + releasePhase * envelope.openReleaseAmount * strength,
          -1,
          1
        ),
        mouthFormDelta: clamp(Math.sin(progress * Math.PI) * envelope.formAmount * strength, -1, 1)
      };
    }
    if (activeEvent.kind === 'fricativeLike') {
      const intensity = Math.sin(progress * Math.PI);
      return {
        kind: activeEvent.kind,
        strength,
        mouthOpenDelta: clamp(envelope.openAmount * intensity * strength, -1, 1),
        mouthFormDelta: clamp(envelope.formAmount * intensity * strength, -1, 1)
      };
    }
    if (activeEvent.kind === 'bilabialLike') {
      const closePhase = progress < 0.45 ? 1 - (progress / 0.45) : 0;
      const releasePhase = progress >= 0.45 ? Math.sin(((progress - 0.45) / 0.55) * Math.PI) : 0;
      return {
        kind: activeEvent.kind,
        strength,
        mouthOpenDelta: clamp(
          -closePhase * envelope.closeAmount * strength
          + releasePhase * envelope.releaseAmount * strength,
          -1,
          1
        ),
        mouthFormDelta: 0
      };
    }
    return null;
  }

  function resolveTransientOverlay(state, features = {}, speaking = false, config = {}) {
    const detector = state?.transientDetector;
    if (!detector) {
      return null;
    }
    const transientsConfig = config.transients || DEFAULT_CONFIG.transients;
    const thresholds = transientsConfig.thresholds || DEFAULT_CONFIG.transients.thresholds;
    if (detector.cooldownFrames > 0) {
      detector.cooldownFrames -= 1;
    }
    if (speaking && detector.cooldownFrames <= 0) {
      const candidate = pickTransientCandidate(computeTransientScores(features), thresholds);
      if (candidate) {
        if (detector.candidateKind === candidate.kind) {
          detector.candidateFrames += 1;
        } else {
          detector.candidateKind = candidate.kind;
          detector.candidateFrames = 1;
        }
        if (detector.candidateFrames >= Math.max(1, Number(transientsConfig.confirmFrames) || 1)) {
          const durationFrames = Math.max(
            1,
            Number((transientsConfig.envelopes || DEFAULT_CONFIG.transients.envelopes)?.[candidate.kind]?.durationFrames) || 1
          );
          detector.activeEvent = {
            kind: candidate.kind,
            strength: clamp(candidate.strength, 0, 1),
            frame: 0,
            durationFrames
          };
          detector.cooldownFrames = Math.max(0, Number(transientsConfig.cooldownFrames) || 0);
          detector.candidateKind = null;
          detector.candidateFrames = 0;
        }
      } else {
        detector.candidateKind = null;
        detector.candidateFrames = 0;
      }
    } else if (!speaking) {
      detector.candidateKind = null;
      detector.candidateFrames = 0;
    }

    if (!detector.activeEvent) {
      return null;
    }
    const overlay = sampleTransientEnvelope(detector.activeEvent, transientsConfig);
    detector.activeEvent.frame += 1;
    if (detector.activeEvent.frame > detector.activeEvent.durationFrames) {
      detector.activeEvent = null;
    }
    return overlay;
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
      + opennessHint * 0.28
      + Math.abs(spectralBalance) * 0.22,
      0,
      1
    );
    const openScale = lerp(articulationConfig.minOpenScale, articulationConfig.maxOpenScale, articulation);
    const formScale = lerp(articulationConfig.minFormScale, articulationConfig.maxFormScale, articulation);
    mouthOpen = clamp(
      mouthOpen * openScale
      + voiceEnergy * 0.12
      + Math.max(0, opennessHint - 0.36) * 0.11,
      0,
      1
    );
    mouthForm = clamp(
      (mouthForm + spectralBalance * 0.08) * formScale,
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
    const consonantOverlay = resolveTransientOverlay(state, features, speaking, input.config);
    const holdFrames = Math.max(0, Number(silenceConfig.holdFrames) || 0);
    const holdDecay = clamp(Number(silenceConfig.holdDecay) || 0.82, 0, 1);
    const energyDrivenOpenFloor = clamp(Number(silenceConfig.energyDrivenOpenFloor) || 0, 0, 1);
    const energyDrivenOpenScale = Math.max(0, Number(silenceConfig.energyDrivenOpenScale) || 0);
    if (rawVoiceEnergy < silenceConfig.energyThreshold || confidence < silenceConfig.confidenceThreshold) {
      const canHoldPreviousFrame = (
        speaking
        && holdFrames > 0
        && state.lastResolvedFrame
        && state.lowSignalFrames < holdFrames
      );
      if (canHoldPreviousFrame) {
        state.lowSignalFrames += 1;
        const heldFrame = state.lastResolvedFrame;
        const decay = Math.pow(holdDecay, state.lowSignalFrames);
        return {
          confidence: clamp((Number(heldFrame.confidence) || 0) * decay, 0, 1),
          features,
          weights: normalizeWeights(heldFrame.weights || state.smoothedWeights || createNeutralWeights()),
          dominantViseme: heldFrame.dominantViseme || 'a',
          consonantOverlay,
          mouthOpen: clamp(lerp(fallbackOpen * 0.5, Number(heldFrame.mouthOpen) || 0, decay), 0, 1),
          mouthForm: clamp(lerp(fallbackForm * 0.5, Number(heldFrame.mouthForm) || 0, decay), -1, 1)
        };
      }
      const canUseEnergyDrivenFallback = speaking && rawVoiceEnergy >= Math.max(0.016, Number(silenceConfig.energyThreshold) * 0.7);
      if (canUseEnergyDrivenFallback) {
        const previousForm = Number(state.lastResolvedFrame?.mouthForm) || fallbackForm;
        const drivenOpen = clamp(
          energyDrivenOpenFloor + rawVoiceEnergy * energyDrivenOpenScale,
          0,
          0.11
        );
        const drivenForm = clamp(previousForm * 0.45, -1, 1);
        return {
          confidence: clamp(confidence * 0.6, 0, 1),
          features,
          weights: normalizeWeights(state.smoothedWeights || createNeutralWeights()),
          dominantViseme: state.lastResolvedFrame?.dominantViseme || 'a',
          consonantOverlay,
          mouthOpen: Math.max(drivenOpen, fallbackOpen * 0.18),
          mouthForm: drivenForm
        };
      }
      state.lowSignalFrames = 0;
      state.lastResolvedFrame = null;
      state.smoothedWeights = createNeutralWeights();
      return {
        confidence: 0,
        features,
        weights: state.smoothedWeights,
        dominantViseme: 'a',
        consonantOverlay,
        mouthOpen: 0,
        mouthForm: 0
      };
    }
    const visemeBlend = lerp(
      DEFAULT_CONFIG.fallbackBlend.min + 0.06,
      Math.max(DEFAULT_CONFIG.fallbackBlend.max, 0.98),
      confidence
    );
    const openVisemeBlend = speaking
      ? clamp(Math.max(0.68, visemeBlend + 0.16), 0, 1)
      : visemeBlend;
    const formVisemeBlend = speaking
      ? clamp(Math.max(0.5, visemeBlend), 0, 1)
      : visemeBlend;

    const resolvedFrame = {
      confidence,
      features,
      weights: smoothedWeights,
      dominantViseme: VISEME_NAMES.reduce((best, name) => (
        smoothedWeights[name] > smoothedWeights[best] ? name : best
      ), 'a'),
      consonantOverlay,
      mouthOpen: clamp(lerp(fallbackOpen * 0.22, derived.mouthOpen, openVisemeBlend), 0, 1),
      mouthForm: clamp(lerp(fallbackForm * 0.3, derived.mouthForm, formVisemeBlend), -1, 1)
    };
    state.lowSignalFrames = 0;
    state.lastResolvedFrame = {
      confidence: resolvedFrame.confidence,
      weights: cloneWeights(resolvedFrame.weights),
      dominantViseme: resolvedFrame.dominantViseme,
      mouthOpen: resolvedFrame.mouthOpen,
      mouthForm: resolvedFrame.mouthForm
    };
    return resolvedFrame;
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
