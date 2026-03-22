(function initRendererPresenterDebugTools(globalScope) {
  const audioFrameApi = typeof module !== 'undefined' && module.exports
    ? require('./audioFrameBus')
    : globalScope.RendererAudioFrameBus;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clamp01(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 0;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeSourceKind(value, fallback = 'speech') {
    const normalized = String(value || fallback).trim().toLowerCase();
    if (normalized === 'speech' || normalized === 'music' || normalized === 'breath') {
      return normalized;
    }
    return fallback;
  }

  function normalizeMode(value, fallback = 'waveform') {
    if (typeof audioFrameApi?.normalizeMode === 'function') {
      return audioFrameApi.normalizeMode(value, fallback);
    }
    const normalized = String(value || fallback).trim().toLowerCase();
    return ['live2d', 'waveform', 'hybrid'].includes(normalized) ? normalized : fallback;
  }

  function normalizeArray(input, fallback = []) {
    if (Array.isArray(input)) {
      return input.map((value) => clamp01(value));
    }
    if (ArrayBuffer.isView(input)) {
      return Array.from(input, (value) => clamp01(value));
    }
    return [...fallback];
  }

  function buildDefaultBands({ sourceKind = 'speech', energy = 0.8, sampleCount = 24 } = {}) {
    const count = Math.max(8, Math.min(96, Math.floor(Number(sampleCount) || 24)));
    const result = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1);
      const envelope = Math.pow(Math.sin(Math.PI * t), sourceKind === 'music' ? 0.95 : 1.35);
      const ripple = sourceKind === 'music'
        ? 0.5 + Math.sin(t * Math.PI * 5.2) * 0.28 + Math.cos(t * Math.PI * 2.1) * 0.16
        : 0.56 + Math.sin(t * Math.PI * 3.1) * 0.18;
      result[index] = clamp01(envelope * clamp01(ripple) * (0.24 + energy * 0.76));
    }
    return result;
  }

  function buildSilentBands(length) {
    return Array.from({ length: Math.max(8, Math.floor(Number(length) || 24)) }, () => 0);
  }

  function normalizeSpeechFrame(frame = {}) {
    if (typeof audioFrameApi?.normalizeSpeechFrame === 'function') {
      return audioFrameApi.normalizeSpeechFrame(frame);
    }
    return frame;
  }

  function normalizeMusicFrame(frame = {}) {
    if (typeof audioFrameApi?.normalizeMusicFrame === 'function') {
      return audioFrameApi.normalizeMusicFrame(frame);
    }
    return frame;
  }

  function normalizeActionFrame(frame = {}) {
    if (typeof audioFrameApi?.normalizeActionFrame === 'function') {
      return audioFrameApi.normalizeActionFrame(frame);
    }
    return frame;
  }

  function normalizePresenterDebugOverride(input = {}) {
    const raw = isPlainObject(input) ? input : {};
    const sourceKind = normalizeSourceKind(raw.sourceKind || raw.source || raw.kind, 'speech');
    const energy = clamp01(
      Object.prototype.hasOwnProperty.call(raw, 'energy')
        ? raw.energy
        : sourceKind === 'breath'
          ? 0
          : 0.88
    );
    const requestedBands = normalizeArray(
      raw.bandLevels || raw.bands || raw.spectrum,
      buildDefaultBands({
        sourceKind,
        energy,
        sampleCount: raw.sampleCount || raw.bandCount || 24
      })
    );
    const bandLevels = requestedBands.length > 0 ? requestedBands : buildDefaultBands({ sourceKind, energy });
    const silentBands = buildSilentBands(bandLevels.length);
    const speechVisemes = isPlainObject(raw.visemeWeights) ? raw.visemeWeights : {};
    const speechFrame = normalizeSpeechFrame({
      speaking: raw.speaking !== undefined ? raw.speaking : sourceKind === 'speech',
      energy: sourceKind === 'speech' ? energy : 0,
      mouthOpen: raw.mouthOpen !== undefined ? raw.mouthOpen : clamp01(0.22 + energy * 0.74),
      mouthForm: raw.mouthForm !== undefined ? raw.mouthForm : 0.08,
      confidence: raw.confidence !== undefined ? raw.confidence : 1,
      visemeWeights: {
        a: speechVisemes.a !== undefined ? speechVisemes.a : 0.42,
        i: speechVisemes.i !== undefined ? speechVisemes.i : 0.16,
        u: speechVisemes.u !== undefined ? speechVisemes.u : 0.08,
        e: speechVisemes.e !== undefined ? speechVisemes.e : 0.2,
        o: speechVisemes.o !== undefined ? speechVisemes.o : 0.14
      },
      source: 'debug-override'
    });
    const musicFrame = normalizeMusicFrame({
      playing: raw.playing !== undefined ? raw.playing : sourceKind === 'music',
      energy: sourceKind === 'music' ? energy : 0,
      bandLevels: sourceKind === 'music' ? bandLevels : silentBands,
      spectrum: sourceKind === 'music' ? bandLevels : silentBands,
      timeDomainEnergy: sourceKind === 'music' ? energy : 0,
      source: 'debug-override'
    });
    const actionInput = raw.action === null
      ? null
      : isPlainObject(raw.action)
        ? raw.action
        : raw.actionType || raw.intensity !== undefined || raw.progress !== undefined
          ? raw
          : null;
    const actionFrame = actionInput
      ? normalizeActionFrame({
          type: actionInput.type || actionInput.actionType || 'react',
          intensity: actionInput.intensity !== undefined ? actionInput.intensity : 0.68,
          progress: actionInput.progress !== undefined ? actionInput.progress : 0.28,
          durationSec: actionInput.durationSec !== undefined ? actionInput.durationSec : 1.6,
          name: actionInput.name || 'debug-override'
        })
      : null;

    return {
      enabled: raw.enabled !== false,
      mode: normalizeMode(raw.mode || 'waveform', 'waveform'),
      sourceKind,
      speechFrame,
      musicFrame,
      actionFrame
    };
  }

  function cloneSnapshot(snapshot = {}) {
    return {
      mode: normalizeMode(snapshot.mode || 'live2d', 'live2d'),
      speechFrame: snapshot.speechFrame
        ? {
            ...snapshot.speechFrame,
            visemeWeights: isPlainObject(snapshot.speechFrame.visemeWeights)
              ? { ...snapshot.speechFrame.visemeWeights }
              : snapshot.speechFrame.visemeWeights
          }
        : null,
      musicFrame: snapshot.musicFrame
        ? {
            ...snapshot.musicFrame,
            bandLevels: normalizeArray(snapshot.musicFrame.bandLevels),
            spectrum: normalizeArray(snapshot.musicFrame.spectrum)
          }
        : null,
      actionFrame: snapshot.actionFrame ? { ...snapshot.actionFrame } : null
    };
  }

  function applyPresenterDebugOverride(snapshot = {}, overrideInput = {}) {
    const normalized = normalizePresenterDebugOverride(overrideInput);
    if (!normalized.enabled) {
      return cloneSnapshot(snapshot);
    }
    return {
      mode: normalized.mode,
      speechFrame: normalized.speechFrame,
      musicFrame: normalized.musicFrame,
      actionFrame: normalized.actionFrame,
      debugOverride: {
        enabled: true,
        mode: normalized.mode,
        sourceKind: normalized.sourceKind
      }
    };
  }

  function toPreview(values, maxLength = 12) {
    if (!Array.isArray(values)) {
      return [];
    }
    return values.slice(0, maxLength).map((value) => Number(Number(value || 0).toFixed(4)));
  }

  function buildPresenterDebugState({
    configuredMode = 'live2d',
    busSnapshot = null,
    effectiveSnapshot = null,
    presenterSnapshot = null,
    motion = null,
    layout = null,
    siriWave = null,
    override = null
  } = {}) {
    const speechFrame = effectiveSnapshot?.speechFrame || busSnapshot?.speechFrame || null;
    const musicFrame = effectiveSnapshot?.musicFrame || busSnapshot?.musicFrame || null;
    const geometry = presenterSnapshot?.geometry || null;
    return {
      configuredMode: normalizeMode(configuredMode, 'live2d'),
      effectiveMode: normalizeMode(effectiveSnapshot?.mode || presenterSnapshot?.mode || configuredMode, 'live2d'),
      override: override ? normalizePresenterDebugOverride(override) : null,
      input: {
        sourceKind: presenterSnapshot?.sourceKind || 'breath',
        speech: speechFrame
          ? {
              speaking: Boolean(speechFrame.speaking),
              energy: Number(Number(speechFrame.energy || 0).toFixed(4)),
              mouthOpen: Number(Number(speechFrame.mouthOpen || 0).toFixed(4)),
              mouthForm: Number(Number(speechFrame.mouthForm || 0).toFixed(4))
            }
          : null,
        music: musicFrame
          ? {
              playing: Boolean(musicFrame.playing),
              energy: Number(Number(musicFrame.energy || 0).toFixed(4)),
              bandPreview: toPreview(musicFrame.bandLevels)
            }
          : null,
        action: effectiveSnapshot?.actionFrame
          ? {
              type: effectiveSnapshot.actionFrame.type || 'motion',
              intensity: Number(Number(effectiveSnapshot.actionFrame.intensity || 0).toFixed(4)),
              progress: Number(Number(effectiveSnapshot.actionFrame.progress || 0).toFixed(4))
            }
          : null
      },
      output: {
        waveformVisible: Boolean(presenterSnapshot?.waveformVisible),
        modelVisible: Boolean(presenterSnapshot?.modelVisible),
        energy: Number(Number(presenterSnapshot?.energy || 0).toFixed(4)),
        actionScale: Number(Number(presenterSnapshot?.actionScale || 0).toFixed(4)),
        bandPreview: toPreview(geometry?.bandLevels),
        motion: motion
          ? {
              amplitude: Number(Number(motion.amplitude || 0).toFixed(4)),
              speed: Number(Number(motion.speed || 0).toFixed(4)),
              opacity: Number(Number(motion.opacity || 0).toFixed(4))
            }
          : null,
        layout: layout
          ? {
              left: Number(layout.left) || 0,
              top: Number(layout.top) || 0,
              width: Number(layout.width) || 0,
              height: Number(layout.height) || 0
            }
          : null,
        siriWave: siriWave
          ? {
              available: Boolean(siriWave.available),
              diagnosis: siriWave.diagnosis || null,
              generation: Number(siriWave.generation) || 0,
              recreateCount: Number(siriWave.recreateCount) || 0,
              actual: siriWave.actual
                ? {
                    amplitude: Number(Number(siriWave.actual.amplitude || 0).toFixed(4)),
                    speed: Number(Number(siriWave.actual.speed || 0).toFixed(4))
                  }
                : null,
              target: siriWave.target
                ? {
                    amplitude: Number(Number(siriWave.target.amplitude || 0).toFixed(4)),
                    speed: Number(Number(siriWave.target.speed || 0).toFixed(4))
                  }
                : null,
              canvas: siriWave.canvas
                ? {
                    cssWidth: Number(Number(siriWave.canvas.cssWidth || 0).toFixed(2)),
                    cssHeight: Number(Number(siriWave.canvas.cssHeight || 0).toFixed(2)),
                    pixelWidth: Number(siriWave.canvas.pixelWidth) || 0,
                    pixelHeight: Number(siriWave.canvas.pixelHeight) || 0,
                    heightMax: Number(Number(siriWave.canvas.heightMax || 0).toFixed(2)),
                    verticalSpanPx: Number(siriWave.canvas.sample?.verticalSpanPx) || 0,
                    activeRows: Number(siriWave.canvas.sample?.activeRows) || 0
                  }
                : null,
              curves: siriWave.curves
                ? {
                    clusterCount: Number(siriWave.curves.clusterCount) || 0,
                    activeClusterCount: Number(siriWave.curves.activeClusterCount) || 0,
                    maxPrevMaxY: Number(Number(siriWave.curves.maxPrevMaxY || 0).toFixed(2))
                  }
                : null
            }
          : null
      }
    };
  }

  const api = {
    normalizePresenterDebugOverride,
    applyPresenterDebugOverride,
    buildPresenterDebugState
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererPresenterDebugTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
