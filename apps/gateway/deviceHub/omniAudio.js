const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const { allocateToolName } = require('../../runtime/agent-pi/toolBridge');
const { buildRecentContextMessages } = require('../../runtime/session/contextBuilder');

const REALTIME_TTS_TOOL = 'voice.tts_aliyun_vc';

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

function buildRealtimeTools(executor) {
  const names = new Map();
  const tools = [];
  for (const definition of executor?.listTools?.() || []) {
    if (!definition?.name || definition.name === REALTIME_TTS_TOOL) continue;
    const onlineName = allocateToolName(definition.name, names);
    tools.push({
      type: 'function',
      function: {
        name: onlineName,
        description: definition.description || definition.name,
        parameters: definition.input_schema || { type: 'object', properties: {}, additionalProperties: true }
      }
    });
  }
  return { tools, names };
}

function baseRealtimeInstructions() {
  return [
    'You are Yachiyo, a realtime voice agent running on the user\'s own computer.',
    'Reply naturally and concisely in the user\'s language.',
    'Use registered tools whenever the request needs computer access, current local state, or an external action.',
    'Tool calls, visible text, and native audio are independent channels. A tool call never replaces the final answer.',
    'After receiving tool output, continue the same answer using the result.',
    'Native realtime audio already uses Yachiyo\'s cloned voice. Never request a second TTS playback.'
  ].join(' ');
}

function historyPrompt(messages) {
  if (!messages.length) return '';
  return `Recent conversation:\n${messages.map((message) => `${message.role}: ${message.content}`).join('\n')}`;
}

