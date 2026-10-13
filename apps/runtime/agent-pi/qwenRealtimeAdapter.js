const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const WebSocket = require('ws');

const QWEN_REALTIME_API = 'qwen-realtime';

function realtimeUrl(descriptor) {
  let base;
  try {
    base = new URL(descriptor.realtime_url || descriptor.base_url);
  } catch {
    const error = new Error('Realtime Omni requires a valid workspace WebSocket URL');
    error.code = -32602;
    throw error;
  }
  if (!base.hostname.endsWith('.maas.aliyuncs.com')) {
    const error = new Error('Realtime Omni requires a workspace-specific Model Studio URL (*.maas.aliyuncs.com)');
    error.code = -32602;
    throw error;
  }
  if (descriptor.realtime_url && base.protocol !== 'wss:') {
    const error = new Error('Realtime Omni WebSocket URL must use wss://');
    error.code = -32602;
    throw error;
  }
  base.protocol = 'wss:';
  base.pathname = '/api-ws/v1/realtime';
  base.search = '';
  base.searchParams.set('model', descriptor.id);
  return base.toString();
}

function emptyUsage() {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter((part) => part?.type === 'text').map((part) => part.text || '').join('');
}

function wavPcm(audioRef) {
  const buffer = fs.readFileSync(audioRef);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Realtime audio input must be a PCM WAV file');
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) throw new Error('Realtime WAV chunk is truncated');
    if (name === 'fmt ' && size >= 16) {
      format = {
        encoding: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14)
      };
    }
    if (name === 'data') data = buffer.subarray(start, end);
    offset = end + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 16000
    || format.bits !== 16 || !data?.length) {
    throw new Error('Realtime audio input must be 16 kHz mono PCM s16le');
  }
  return data.toString('base64');
}

function replayContext(messages, { loadAudio = wavPcm, audioAlreadySent = () => false } = {}) {
  let instructions = '';
  const tools = new Map();
  const events = [];
  const audioMarkers = [];
  const sourceMessages = messages || [];
  let latestAudioIndex = -1;
  for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
    if (sourceMessages[index]?.role === 'user' && sourceMessages[index]?.yachiyoInputAudio?.audio_ref) {
      latestAudioIndex = index;
      break;
    }
  }
  for (const [index, message] of sourceMessages.entries()) {
    if (message.role === 'system') {
      const sections = Object.values(message.sections || {}).filter(Boolean).join('\n\n');
      instructions = [instructions, textOf(message.content), sections].filter(Boolean).join('\n\n');
      for (const tool of message.toolsAdded || []) tools.set(tool.name, tool);
      for (const tool of message.toolsRemoved || []) tools.delete(tool.name);
      continue;
    }
    if (message.role === 'user') {
      const audio = message.yachiyoInputAudio;
      if (audio?.audio_ref && index === latestAudioIndex && !audioAlreadySent(audio)) {
        events.push({
          type: 'conversation.item.create',
          item: {
            type: 'message', role: 'user',
            content: [{ type: 'input_audio', audio: loadAudio(audio.audio_ref) }]
          }
        });
        audioMarkers.push(audio);
        continue;
      }
      let text = String(audio?.transcribed_text || textOf(message.content) || '').trim();
      if (audio?.audio_ref && (!text || text === '[实时语音输入]')) text = '[历史语音消息]';
      if (text) events.push({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
      });
      continue;
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content);
      if (text) events.push({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
      });
      for (const call of message.content || []) {
        if (call?.type !== 'toolCall') continue;
        events.push({
          type: 'conversation.item.create',
          item: { type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments || {}) }
        });
      }
      continue;
    }
    if (message.role === 'toolResult') {
      events.push({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: message.toolCallId, output: textOf(message.content) }
      });
    }
  }
  return {
    instructions,
    tools: [...tools.values()].map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description || tool.name, parameters: tool.parameters || {} }
    })),
    events,
    audioMarkers
  };
}

function createPartial(model) {
  return {
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: emptyUsage(), stopReason: 'pending', timestamp: Date.now()
  };
}

function applyUsage(partial, usage = {}) {
  const input = Number(usage.input_tokens ?? usage.input ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.output ?? 0) || 0;
  partial.usage = { ...emptyUsage(), input, output, totalTokens: Number(usage.total_tokens) || input + output };
}

