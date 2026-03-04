(function initRealtimeVoicePlayer(globalScope) {
  function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function decodeBase64ToBytes(base64) {
    const payload = String(base64 || '').trim();
    if (!payload) return new Uint8Array(0);
    const raw = atob(payload);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      bytes[index] = raw.charCodeAt(index);
    }
    return bytes;
  }

  function pcm16leToFloat32(inputBytes) {
    const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(0);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const output = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const lo = bytes[index * 2];
      const hi = bytes[index * 2 + 1];
      let sample = (hi << 8) | lo;
      if (sample >= 0x8000) sample -= 0x10000;
      output[index] = sample / 32768;
    }
    return output;
  }

  class RealtimeVoicePlayer {
    constructor({
      audioContext = null,
      defaultSampleRate = 24000,
      defaultPrebufferMs = 160,
      defaultIdleTimeoutMs = 8000,
      outputGain = 1
    } = {}) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (typeof AudioContextCtor !== 'function') {
        throw new Error('AudioContext is unavailable');
      }
      this.audioContext = audioContext || new AudioContextCtor();
      this.defaultSampleRate = clampNumber(defaultSampleRate, 24000, 8000, 96000);
      this.defaultPrebufferMs = clampNumber(defaultPrebufferMs, 160, 20, 4000);
      this.defaultIdleTimeoutMs = clampNumber(defaultIdleTimeoutMs, 8000, 500, 60000);

      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = clampNumber(outputGain, 1, 0, 2);
      this.analyserNode.connect(this.outputGainNode);
      this.outputGainNode.connect(this.audioContext.destination);

      this.session = null;
    }

    getAnalyserNode() {
      return this.analyserNode;
    }

    getAudioContext() {
      return this.audioContext;
    }

    isSpeaking(requestId = null) {
      const session = this.session;
      if (!session || session.ended) return false;
      if (requestId && String(requestId) !== session.requestId) return false;
      if (session.inflightCount > 0) return true;
      if (session.started && session.nextStartTime > this.audioContext.currentTime + 0.01) return true;
      return false;
    }

    async startSession({
      requestId,
      sampleRate,
      prebufferMs,
      idleTimeoutMs,
      onFirstAudio = null,
      onEnded = null,
      onError = null,
      onInterrupted = null
    } = {}) {
      const nextRequestId = String(requestId || '').trim();
      if (!nextRequestId) {
        throw new Error('requestId is required for realtime session');
      }
      this.interruptSession({ reason: 'superseded_by_new_session' });

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.session = {
        requestId: nextRequestId,
        sampleRate: clampNumber(sampleRate, this.defaultSampleRate, 8000, 96000),
        prebufferMs: clampNumber(prebufferMs, this.defaultPrebufferMs, 20, 4000),
        idleTimeoutMs: clampNumber(idleTimeoutMs, this.defaultIdleTimeoutMs, 500, 60000),
        onFirstAudio: typeof onFirstAudio === 'function' ? onFirstAudio : null,
        onEnded: typeof onEnded === 'function' ? onEnded : null,
        onError: typeof onError === 'function' ? onError : null,
        onInterrupted: typeof onInterrupted === 'function' ? onInterrupted : null,
        pendingSamples: [],
        pendingSampleCount: 0,
        inflightCount: 0,
        activeSources: new Set(),
        started: false,
        streamEnded: false,
        ended: false,
        firstAudioEmitted: false,
        idleTimer: null,
        nextStartTime: 0
      };
      this.armIdleTimer(this.session);
    }

    appendChunk({ requestId, audioBase64 = '', audioBytes = null } = {}) {
      const session = this.session;
      if (!session || session.ended) return false;
      if (requestId && String(requestId) !== session.requestId) return false;

      let bytes = null;
      if (audioBytes instanceof Uint8Array) {
        bytes = audioBytes;
      } else if (audioBytes instanceof ArrayBuffer) {
        bytes = new Uint8Array(audioBytes);
      } else if (ArrayBuffer.isView(audioBytes)) {
        bytes = new Uint8Array(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength);
      } else {
        bytes = decodeBase64ToBytes(audioBase64);
      }
      if (!bytes || bytes.byteLength < 2) return false;

      const floatChunk = pcm16leToFloat32(bytes);
      if (!floatChunk.length) return false;

      session.pendingSamples.push(floatChunk);
      session.pendingSampleCount += floatChunk.length;
      this.armIdleTimer(session);
      this.tryStartAndSchedule(session, false);
      return true;
    }

    endSession({ requestId, reason = 'completed' } = {}) {
      const session = this.session;
      if (!session || session.ended) return;
      if (requestId && String(requestId) !== session.requestId) return;
      session.streamEnded = true;
      this.clearIdleTimer(session);
      this.tryStartAndSchedule(session, true);
      this.maybeFinishEnded(session, String(reason || 'completed'));
    }

    failSession({ requestId, code = 'REALTIME_STREAM_FAILED', error = 'realtime stream failed' } = {}) {
      const session = this.session;
      if (!session || session.ended) return;
      if (requestId && String(requestId) !== session.requestId) return;
      this.finishSession(session, {
        error: {
          code: String(code || 'REALTIME_STREAM_FAILED'),
          message: String(error || 'realtime stream failed')
        }
      });
    }

    interruptSession({ reason = 'interrupted' } = {}) {
      const session = this.session;
      if (!session || session.ended) return;
      for (const source of session.activeSources) {
        try {
          source.stop();
        } catch {
          // ignore source stop errors
        }
      }
      this.finishSession(session, {
        interrupted: true,
        reason: String(reason || 'interrupted')
      });
    }

    armIdleTimer(session) {
      this.clearIdleTimer(session);
      session.idleTimer = setTimeout(() => {
        if (this.session !== session || session.ended) return;
        this.finishSession(session, {
          error: {
            code: 'REALTIME_IDLE_TIMEOUT',
            message: `realtime audio stream idle timeout after ${session.idleTimeoutMs}ms`
          }
        });
      }, session.idleTimeoutMs);
    }

    clearIdleTimer(session) {
      if (!session?.idleTimer) return;
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    tryStartAndSchedule(session, forceStart = false) {
      if (this.session !== session || session.ended) return;
      if (!session.started) {
        const pendingDurationMs = session.pendingSampleCount > 0
          ? (session.pendingSampleCount / session.sampleRate) * 1000
          : 0;
        if (!forceStart && pendingDurationMs < session.prebufferMs) {
          return;
        }
        if (session.pendingSampleCount <= 0) {
          return;
        }
        session.started = true;
        session.nextStartTime = Math.max(this.audioContext.currentTime + 0.025, this.audioContext.currentTime);
      }
      this.schedulePendingChunks(session);
    }

    schedulePendingChunks(session) {
      if (this.session !== session || session.ended || !session.started) return;
      while (session.pendingSamples.length > 0) {
        const samples = session.pendingSamples.shift();
        session.pendingSampleCount -= samples.length;
        const buffer = this.audioContext.createBuffer(1, samples.length, session.sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.analyserNode);

        const startAt = Math.max(session.nextStartTime, this.audioContext.currentTime + 0.01);
        session.nextStartTime = startAt + buffer.duration;
        session.inflightCount += 1;
        session.activeSources.add(source);
        source.onended = () => {
          if (this.session !== session || session.ended) return;
          session.inflightCount = Math.max(0, session.inflightCount - 1);
          session.activeSources.delete(source);
          this.maybeFinishEnded(session, 'completed');
        };
        source.start(startAt);

        if (!session.firstAudioEmitted) {
          session.firstAudioEmitted = true;
          try {
            session.onFirstAudio?.({
              requestId: session.requestId,
              sampleRate: session.sampleRate
            });
          } catch {
            // ignore callback errors
          }
        }
      }
    }

    maybeFinishEnded(session, reason) {
      if (this.session !== session || session.ended) return;
      if (!session.streamEnded) return;
      if (session.pendingSamples.length > 0) return;
      if (session.inflightCount > 0) return;
      this.finishSession(session, { reason: String(reason || 'completed') });
    }

    finishSession(session, { reason = 'completed', interrupted = false, error = null } = {}) {
      if (this.session !== session || session.ended) return;
      session.ended = true;
      this.clearIdleTimer(session);
      this.session = null;

      if (error) {
        try {
          session.onError?.({
            requestId: session.requestId,
            code: String(error.code || 'REALTIME_STREAM_FAILED'),
            error: String(error.message || 'realtime stream failed')
          });
        } catch {
          // ignore callback errors
        }
        return;
      }

      if (interrupted) {
        try {
          session.onInterrupted?.({
            requestId: session.requestId,
            reason: String(reason || 'interrupted')
          });
        } catch {
          // ignore callback errors
        }
        return;
      }

      try {
        session.onEnded?.({
          requestId: session.requestId,
          reason: String(reason || 'completed')
        });
      } catch {
        // ignore callback errors
      }
    }
  }

  const api = { RealtimeVoicePlayer, __internal: { decodeBase64ToBytes, pcm16leToFloat32 } };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RealtimeVoicePlayer = RealtimeVoicePlayer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
