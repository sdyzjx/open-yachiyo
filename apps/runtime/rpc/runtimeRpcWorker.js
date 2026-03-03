const { v4: uuidv4 } = require('uuid');
const { RpcErrorCode, createRpcError, createRpcResult, toRpcEvent } = require('./jsonRpc');
const { publishChainEvent } = require('../bus/chainDebug');

function normalizeInputImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const images = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const dataUrl = typeof item.data_url === 'string' ? item.data_url.trim() : '';
    if (!dataUrl) return null;
    images.push({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      mime_type: typeof item.mime_type === 'string' ? item.mime_type.trim() : '',
      size_bytes: Number(item.size_bytes) || 0,
      data_url: dataUrl
    });
  }

  return images;
}

function normalizeInputAudio(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const audioRef = typeof value.audio_ref === 'string' ? value.audio_ref.trim() : '';
  const format = typeof value.format === 'string' ? value.format.trim().toLowerCase() : '';
  const lang = typeof value.lang === 'string' ? value.lang.trim().toLowerCase() : 'auto';
  const hints = Array.isArray(value.hints) ? value.hints.filter((item) => typeof item === 'string').map((s) => s.trim()).filter(Boolean) : [];

  if (!audioRef || !format) return null;
  if (!['wav', 'mp3', 'ogg', 'webm', 'm4a'].includes(format)) return null;
  if (!['zh', 'en', 'auto'].includes(lang)) return null;

  return {
    audio_ref: audioRef,
    format,
    lang,
    hints
  };
}

function extractMessageDeltaFromRuntimeEvent(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.event !== 'llm.final') return '';

  const decision = event.payload?.decision;
  if (!decision || typeof decision !== 'object') return '';
  if (decision.type !== 'final') return '';

  const preview = typeof decision.preview === 'string' ? decision.preview.trim() : '';
  return preview;
}

