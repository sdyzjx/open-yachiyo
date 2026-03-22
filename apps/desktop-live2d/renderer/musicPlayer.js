(function initRendererMusicPlayer(globalScope) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp01(value) {
    return clamp(toFiniteNumber(value, 0), 0, 1);
  }

  function normalizeBandLevels(levels, bandCount) {
    const source = Array.isArray(levels)
      ? levels
      : ArrayBuffer.isView(levels)
        ? Array.from(levels)
        : [];
    const count = Math.max(1, Math.floor(toFiniteNumber(bandCount, 16)));
    if (source.length === 0) {
      return Array.from({ length: count }, () => 0);
    }
    if (source.length === count) {
      return source.map((value) => clamp01(value));
    }
    const result = new Array(count);
    const maxIndex = source.length - 1;
    for (let index = 0; index < count; index += 1) {
      const ratio = count === 1 ? 0 : index / (count - 1);
      const scaled = ratio * maxIndex;
      const left = Math.floor(scaled);
      const right = Math.min(maxIndex, left + 1);
      const local = scaled - left;
      result[index] = clamp01(source[left] + (source[right] - source[left]) * local);
    }
    return result;
  }

  function analyzeFrequencyData(frequencyData, bandCount = 16) {
    const values = Array.isArray(frequencyData)
      ? frequencyData
      : ArrayBuffer.isView(frequencyData)
        ? Array.from(frequencyData)
        : [];

    if (values.length === 0) {
      return {
        bandLevels: normalizeBandLevels([], bandCount),
        energy: 0
      };
    }

    const energy = values.reduce((sum, value) => sum + clamp01(value / 255), 0) / values.length;
    const bandLevels = normalizeBandLevels(values.map((value) => clamp01(value / 255)), bandCount);
    return {
      bandLevels,
      energy
    };
  }

  class RendererMusicPlayer {
    constructor({
      audioContext = null,
      createAudioElement = null,
      fftSize = 2048,
      smoothingTimeConstant = 0.82,
      outputGain = 1
    } = {}) {
      const AudioContextCtor = globalScope.AudioContext || globalScope.webkitAudioContext;
      if (!audioContext && typeof AudioContextCtor !== 'function') {
        throw new Error('AudioContext is unavailable');
      }

      this.audioContext = audioContext || new AudioContextCtor();
      this.createAudioElement = typeof createAudioElement === 'function'
        ? createAudioElement
        : () => new globalScope.Audio();
      this.audioElement = this.createAudioElement();
      this.audioElement.autoplay = true;
      this.audioElement.preload = 'auto';
      this.audioElement.crossOrigin = 'anonymous';

      this.sourceNode = null;
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = Math.max(32, Math.floor(toFiniteNumber(fftSize, 2048)));
      this.analyserNode.smoothingTimeConstant = clamp01(smoothingTimeConstant);
      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = clamp01(outputGain);

      this.analyserNode.connect(this.outputGainNode);
      this.outputGainNode.connect(this.audioContext.destination);

      this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.timeDomainData = new Uint8Array(this.analyserNode.fftSize);
      this.currentSrc = '';
      this.destroyed = false;
    }

    ensureSourceNode() {
      if (this.sourceNode) {
        return this.sourceNode;
      }
      if (typeof this.audioContext.createMediaElementSource !== 'function') {
        throw new Error('createMediaElementSource is unavailable');
      }
      this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
      this.sourceNode.connect(this.analyserNode);
      return this.sourceNode;
    }

    async load({ src, loop = false, volume = 1, playbackRate = 1 } = {}) {
      if (this.destroyed) {
        throw new Error('RendererMusicPlayer is destroyed');
      }
      const nextSrc = String(src || '').trim();
      if (!nextSrc) {
        throw new Error('src is required');
      }
      this.ensureSourceNode();
      this.audioElement.loop = Boolean(loop);
      this.audioElement.volume = clamp01(volume);
      this.audioElement.playbackRate = clamp(toFiniteNumber(playbackRate, 1), 0.25, 4);
      this.audioElement.src = nextSrc;
      this.currentSrc = nextSrc;
      return { ok: true, src: nextSrc };
    }

    async play(options = {}) {
      if (options.src || options.loop !== undefined || options.volume !== undefined || options.playbackRate !== undefined) {
        await this.load(options);
      } else if (!this.currentSrc) {
        throw new Error('music src is required before play');
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      await this.audioElement.play();
      return {
        ok: true,
        playing: true,
        src: this.currentSrc
      };
    }

    pause() {
      this.audioElement.pause();
      return { ok: true, playing: false, src: this.currentSrc };
    }

    async resume() {
      if (!this.currentSrc) {
        throw new Error('music src is required before resume');
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      await this.audioElement.play();
      return { ok: true, playing: true, src: this.currentSrc };
    }

    stop() {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      return { ok: true, playing: false, src: this.currentSrc };
    }

    isPlaying() {
      return Boolean(this.audioElement && !this.audioElement.paused && !this.audioElement.ended);
    }

    sampleFrame({ bandCount = 18 } = {}) {
      const playing = this.isPlaying();
      if (!this.analyserNode || !this.frequencyData) {
        return {
          kind: 'music',
          playing,
          energy: 0,
          bandLevels: Array.from({ length: Math.max(1, Math.floor(toFiniteNumber(bandCount, 18))) }, () => 0),
          spectrum: [],
          timeDomainEnergy: 0,
          timestamp: Date.now()
        };
      }

      this.analyserNode.getByteFrequencyData(this.frequencyData);
      if (typeof this.analyserNode.getByteTimeDomainData === 'function') {
        this.analyserNode.getByteTimeDomainData(this.timeDomainData);
      }

      const { bandLevels, energy } = analyzeFrequencyData(this.frequencyData, bandCount);
      let timeDomainEnergy = 0;
      if (this.timeDomainData.length > 0) {
        let sumSquares = 0;
        for (let index = 0; index < this.timeDomainData.length; index += 1) {
          const centered = (Number(this.timeDomainData[index]) || 128) - 128;
          sumSquares += (centered * centered) / (128 * 128);
        }
        timeDomainEnergy = clamp01(Math.sqrt(sumSquares / this.timeDomainData.length));
      }

      return {
        kind: 'music',
        playing,
        energy: playing ? energy : 0,
        bandLevels,
        spectrum: Array.from(this.frequencyData, (value) => clamp01((Number(value) || 0) / 255)),
        timeDomainEnergy,
        timestamp: Date.now()
      };
    }

    destroy() {
      this.stop();
      try {
        this.audioElement.removeAttribute('src');
        this.audioElement.load?.();
      } catch {
        // ignore cleanup failures
      }
      try {
        this.sourceNode?.disconnect?.();
      } catch {
        // ignore disconnect failures
      }
      try {
        this.analyserNode?.disconnect?.();
      } catch {
        // ignore disconnect failures
      }
      try {
        this.outputGainNode?.disconnect?.();
      } catch {
        // ignore disconnect failures
      }
      this.destroyed = true;
    }
  }

  function createRendererMusicPlayer(options = {}) {
    return new RendererMusicPlayer(options);
  }

  const api = {
    RendererMusicPlayer,
    createRendererMusicPlayer,
    analyzeFrequencyData,
    normalizeBandLevels
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererMusicPlayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