function createOmniAudioService({
  hub,
  llmManager,
  executor = null,
  bus = null,
  sessionStore = null,
  resolvePersonaContext = null,
  resolveSkillsContext = null,
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

  async function buildInstructions({ sessionId, input }) {
    const [persona, skills, session] = await Promise.all([
      resolvePersonaContext?.({ sessionId, input }),
      resolveSkillsContext?.({ sessionId, input }),
      sessionStore?.getSession?.(sessionId)
    ]);
    const recent = buildRecentContextMessages(session, { maxMessages: 10, maxChars: 8000 });
    return [baseRealtimeInstructions(), persona?.prompt, skills?.prompt, historyPrompt(recent)].filter(Boolean).join('\n\n');
  }

  function startRealtime({ device, streamId, modelRef }) {
    const descriptor = resolve(modelRef, 'realtime');
    const sessionId = `device-${device.device_id}`;
    const requestId = `omni-${randomUUID()}`;
    const { tools, names } = buildRealtimeTools(executor);
    const pending = [];
    const toolPromises = new Set();
    let ready = false;
    let inputCommitted = false;
    let awaitingInstructionUpdate = false;
    let startedAudio = false;
    let textOutput = '';
    let audioTranscript = '';
    let visibleTextChannel = null;
    let transcript = '';
    let responseDone = false;
    let responseHadTools = false;
    let continuationSent = false;
    let settled = false;
    let timer;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolvePromise, rejectPromise) => { resolveDone = resolvePromise; rejectDone = rejectPromise; });
    done.catch(() => {});
    const ws = new WebSocketImpl(realtimeUrl(descriptor), { headers: { Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers } });
    const sendNow = (event) => ws.send(JSON.stringify(event));
    const send = (event) => { if (!ready) pending.push(event); else sendNow(event); };
    const publish = (topic, data) => hub.publish(topic, data, { target: device.device_id, direct: true });
    const publishTool = (topic, payload) => bus?.publish(topic, { session_id: sessionId, trace_id: requestId, ...payload });
    const finalOutput = () => (textOutput.trim() || audioTranscript.trim());
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (startedAudio) publish(error ? 'voice.stream.error' : 'voice.stream.end', {
        request_id: requestId, ...(error ? { message: error.message } : {})
      });
      try { ws.close(); } catch { /* already closed */ }
      if (error) rejectDone(error);
      else resolveDone({ text: transcript.trim(), output: finalOutput(), route: 'native' });
    };
    const continueAfterTools = () => {
      if (!responseDone || !responseHadTools || toolPromises.size || continuationSent || settled) return;
      continuationSent = true;
      responseDone = false;
      responseHadTools = false;
      sendNow({ type: 'response.create' });
    };
    const executeTool = (event) => {
      responseHadTools = true;
      const callId = String(event.call_id || event.item_id || randomUUID());
      const originalName = names.get(String(event.name || ''));
      const execution = (async () => {
        let result;
        let args = {};
        try {
          if (!originalName) throw new Error(`Unknown realtime tool: ${event.name || ''}`);
          args = event.arguments ? JSON.parse(event.arguments) : {};
          const settings = await sessionStore?.getSessionSettings?.(sessionId);
          const common = { call_id: callId, name: originalName, args };
          publishTool('tool.call', common);
          publishTool('tool_call.started', common);
          result = await executor.execute({ name: originalName, args }, {
            permission_level: settings?.permission_level || 'high',
            workspaceRoot: settings?.workspace?.root_dir || process.cwd(),
            meta: { session_id: sessionId, trace_id: requestId, call_id: callId, permission_level: settings?.permission_level || 'high' },
            bus,
            publishEvent: (topic, payload = {}) => bus?.publish(topic, {
              ...payload, session_id: sessionId, trace_id: requestId, call_id: callId, tool_name: originalName
            })
          });
        } catch (error) {
          result = { ok: false, code: error.code || 'INVALID_TOOL_CALL', error: error.message || String(error) };
        }
        const output = JSON.stringify(result?.ok
          ? { ok: true, result: result.result }
          : { ok: false, code: result?.code || 'TOOL_ERROR', error: result?.error || 'Tool execution failed', details: result?.details || null });
        sendNow({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
        const payload = { call_id: callId, name: originalName || String(event.name || ''), args, ok: Boolean(result?.ok), result: result?.result, error: result?.error, code: result?.code };
        publishTool('tool.result', payload);
        publishTool(result?.ok ? 'tool_call.completed' : 'tool_call.failed', payload);
      })();
      toolPromises.add(execution);
      execution.catch((error) => finish(error)).finally(() => { toolPromises.delete(execution); continueAfterTools(); });
    };
    const updateInstructions = async () => {
      try {
        await sessionStore?.appendMessage?.(sessionId, { role: 'user', content: transcript, trace_id: requestId, metadata: { input_type: 'voice', model_ref: modelRef } });
        const instructions = await buildInstructions({ sessionId, input: transcript });
        awaitingInstructionUpdate = true;
        send({ type: 'session.update', session: { instructions } });
      } catch (error) {
        finish(error);
      }
    };

    timer = setTimeout(() => finish(new Error('Realtime Omni timed out')), timeoutMs);
    ws.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'session.created') {
        sendNow({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'], instructions: baseRealtimeInstructions(), tools, tool_choice: 'auto', turn_detection: null,
            input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
            audio: {
              input: { format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } },
              output: { voice: descriptor.realtime_voice || 'Tina', format: { type: 'pcm', sample_rate: 24000 } }
            }
          }
        });
      } else if (event.type === 'session.updated') {
        if (!ready) {
          ready = true;
          for (const item of pending.splice(0)) sendNow(item);
        } else if (awaitingInstructionUpdate) {
          awaitingInstructionUpdate = false;
          sendNow({ type: 'response.create' });
        }
      } else if (event.type === 'response.audio.delta' && event.delta) {
        if (!startedAudio) {
          startedAudio = true;
          publish('voice.stream.start', { request_id: requestId, sample_rate: 24000, format: 'pcm_s16le' });
        }
        publish('voice.stream.chunk', { request_id: requestId, data_b64: event.delta });
      } else if (event.type === 'response.text.delta' || event.type === 'response.audio_transcript.delta') {
        const channel = event.type === 'response.text.delta' ? 'text' : 'audio_transcript';
        const delta = String(event.delta || '');
        if (channel === 'text') textOutput += delta; else audioTranscript += delta;
        if (delta && (!visibleTextChannel || visibleTextChannel === channel)) {
          visibleTextChannel = channel;
          publish('chat.delta', { session_id: sessionId, trace_id: requestId, delta, channel });
        }
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        transcript = String(event.transcript || event.text || '').trim();
        if (!transcript) finish(configurationError('Realtime Omni returned an empty transcription'));
        else if (inputCommitted) void updateInstructions();
      } else if (event.type === 'response.function_call_arguments.done') {
        executeTool(event);
      } else if (event.type === 'response.created') {
        continuationSent = false;
      } else if (event.type === 'error') {
        finish(new Error(event.error?.message || 'Realtime Omni failed'));
      } else if (event.type === 'response.done') {
        responseDone = true;
        if (Array.isArray(event.response?.output) && event.response.output.some((item) => item?.type === 'function_call')) responseHadTools = true;
        if (responseHadTools) { continueAfterTools(); return; }
        const output = finalOutput();
        if (transcript) publish('audio.input.transcript', { stream_id: streamId, text: transcript, final: true });
        if (output) publish('chat.final', { session_id: sessionId, trace_id: requestId, output });
        void sessionStore?.appendMessage?.(sessionId, { role: 'assistant', content: output, trace_id: requestId, metadata: { output_type: 'realtime_audio_text', model_ref: modelRef } });
        finish();
      }
    });
    ws.on('error', (error) => finish(error));
    ws.on('close', () => { if (!settled) finish(new Error('Realtime Omni connection closed early')); });

    return {
      append(dataB64) { send({ type: 'input_audio_buffer.append', audio: dataB64 }); },
      finish() {
        inputCommitted = true;
        send({ type: 'input_audio_buffer.commit' });
        if (transcript) void updateInstructions();
        return done;
      },
      cancel() { finish(new Error('Realtime audio cancelled')); }
    };
  }

  function generateText({ text, modelRef, sessionId = 'default', onDelta = null, onEvent = null }) {
    const descriptor = resolve(modelRef, 'realtime');
    const traceId = `omni-text-${randomUUID()}`;
    const { tools, names } = buildRealtimeTools(executor);
    const toolPromises = new Set();
    let output = '';
    let ready = false;
    let responseDone = false;
    let responseHadTools = false;
    let continuationSent = false;
    let settled = false;
    let timer;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolvePromise, rejectPromise) => { resolveDone = resolvePromise; rejectDone = rejectPromise; });
    done.catch(() => {});
    const ws = new WebSocketImpl(realtimeUrl(descriptor), { headers: { Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers } });
    const send = (event) => ws.send(JSON.stringify(event));
    const emit = (event, payload = {}) => onEvent?.({
      event, session_id: sessionId, trace_id: traceId, step_index: 0, payload
    });
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (error) rejectDone(error);
      else resolveDone({ output: output.trim(), traceId, state: 'DONE', metrics: { transport: 'realtime' } });
    };
    const continueAfterTools = () => {
      if (!responseDone || !responseHadTools || toolPromises.size || continuationSent || settled) return;
      continuationSent = true;
      responseDone = false;
      responseHadTools = false;
      send({ type: 'response.create' });
    };
    const executeTool = (event) => {
      responseHadTools = true;
      const callId = String(event.call_id || event.item_id || randomUUID());
      const originalName = names.get(String(event.name || ''));
      const execution = (async () => {
        let result;
        let args = {};
        try {
          if (!originalName) throw new Error(`Unknown realtime tool: ${event.name || ''}`);
          args = event.arguments ? JSON.parse(event.arguments) : {};
          const settings = await sessionStore?.getSessionSettings?.(sessionId);
          const common = { call_id: callId, name: originalName, args };
          emit('tool.call', common);
          emit('tool_call.started', common);
          result = await executor.execute({ name: originalName, args }, {
            permission_level: settings?.permission_level || 'high',
            workspaceRoot: settings?.workspace?.root_dir || process.cwd(),
            meta: { session_id: sessionId, trace_id: traceId, call_id: callId, permission_level: settings?.permission_level || 'high' },
            bus,
            publishEvent: (topic, payload = {}) => bus?.publish(topic, {
              ...payload, session_id: sessionId, trace_id: traceId, call_id: callId, tool_name: originalName
            })
          });
        } catch (error) {
          result = { ok: false, code: error.code || 'INVALID_TOOL_CALL', error: error.message || String(error) };
        }
        const toolOutput = JSON.stringify(result?.ok
          ? { ok: true, result: result.result }
          : { ok: false, code: result?.code || 'TOOL_ERROR', error: result?.error || 'Tool execution failed', details: result?.details || null });
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: toolOutput } });
        const payload = { call_id: callId, name: originalName || String(event.name || ''), args, ok: Boolean(result?.ok), result: result?.result, error: result?.error, code: result?.code };
        emit('tool.result', payload);
        emit(result?.ok ? 'tool_call.completed' : 'tool_call.failed', payload);
      })();
      toolPromises.add(execution);
      execution.catch((error) => finish(error)).finally(() => { toolPromises.delete(execution); continueAfterTools(); });
    };
    timer = setTimeout(() => finish(new Error('Realtime Omni text request timed out')), timeoutMs);
    ws.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'session.created') {
        void buildInstructions({ sessionId, input: text }).then((instructions) => {
          send({ type: 'session.update', session: { modalities: ['text'], instructions, tools, tool_choice: 'auto', turn_detection: null } });
        }).catch((error) => finish(error));
      } else if (event.type === 'session.updated' && !ready) {
        ready = true;
        send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
        send({ type: 'response.create' });
      } else if (event.type === 'response.text.delta') {
        const delta = String(event.delta || '');
        output += delta;
        if (delta) onDelta?.(delta, traceId);
      } else if (event.type === 'response.function_call_arguments.done') {
        executeTool(event);
      } else if (event.type === 'response.created') {
        continuationSent = false;
      } else if (event.type === 'error') {
        finish(new Error(event.error?.message || 'Realtime Omni failed'));
      } else if (event.type === 'response.done') {
        responseDone = true;
        if (Array.isArray(event.response?.output) && event.response.output.some((item) => item?.type === 'function_call')) responseHadTools = true;
        if (responseHadTools) { continueAfterTools(); return; }
        finish();
      }
    });
    ws.on('error', (error) => finish(error));
    ws.on('close', () => { if (!settled) finish(new Error('Realtime Omni connection closed early')); });
    return done;
  }

  return { resolve, transcribe, startRealtime, generateText };
}

module.exports = {
  REALTIME_TTS_TOOL, baseRealtimeInstructions, buildRealtimeTools,
  configurationError, contentText, createOmniAudioService, realtimeUrl
};
