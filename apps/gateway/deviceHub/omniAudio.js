const WebSocket = require('ws');
const { realtimeUrl } = require('../../runtime/agent-pi/qwenRealtimeAdapter');

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

// Audio transport only: prompts, history, tools and approvals remain in Pi.
function createOmniAudioService({
  llmManager,
  fetchImpl = (...args) => fetch(...args),
  WebSocketImpl = WebSocket,
  timeoutMs = 120000
}) {
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
        method: 'POST', signal: controller.signal,
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

  function startRealtime({ modelRef }) {
    const descriptor = resolve(modelRef, 'realtime');
    const pending = [];
    let ready = false;
    let transcript = '';
    let settled = false;
    let timer;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolvePromise, rejectPromise) => {
      resolveDone = resolvePromise;
      rejectDone = rejectPromise;
    });
    done.catch(() => {});
    const ws = new WebSocketImpl(realtimeUrl(descriptor), {
      headers: { Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers }
    });
    const sendNow = (event) => ws.send(JSON.stringify(event));
    const send = (event) => { if (ready) sendNow(event); else pending.push(event); };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (error) rejectDone(error);
      else resolveDone({ text: transcript.trim(), route: 'pi' });
    };

    timer = setTimeout(() => finish(new Error('Realtime transcription timed out')), timeoutMs);
    ws.on('message', (raw) => {
      if (settled) return;
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'session.created') {
        sendNow({
          type: 'session.update',
          session: {
            modalities: ['text'],
            instructions: 'Transcribe the user audio exactly. Do not answer the request.',
            turn_detection: null,
            input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
            audio: {
              input: {
                format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' }
              }
            }
          }
        });
      } else if (event.type === 'session.updated') {
        ready = true;
        for (const item of pending.splice(0)) sendNow(item);
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        transcript = String(event.transcript || event.text || '').trim();
        if (!transcript) finish(configurationError('Realtime Omni returned an empty transcription'));
        else finish();
      } else if (event.type === 'error') {
        finish(new Error(event.error?.message || 'Realtime transcription failed'));
      }
    });
    ws.on('error', (error) => finish(error));
    ws.on('close', () => { if (!settled) finish(new Error('Realtime transcription connection closed early')); });

    return {
      append(dataB64) { send({ type: 'input_audio_buffer.append', audio: dataB64 }); },
      finish() { send({ type: 'input_audio_buffer.commit' }); return done; },
      cancel() { finish(new Error('Realtime audio cancelled')); }
    };
  }

  return { resolve, transcribe, startRealtime };
}

module.exports = { configurationError, contentText, createOmniAudioService, realtimeUrl };
