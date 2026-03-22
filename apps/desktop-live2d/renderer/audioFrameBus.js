(function initRendererAudioFrameBus(globalScope) {
  const MODE_SET = new Set(['live2d', 'waveform', 'hybrid']);
  const VISemeNames = ['a', 'i', 'u', 'e', 'o'];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeMode(mode, fallback = 'live2d') {
    const normalized = String(mode || fallback).trim().toLowerCase();
    return MODE_SET.has(normalized) ? normalized : fallback;
  }

  function normalizeNumber(value, fallback = 0, min = -Infinity, max = Infinity) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return clamp(fallback, min, max);
    }
    return clamp(parsed, min, max);
  }

  function normalizeWeights(input = {}) {
    const weights = {};
    for (const name of VISemeNames) {
      weights[name] = normalizeNumber(input?.[name], 0, 0, 1);
    }
    const total = VISemeNames.reduce((sum, name) => sum + weights[name], 0);
    if (total <= 1e-6) {
      return {
        a: 0.2,
        i: 0.2,
        u: 0.2,
        e: 0.2,
        o: 0.2
      };
    }

    const normalized = {};
    for (const name of VISemeNames) {
      normalized[name] = weights[name] / total;
    }
    return normalized;
  }

  function normalizeBandLevels(input = [], fallbackBandCount = 0) {
    const values = Array.isArray(input)
      ? input
      : ArrayBuffer.isView(input)
        ? Array.from(input)
        : [];

    if (values.length === 0 && Number.isFinite(fallbackBandCount) && fallbackBandCount > 0) {
      return Array.from({ length: Math.floor(fallbackBandCount) }, () => 0);
    }

    return values.map((value) => normalizeNumber(value, 0, 0, 1));
  }

  function normalizeSpeechFrame(frame = {}) {
    if (!isPlainObject(frame)) {
      return null;
    }

    const energy = normalizeNumber(
      Object.prototype.hasOwnProperty.call(frame, 'voiceEnergy')
        ? frame.voiceEnergy
        : frame.energy,
      0,
      0,
      1
    );

    return {
      kind: 'speech',
      speaking: frame.speaking !== false,
      energy,
      mouthOpen: normalizeNumber(frame.mouthOpen, energy * 0.62, 0, 1),
      mouthForm: normalizeNumber(frame.mouthForm, 0, -1, 1),
      confidence: normalizeNumber(frame.confidence, 0, 0, 1),
      visemeWeights: normalizeWeights(frame.visemeWeights || frame.weights || {}),
      timestamp: Number.isFinite(Number(frame.timestamp)) ? Math.max(0, Math.floor(Number(frame.timestamp))) : Date.now(),
      source: String(frame.source || 'speech')
    };
  }

  function normalizeMusicFrame(frame = {}) {
    if (!isPlainObject(frame)) {
      return null;
    }

    const bandLevels = normalizeBandLevels(
      frame.bandLevels || frame.frequencyBands || frame.spectrum || frame.bands,
      Number(frame.bandCount) || 0
    );

    return {
      kind: 'music',
      playing: frame.playing !== false,
      energy: normalizeNumber(
        Object.prototype.hasOwnProperty.call(frame, 'musicEnergy')
          ? frame.musicEnergy
          : frame.energy,
        bandLevels.length > 0
          ? bandLevels.reduce((sum, value) => sum + value, 0) / bandLevels.length
          : 0,
        0,
        1
      ),
      bandLevels,
      spectrum: normalizeBandLevels(frame.spectrum || frame.frequencyData || [], bandLevels.length),
      timeDomainEnergy: normalizeNumber(frame.timeDomainEnergy, 0, 0, 1),
      timestamp: Number.isFinite(Number(frame.timestamp)) ? Math.max(0, Math.floor(Number(frame.timestamp))) : Date.now(),
      source: String(frame.source || 'music')
    };
  }

  function normalizeActionFrame(frame = {}) {
    if (!isPlainObject(frame)) {
      return null;
    }

    const type = String(frame.type || frame.actionType || 'motion').trim().toLowerCase();
    const intensity = normalizeNumber(frame.intensity, 0.35, 0, 1);
    return {
      kind: 'action',
      type: type || 'motion',
      name: String(frame.name || '').trim() || null,
      intensity,
      progress: normalizeNumber(frame.progress, 0, 0, 1),
      durationSec: normalizeNumber(frame.durationSec || frame.duration_sec, 0, 0, 120),
      queuePolicy: String(frame.queuePolicy || frame.queue_policy || '').trim().toLowerCase() || null,
      timestamp: Number.isFinite(Number(frame.timestamp)) ? Math.max(0, Math.floor(Number(frame.timestamp))) : Date.now()
    };
  }

  class RendererAudioFrameBus {
    constructor({ mode = 'live2d' } = {}) {
      this.mode = normalizeMode(mode);
      this.speechFrame = null;
      this.musicFrame = null;
      this.actionFrame = null;
      this.listeners = new Set();
    }

    emit() {
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch {
          // ignore observer errors
        }
      }
      return snapshot;
    }

    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }

    setMode(mode) {
      const nextMode = normalizeMode(mode, this.mode);
      if (nextMode !== this.mode) {
        this.mode = nextMode;
        this.emit();
      }
      return this.mode;
    }

    setSpeechFrame(frame) {
      this.speechFrame = normalizeSpeechFrame(frame);
      return this.emit();
    }

    setMusicFrame(frame) {
      this.musicFrame = normalizeMusicFrame(frame);
      return this.emit();
    }

    setActionFrame(frame) {
      this.actionFrame = normalizeActionFrame(frame);
      return this.emit();
    }

    snapshot() {
      return {
        mode: this.mode,
        speechFrame: this.speechFrame ? { ...this.speechFrame, visemeWeights: { ...this.speechFrame.visemeWeights } } : null,
        musicFrame: this.musicFrame ? { ...this.musicFrame, bandLevels: [...this.musicFrame.bandLevels], spectrum: [...this.musicFrame.spectrum] } : null,
        actionFrame: this.actionFrame ? { ...this.actionFrame } : null
      };
    }
  }

  function createRendererAudioFrameBus(options = {}) {
    return new RendererAudioFrameBus(options);
  }

  const api = {
    MODE_SET,
    normalizeMode,
    normalizeSpeechFrame,
    normalizeMusicFrame,
    normalizeActionFrame,
    RendererAudioFrameBus,
    createRendererAudioFrameBus
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererAudioFrameBus = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