class RuntimeRpcWorker {
  constructor({ queue, runner, bus }) {
    this.queue = queue;
    this.runner = runner;
    this.bus = bus;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      const envelope = await this.queue.pop();
      if (!envelope || !this.running) continue;
      await this.processEnvelope(envelope);
    }
  }

  async processEnvelope(envelope) {
    const { request, context } = envelope;
    publishChainEvent(this.bus, 'worker.envelope.start', {
      request_id: request?.id ?? null,
      method: request?.method || null,
      queue_wait_ms: Math.max(0, Date.now() - Number(envelope?.accepted_at || Date.now()))
    });

    if (request.method !== 'runtime.run') {
      publishChainEvent(this.bus, 'worker.envelope.rejected', {
        request_id: request?.id ?? null,
        reason: 'method_not_found',
        method: request?.method || null
      });
      if (request.id !== undefined) {
        context.send?.(createRpcError(request.id, RpcErrorCode.METHOD_NOT_FOUND, `method not found: ${request.method}`));
      }
      return;
    }

    const params = request.params || {};
    let input = typeof params.input === 'string' ? params.input : '';
    const inputImages = normalizeInputImages(params.input_images);
    const inputAudio = normalizeInputAudio(params.input_audio);

    if (inputImages === null) {
      publishChainEvent(this.bus, 'worker.envelope.rejected', {
        request_id: request?.id ?? null,
        reason: 'invalid_input_images'
      });
      if (request.id !== undefined) {
        context.send?.(createRpcError(request.id, RpcErrorCode.INVALID_PARAMS, 'params.input_images must be an array of image objects'));
      }
      return;
    }

    if (params.input_audio !== undefined && inputAudio === null) {
      publishChainEvent(this.bus, 'worker.envelope.rejected', {
        request_id: request?.id ?? null,
        reason: 'invalid_input_audio'
      });
      if (request.id !== undefined) {
        context.send?.(createRpcError(request.id, RpcErrorCode.INVALID_PARAMS, 'params.input_audio must include audio_ref, format(wav|mp3|ogg|webm|m4a), optional lang/hints'));
      }
      return;
    }

    const sessionId = typeof params.session_id === 'string' && params.session_id
      ? params.session_id
      : `rpc-${uuidv4()}`;

    let runtimeContext = {};
    let seedMessages = [];
    try {
      const prepared = await context.buildRunContext?.({
        request,
        session_id: sessionId,
        input,
        input_images: inputImages,
        input_audio: inputAudio
      });
      if (prepared && typeof prepared === 'object' && !Array.isArray(prepared)) {
        runtimeContext = prepared;
      }
      publishChainEvent(this.bus, 'worker.context.ready', {
        request_id: request?.id ?? null,
        session_id: sessionId,
        permission_level: runtimeContext?.permission_level || null,
        workspace_root: runtimeContext?.workspace_root || null
      });
    } catch {
      // Context hooks should not break runtime execution.
      publishChainEvent(this.bus, 'worker.context.error', {
        request_id: request?.id ?? null,
        session_id: sessionId
      });
    }

    if (!input.trim() && inputAudio && typeof context.transcribeAudio === 'function') {
      publishChainEvent(this.bus, 'worker.asr.start', {
        request_id: request?.id ?? null,
        session_id: sessionId,
        format: inputAudio?.format || null
      });
      try {
        const transcribed = await context.transcribeAudio({
          request,
          session_id: sessionId,
          input_audio: inputAudio,
          runtime_context: runtimeContext
        });

        if (transcribed && typeof transcribed.text === 'string') {
          input = transcribed.text;
          runtimeContext = {
            ...runtimeContext,
            input_audio: {
              ...inputAudio,
              transcribed_text: input,
              confidence: Number(transcribed.confidence) || null
            }
          };
        }
        publishChainEvent(this.bus, 'worker.asr.completed', {
          request_id: request?.id ?? null,
          session_id: sessionId,
          transcribed_chars: input.length,
          confidence: runtimeContext?.input_audio?.confidence ?? null
        });
      } catch {
        // ASR failure should not crash worker; validation below handles empty input.
        publishChainEvent(this.bus, 'worker.asr.failed', {
          request_id: request?.id ?? null,
          session_id: sessionId
        });
      }
    }

    if (!input.trim() && inputImages.length === 0) {
      publishChainEvent(this.bus, 'worker.envelope.rejected', {
        request_id: request?.id ?? null,
        reason: 'empty_input_after_processing',
        session_id: sessionId
      });
      if (request.id !== undefined) {
        context.send?.(createRpcError(request.id, RpcErrorCode.INVALID_PARAMS, 'params.input must be non-empty string when params.input_images and params.input_audio are empty/invalid'));
      }
      return;
    }

    try {
      const prepared = await context.buildPromptMessages?.({
        request,
        session_id: sessionId,
        input,
        input_images: inputImages,
        input_audio: inputAudio,
        runtime_context: runtimeContext
      });
      if (Array.isArray(prepared)) {
        seedMessages = prepared;
      }
    } catch {
      // Context hooks should not break runtime execution.
    }

    try {
      await context.onRunStart?.({
        request,
        session_id: sessionId,
        input,
        input_images: inputImages,
        input_audio: inputAudio,
        runtime_context: runtimeContext
      });
    } catch {
      // Persistence hooks should not break runtime execution.
    }

    context.sendEvent?.(toRpcEvent('runtime.start', { session_id: sessionId, request_id: request.id ?? null }));
    publishChainEvent(this.bus, 'worker.runtime.start_sent', {
      request_id: request?.id ?? null,
      session_id: sessionId
    });

    publishChainEvent(this.bus, 'worker.runner.start', {
      request_id: request?.id ?? null,
      session_id: sessionId,
      input_chars: input.length,
      input_images: inputImages.length
    });
    const result = await this.runner.run({
      sessionId,
      input,
      inputImages,
      seedMessages,
      runtimeContext,
      onEvent: (event) => {
        this.bus.publish('runtime.event', event);
        Promise.resolve(context.onRuntimeEvent?.(event)).catch(() => {});
        context.sendEvent?.(toRpcEvent('runtime.event', event));

        const delta = extractMessageDeltaFromRuntimeEvent(event);
        if (delta) {
          context.sendEvent?.(toRpcEvent('message.delta', {
            session_id: sessionId,
            trace_id: event.trace_id || null,
            step_index: event.step_index ?? null,
            delta
          }));
        }
      }
    });

    const payload = {
      session_id: sessionId,
      output: result.output,
      trace_id: result.traceId,
      state: result.state,
      metrics: result.metrics || null
    };
    publishChainEvent(this.bus, 'worker.runner.completed', {
      request_id: request?.id ?? null,
      session_id: sessionId,
      trace_id: result.traceId,
      state: result.state,
      output_chars: String(result.output || '').length
    });

    context.sendEvent?.(toRpcEvent('runtime.final', payload));
    publishChainEvent(this.bus, 'worker.runtime.final_sent', {
      request_id: request?.id ?? null,
      session_id: sessionId,
      trace_id: result.traceId
    });

    try {
      await context.onRunFinal?.({
        request,
        session_id: sessionId,
        input,
        input_images: inputImages,
        input_audio: inputAudio,
        runtime_context: runtimeContext,
        ...payload
      });
    } catch {
      // Persistence hooks should not break runtime execution.
    }

    if (request.id !== undefined) {
      context.send?.(createRpcResult(request.id, payload));
      publishChainEvent(this.bus, 'worker.rpc.result_sent', {
        request_id: request?.id ?? null,
        session_id: sessionId,
        trace_id: result.traceId
      });
    }
  }
}

module.exports = { RuntimeRpcWorker };