function createQwenRealtimeStream({ ai, descriptor, model, context, options = {}, WebSocketImpl = WebSocket,
  onAudio = null, onInputTranscript = null, loadAudio, audioAlreadySent, markAudioSent }) {
  const stream = ai.createAssistantMessageEventStream();
  const partial = createPartial(model);
  let prepared;
  try {
    prepared = replayContext(context.messages, { loadAudio, audioAlreadySent });
  } catch (error) {
    const failed = ai.createAssistantMessageEventStream();
    const message = createPartial(model);
    message.stopReason = 'error';
    message.errorMessage = error.message;
    queueMicrotask(() => {
      failed.push({ type: 'error', reason: 'error', error: message });
      failed.end();
    });
    return failed;
  }
  if (descriptor.realtime_output === 'native') {
    prepared.tools = prepared.tools.filter((tool) => !/^voice(?:__|\.)tts_aliyun_vc$/.test(tool.function.name));
    prepared.instructions = [
      prepared.instructions,
      'This realtime response already has Yachiyo native audio. Never call a TTS tool; use the native audio channel for spoken output.'
    ].filter(Boolean).join('\n\n');
  }
  const requestId = `qwen-rt-${randomUUID()}`;
  let ws;
  let textStarted = false;
  let visibleChannel = null;
  let terminal = false;
  let audioStarted = false;

  const pushText = (channel, delta) => {
    if (!delta || (visibleChannel && visibleChannel !== channel)) return;
    visibleChannel ||= channel;
    if (!textStarted) {
      textStarted = true;
      partial.content.push({ type: 'text', text: '' });
      stream.push({ type: 'text_start', contentIndex: 0, partial });
    }
    partial.content[0].text += delta;
    stream.push({ type: 'text_delta', contentIndex: 0, delta, partial });
  };
  const finishText = () => {
    if (textStarted) stream.push({ type: 'text_end', contentIndex: 0, content: partial.content[0].text, partial });
  };
  const finishAudio = (error) => {
    if (!audioStarted || !onAudio) return;
    onAudio({
      sessionId: options.sessionId, requestId,
      topic: error ? 'voice.stream.error' : 'voice.stream.end',
      data: error ? { message: error.message } : {}
    });
  };
  const fail = (error) => {
    if (terminal) return;
    terminal = true;
    partial.stopReason = options.signal?.aborted ? 'aborted' : 'error';
    partial.errorMessage = String(error?.message || error);
    finishAudio(error instanceof Error ? error : new Error(partial.errorMessage));
    stream.push({ type: 'error', reason: partial.stopReason, error: partial });
    try { ws?.close(); } catch { /* already closed */ }
    stream.end();
  };

  stream.push({ type: 'start', partial });
  try {
    ws = new WebSocketImpl(realtimeUrl(descriptor), {
      headers: { Authorization: `Bearer ${options.apiKey || descriptor.api_key}`, ...descriptor.headers, ...options.headers }
    });
  } catch (error) {
    queueMicrotask(() => fail(error));
    return stream;
  }

  const abort = () => fail(options.signal?.reason || new Error('Realtime request aborted'));
  options.signal?.addEventListener('abort', abort, { once: true });
  ws.on('message', (raw) => {
    if (terminal) return;
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }
    if (event.type === 'session.created') {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: descriptor.realtime_output === 'native' ? ['text', 'audio'] : ['text'],
          instructions: prepared.instructions,
          tools: prepared.tools,
          tool_choice: prepared.tools.length ? 'auto' : 'none',
          turn_detection: null,
          input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
          audio: {
            input: {
              format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1,
                packing: 'interleaved', channel_layout: 'mono' }
            },
            ...(descriptor.realtime_output === 'native'
              ? { output: { voice: descriptor.realtime_voice || 'Tina', format: { type: 'pcm', sample_rate: 24000 } } }
              : {})
          },
        }
      }));
      return;
    }
    if (event.type === 'session.updated') {
      for (const item of prepared.events) ws.send(JSON.stringify(item));
      ws.send(JSON.stringify({ type: 'response.create' }));
      return;
    }
    if (event.type === 'response.text.delta') {
      pushText('text', String(event.delta || ''));
      return;
    }
    if (event.type === 'response.audio_transcript.delta') {
      pushText('audio_transcript', String(event.delta || ''));
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(event.transcript || event.text || '').trim();
      if (text && onInputTranscript) onInputTranscript({
        sessionId: options.sessionId,
        streamId: [...(context.messages || [])].reverse().find((message) => message.yachiyoInputAudio)?.yachiyoInputAudio?.stream_id,
        text
      });
      return;
    }
    if (event.type === 'response.audio.delta' && event.delta && onAudio) {
      if (!audioStarted) {
        audioStarted = true;
        onAudio({ sessionId: options.sessionId, requestId, topic: 'voice.stream.start', data: { sample_rate: 24000, format: 'pcm_s16le' } });
      }
      onAudio({ sessionId: options.sessionId, requestId, topic: 'voice.stream.chunk', data: { data_b64: event.delta } });
      return;
    }
    if (event.type === 'response.function_call_arguments.done') {
      let args = {};
      try { args = event.arguments ? JSON.parse(event.arguments) : {}; } catch { /* Pi reports invalid arguments */ }
      const toolCall = { type: 'toolCall', id: String(event.call_id || event.item_id || randomUUID()), name: String(event.name || ''), arguments: args };
      const contentIndex = partial.content.length;
      partial.content.push(toolCall);
      stream.push({ type: 'toolcall_start', contentIndex, partial });
      stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial });
      return;
    }
    if (event.type === 'error') {
      fail(new Error(event.error?.message || 'Realtime Omni failed'));
      return;
    }
    if (event.type === 'response.done') {
      terminal = true;
      for (const marker of prepared.audioMarkers) markAudioSent?.(marker);
      finishText();
      finishAudio();
      applyUsage(partial, event.response?.usage);
      const hasTools = partial.content.some((item) => item.type === 'toolCall');
      partial.stopReason = hasTools ? 'toolUse' : 'stop';
      stream.push({ type: 'done', reason: partial.stopReason, message: partial });
      try { ws.close(); } catch { /* already closed */ }
      stream.end();
    }
  });
  ws.on('error', fail);
  ws.on('close', (code, reason) => {
    if (terminal) return;
    const detail = String(reason || '').trim();
    fail(new Error(`Realtime Omni connection closed before response.done (code=${code}${detail ? `, reason=${detail}` : ''})`));
  });
  return stream;
}

module.exports = { QWEN_REALTIME_API, createQwenRealtimeStream, realtimeUrl, replayContext, wavPcm };
