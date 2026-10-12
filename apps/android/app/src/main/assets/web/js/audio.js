/*
 * Voice playback (task 6): voice.play (fetch + decode) and voice.stream.* (PCM, via the desktop
 * RealtimeVoicePlayer). Both feed the lipsync driver and send playback receipts on the hub.
 */
(function (global) {
  'use strict';

  const AUDIO_RESUME_TIMEOUT_MS = 2000;
  const AUDIO_START_WATCHDOG_MS = 300;

  function createPlaybackAudioContext(Ctor) {
    if (typeof Ctor !== 'function') throw new Error('Web Audio is unavailable');
    try {
      // Android may route the default interactive context through an AAudio low-latency MMAP
      // stream. Some ROM/HAL combinations cannot start that stream; playback selects the stable
      // media path instead.
      return new Ctor({ latencyHint: 'playback' });
    } catch (_) {
      // Older WebViews do not accept AudioContextOptions.
      return new Ctor();
    }
  }

  async function ensureAudioContextRunning(audioContext, timeoutMs = AUDIO_RESUME_TIMEOUT_MS) {
    if (!audioContext) throw new Error('AudioContext is unavailable');
    if (audioContext.state === 'running') return audioContext;
    if (audioContext.state === 'closed') throw new Error('AudioContext is closed');

    let timer = null;
    try {
      await Promise.race([
        Promise.resolve().then(() => audioContext.resume()),
        new Promise((_, reject) => {
          timer = global.setTimeout(() => reject(new Error('AudioContext resume timed out')), timeoutMs);
        })
      ]);
    } finally {
      if (timer !== null) global.clearTimeout(timer);
    }
    if (audioContext.state !== 'running') {
      throw new Error(`AudioContext remained ${audioContext.state || 'unavailable'} after resume`);
    }
    return audioContext;
  }

  async function waitForAudioContextProgress(audioContext, initialTime, timeoutMs = AUDIO_START_WATCHDOG_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => global.setTimeout(resolve, 20));
      if (audioContext.state !== 'running') {
        throw new Error(`AudioContext became ${audioContext.state || 'unavailable'} while starting playback`);
      }
      if (Number(audioContext.currentTime) > Number(initialTime) + 0.005) return audioContext;
    }
    throw new Error('AudioContext clock did not advance after playback started');
  }

  function createVoice({ bridge, lipsync, getConfig, log = () => {} }) {
    const Address = global.YachiyoServerAddress;
    let ctx = null;
    let analyser = null;
    let gain = null;
    let current = null;       // { kind, requestId, source?, abort? }
    let realtime = null;

    function ensureContext() {
      if (!ctx) {
        const Ctor = global.AudioContext || global.webkitAudioContext;
        ctx = createPlaybackAudioContext(Ctor);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        gain = ctx.createGain();
        analyser.connect(gain);
        gain.connect(ctx.destination);
      }
      gain.gain.value = Math.max(0, Math.min(2, Number((getConfig().audio || {}).volume ?? 1)));
      return ctx;
    }

    // Autoplay policy: call from a user gesture (first touch).
    async function unlock() {
      try {
        ensureContext();
        await ensureAudioContextRunning(ctx);
        return true;
      } catch (err) {
        log('warn', `audio unlock: ${err.message}`);
        return false;
      }
    }

    function receipt(kind, requestId) { bridge.publish(`voice.playback.${kind}`, { request_id: requestId }); }

    function absolute(url) {
      const cfg = getConfig().server || {};
      let u = url;
      if (/^(blob|data):/i.test(u)) return u;
      if (!/^https?:/i.test(u)) u = `${Address.baseUrl('http', cfg.host, cfg.port)}${u.startsWith('/') ? '' : '/'}${u}`;
      if (cfg.token && !/[?&]token=/.test(u)) u += `${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`;
      return u;
    }

    function finish(entry, reason) {
      if (current !== entry) return;
      current = null;
      lipsync.stop();
      receipt('ended', entry.requestId);
      log('info', `voice ${entry.requestId} ended (${reason})`);
    }

    function stop(reason = 'interrupted') {
      const entry = current;
      if (!entry) return;
      if (entry.kind === 'url') {
        entry.aborted = true;
        try { if (entry.abort) entry.abort.abort(); if (entry.source) entry.source.stop(); } catch { /* already stopped */ }
        finish(entry, reason);
      } else if (realtime) {
        realtime.interruptSession({ reason });
      }
    }

    async function playUrl({ request_id: requestId, url }) {
      if (!url) return;
      stop('superseded');
      ensureContext();
      const entry = { kind: 'url', requestId: requestId || `v${Date.now()}`, abort: new AbortController(), aborted: false };
      current = entry;
      try {
        await ensureAudioContextRunning(ctx);
        const res = await fetch(absolute(url), { signal: entry.abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
        if (entry.aborted || current !== entry) return;
        await ensureAudioContextRunning(ctx);
        if (entry.aborted || current !== entry) return;
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(analyser);
        entry.source = source;
        let speaking = true;
        source.onended = () => { speaking = false; finish(entry, 'completed'); };
        lipsync.start({ analyser, audioContext: ctx, isSpeaking: () => speaking });
        const initialTime = Number(ctx.currentTime) || 0;
        source.start();
        await waitForAudioContextProgress(ctx, initialTime);
        if (entry.aborted || current !== entry || !speaking) return;
        receipt('started', entry.requestId);
      } catch (err) {
        if (!entry.aborted) {
          log('warn', `voice.play failed: ${err.message}`);
          try { if (entry.source) entry.source.stop(); } catch { /* already stopped */ }
          finish(entry, 'error');
        }
      }
    }

    async function streamStart({ request_id: requestId, sample_rate: sampleRate }) {
      stop('superseded');
      ensureContext();
      const entry = { kind: 'stream', requestId: requestId || `s${Date.now()}` };
      current = entry;
      const end = (reason) => { if (current === entry) { current = null; lipsync.stop(); receipt('ended', entry.requestId); log('info', `stream ${entry.requestId} ${reason}`); } };
      try {
        await ensureAudioContextRunning(ctx);
        if (current !== entry) return;
        if (!realtime) realtime = new global.RealtimeVoicePlayer({ audioContext: ctx, outputGain: gain.gain.value });
        await realtime.startSession({
          requestId: entry.requestId,
          sampleRate,
          onFirstAudio: () => {
            if (current !== entry) return;
            const initialTime = Number(ctx.currentTime) || 0;
            waitForAudioContextProgress(ctx, initialTime).then(() => {
              if (current === entry) receipt('started', entry.requestId);
            }).catch((err) => {
              if (current !== entry) return;
              log('warn', `stream playback failed: ${err.message}`);
              realtime.interruptSession({ reason: 'audio context unavailable' });
            });
          },
          onEnded: () => end('ended'),
          onError: (e) => end(`error ${e.error}`),
          onInterrupted: () => end('interrupted')
        });
        if (current !== entry) return;
        lipsync.start({ analyser: realtime.getAnalyserNode(), audioContext: ctx, isSpeaking: () => realtime.isSpeaking(entry.requestId) });
      } catch (err) {
        end(`error ${err.message}`);
        throw err;
      }
    }

    const offs = [
      bridge.subscribe('voice.play', (d) => { playUrl(d || {}); }),
      bridge.subscribe('voice.stream.start', (d) => { streamStart(d || {}).catch((e) => log('warn', `stream start: ${e.message}`)); }),
      bridge.subscribe('voice.stream.chunk', (d) => { if (realtime && d) realtime.appendChunk({ requestId: d.request_id, audioBase64: d.data_b64 }); }),
      bridge.subscribe('voice.stream.end', (d) => { if (realtime && d) realtime.endSession({ requestId: d.request_id }); }),
      bridge.subscribe('voice.stream.error', (d) => { if (realtime && d) realtime.failSession({ requestId: d.request_id, error: d.message || 'stream error' }); })
    ];

    return { unlock, stop, playUrl, get speaking() { return !!current; }, dispose() { offs.forEach((f) => f()); stop('dispose'); } };
  }

  global.YachiyoVoice = {
    createVoice,
    createPlaybackAudioContext,
    ensureAudioContextRunning,
    waitForAudioContextProgress
  };
})(window);
