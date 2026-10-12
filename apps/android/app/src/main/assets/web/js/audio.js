/*
 * Voice playback (task 6): voice.play (fetch + decode) and voice.stream.* (PCM, via the desktop
 * RealtimeVoicePlayer). Both feed the lipsync driver and send playback receipts on the hub.
 */
(function (global) {
  'use strict';

  function createVoice({ bridge, lipsync, getConfig, log = () => {} }) {
    let ctx = null;
    let analyser = null;
    let gain = null;
    let current = null;       // { kind, requestId, source?, abort? }
    let realtime = null;

    function ensureContext() {
      if (!ctx) {
        const Ctor = global.AudioContext || global.webkitAudioContext;
        ctx = new Ctor();
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
    function unlock() {
      try { ensureContext(); if (ctx.state === 'suspended') ctx.resume(); } catch (err) { log('warn', `audio unlock: ${err.message}`); }
    }

    function receipt(kind, requestId) { bridge.publish(`voice.playback.${kind}`, { request_id: requestId }); }

    function absolute(url) {
      const cfg = getConfig().server || {};
      let u = url;
      if (/^(blob|data):/i.test(u)) return u;
      if (!/^https?:/i.test(u)) u = `http://${cfg.host}:${cfg.port}${u.startsWith('/') ? '' : '/'}${u}`;
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
        if (ctx.state === 'suspended') await ctx.resume();
        const res = await fetch(absolute(url), { signal: entry.abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
        if (entry.aborted) return;
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(analyser);
        entry.source = source;
        let speaking = true;
        source.onended = () => { speaking = false; finish(entry, 'completed'); };
        lipsync.start({ analyser, audioContext: ctx, isSpeaking: () => speaking });
        source.start();
        receipt('started', entry.requestId);
      } catch (err) {
        if (!entry.aborted) { log('warn', `voice.play failed: ${err.message}`); finish(entry, 'error'); }
      }
    }

    async function streamStart({ request_id: requestId, sample_rate: sampleRate }) {
      stop('superseded');
      ensureContext();
      if (!realtime) realtime = new global.RealtimeVoicePlayer({ audioContext: ctx, outputGain: gain.gain.value });
      const entry = { kind: 'stream', requestId: requestId || `s${Date.now()}` };
      current = entry;
      const end = (reason) => { if (current === entry) { current = null; lipsync.stop(); receipt('ended', entry.requestId); log('info', `stream ${entry.requestId} ${reason}`); } };
      await realtime.startSession({
        requestId: entry.requestId,
        sampleRate,
        onFirstAudio: () => { receipt('started', entry.requestId); },
        onEnded: () => end('ended'),
        onError: (e) => end(`error ${e.error}`),
        onInterrupted: () => end('interrupted')
      });
      lipsync.start({ analyser: realtime.getAnalyserNode(), audioContext: ctx, isSpeaking: () => realtime.isSpeaking(entry.requestId) });
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

  global.YachiyoVoice = { createVoice };
})(window);
