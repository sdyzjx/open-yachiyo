const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');

function contentText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('').trim();
  return '';
}

function configurationError(message) {
  const error = new Error(message);
  error.code = -32602;
  return error;
}

function realtimeUrl(descriptor) {
  let base;
  try {
    base = new URL(descriptor.realtime_url || descriptor.base_url);
  } catch {
    throw configurationError('Realtime Omni requires a valid workspace WebSocket URL');
  }
  if (!base.hostname.endsWith('.maas.aliyuncs.com')) {
    throw configurationError('Realtime Omni requires a workspace-specific Model Studio URL (*.maas.aliyuncs.com)');
  }
  if (descriptor.realtime_url && base.protocol !== 'wss:') {
    throw configurationError('Realtime Omni WebSocket URL must use wss://');
  }
  base.protocol = 'wss:';
  base.pathname = '/api-ws/v1/realtime';
  base.search = '';
  base.searchParams.set('model', descriptor.id);
  return base.toString();
}

function createOmniAudioService({ hub, llmManager, fetchImpl = (...args) => fetch(...args), WebSocketImpl = WebSocket, timeoutMs = 120000 }) {
  const resolve = (modelRef, mode) => {
    const descriptor = llmManager.getCatalog().resolve(modelRef);
    if (!descriptor) throw configurationError(`Unknown model_ref: ${modelRef}`);
    if (!descriptor.input.includes('audio')) throw configurationError(`Model ${modelRef} does not accept audio`);
    if (mode === 'realtime' && descriptor.transport !== 'realtime') throw configurationError(`Model ${modelRef} is not a realtime model`);
    if (mode === 'direct' && descriptor.transport === 'realtime') throw configurationError(`Model ${modelRef} requires realtime audio`);
    if (!descriptor.api_key) throw configurationError(`No API key for provider ${descriptor.provider}`);
    return descriptor;
  };

  async function transcribe({ wav, modelRef }) {
    const descriptor = resolve(modelRef, 'direct');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, descriptor.timeout_ms || timeoutMs));
    try {
      const response = await fetchImpl(`${descriptor.base_url}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers },
        body: JSON.stringify({
          model: descriptor.id,
          messages: [{ role: 'user', content: [
            { type: 'text', text: 'Transcribe the spoken request exactly. Return only the transcript, without labels or commentary.' },
            { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}`, format: 'wav' } }
          ] }],
          stream: false,
          ...(descriptor.extra_body || {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Omni audio request failed (${response.status}): ${String(payload?.error?.message || '').slice(0, 240)}`);
      const text = contentText(payload);
      if (!text) throw new Error('Omni audio request returned an empty transcript');
      return { text };
    } finally {
      clearTimeout(timer);
    }
  }

  function startRealtime({ device, streamId, modelRef }) {
    const descriptor = resolve(modelRef, 'realtime');
    const requestId = `omni-${randomUUID()}`;
    const pending = [];
    let ready = false;
    let startedAudio = false;
    let output = '';
    let transcript = '';
    let settled = false;
    let timer;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolvePromise, rejectPromise) => { resolveDone = resolvePromise; rejectDone = rejectPromise; });
    done.catch(() => {});
    const ws = new WebSocketImpl(realtimeUrl(descriptor), { headers: { Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers } });
    const send = (event) => {
      if (!ready) pending.push(event);
      else ws.send(JSON.stringify(event));
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (startedAudio) hub.publish(error ? 'voice.stream.error' : 'voice.stream.end', {
        request_id: requestId,
        ...(error ? { message: error.message } : {})
      }, { target: device.device_id, direct: true });
      try { ws.close(); } catch { /* already closed */ }
      if (error) rejectDone(error);
      else resolveDone({ text: transcript.trim(), output: output.trim() });
    };
    timer = setTimeout(() => finish(new Error('Realtime Omni timed out')), timeoutMs);
    ws.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'session.created') {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            turn_detection: null,
            input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
            audio: {
              input: { format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } },
              output: { voice: 'Tina', format: { type: 'pcm', sample_rate: 24000 } }
            }
          }
        }));
      } else if (event.type === 'session.updated') {
        ready = true;
        for (const item of pending.splice(0)) ws.send(JSON.stringify(item));
      } else if (event.type === 'response.audio.delta' && event.delta) {
        if (!startedAudio) {
          startedAudio = true;
          hub.publish('voice.stream.start', { request_id: requestId, sample_rate: 24000, format: 'pcm_s16le' }, { target: device.device_id, direct: true });
        }
        hub.publish('voice.stream.chunk', { request_id: requestId, data_b64: event.delta }, { target: device.device_id, direct: true });
      } else if (event.type === 'response.text.delta' || event.type === 'response.audio_transcript.delta') {
        const delta = String(event.delta || '');
        if (delta) {
          output += delta;
          hub.publish('chat.delta', { session_id: `device-${device.device_id}`, trace_id: requestId, delta }, { target: device.device_id, direct: true });
        }
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        transcript = String(event.transcript || event.text || '');
      } else if (event.type === 'error') {
        finish(new Error(event.error?.message || 'Realtime Omni failed'));
      } else if (event.type === 'response.done') {
        if (transcript) hub.publish('audio.input.transcript', { stream_id: streamId, text: transcript, final: true }, { target: device.device_id, direct: true });
        if (output) hub.publish('chat.final', { session_id: `device-${device.device_id}`, trace_id: requestId, output }, { target: device.device_id, direct: true });
        finish();
      }
    });
    ws.on('error', (error) => finish(error));
    ws.on('close', () => { if (!settled) finish(new Error('Realtime Omni connection closed early')); });

    return {
      append(dataB64) { send({ type: 'input_audio_buffer.append', audio: dataB64 }); },
      finish() {
        send({ type: 'input_audio_buffer.commit' });
        send({ type: 'response.create' });
        return done;
      },
      cancel() { finish(new Error('Realtime audio cancelled')); }
    };
  }

  function generateText({ text, modelRef, onDelta = null }) {
    const descriptor = resolve(modelRef, 'realtime');
    const traceId = `omni-text-${randomUUID()}`;
    let output = '';
    let ready = false;
    let settled = false;
    let timer;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolvePromise, rejectPromise) => { resolveDone = resolvePromise; rejectDone = rejectPromise; });
    done.catch(() => {});
    const ws = new WebSocketImpl(realtimeUrl(descriptor), { headers: { Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers } });
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (error) rejectDone(error);
      else resolveDone({ output: output.trim(), traceId, state: 'DONE', metrics: { transport: 'realtime' } });
    };
    timer = setTimeout(() => finish(new Error('Realtime Omni text request timed out')), timeoutMs);
    ws.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'session.created') {
        ws.send(JSON.stringify({ type: 'session.update', session: { modalities: ['text'], turn_detection: null } }));
      } else if (event.type === 'session.updated' && !ready) {
        ready = true;
        ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
        ws.send(JSON.stringify({ type: 'response.create' }));
      } else if (event.type === 'response.text.delta') {
        const delta = String(event.delta || '');
        output += delta;
        if (delta) onDelta?.(delta, traceId);
      } else if (event.type === 'error') {
        finish(new Error(event.error?.message || 'Realtime Omni failed'));
      } else if (event.type === 'response.done') {
        finish();
      }
    });
    ws.on('error', (error) => finish(error));
    ws.on('close', () => { if (!settled) finish(new Error('Realtime Omni connection closed early')); });
    return done;
  }

  return { resolve, transcribe, startRealtime, generateText };
}

module.exports = { configurationError, contentText, createOmniAudioService, realtimeUrl };
