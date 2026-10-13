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
  const transcribedText = typeof value.transcribed_text === 'string' ? value.transcribed_text.trim() : '';
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : null;
  const segments = Array.isArray(value.segments) ? value.segments : [];
  const streamId = typeof value.stream_id === 'string' ? value.stream_id.trim() : '';

  if (!audioRef || !format) return null;
  if (!['wav', 'mp3', 'ogg', 'webm', 'm4a'].includes(format)) return null;
  if (!['zh', 'en', 'auto'].includes(lang)) return null;

  return {
    audio_ref: audioRef,
    format,
    lang,
    hints,
    transcribed_text: transcribedText,
    confidence,
    segments,
    ...(streamId ? { stream_id: streamId } : {})
  };
}

function extractMessageDeltaFromRuntimeEvent(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.event === 'llm.stream.delta') {
    const delta = typeof event.payload?.delta === 'string' ? event.payload.delta : '';
    return delta.trim() ? delta : '';
  }
  if (event.event !== 'llm.final') return '';
  if (event.payload?.streamed === true) return '';

  const decision = event.payload?.decision;
  if (!decision || typeof decision !== 'object') return '';
  if (decision.type !== 'final') return '';

  const preview = typeof decision.preview === 'string' ? decision.preview.trim() : '';
  return preview;
}

function extractToolCallEventFromRuntimeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const eventType = String(event.event || '');
  if (!eventType.startsWith('tool_call.')) return null;
  return {
    session_id: event.session_id || null,
    trace_id: event.trace_id || null,
    step_index: event.step_index ?? null,
    seq: event.seq ?? null,
    type: eventType,
    payload: event.payload || {}
  };
}

function shouldPublishRuntimeEventToDebugBus(event) {
  const eventType = String(event?.event || '');
  if (!eventType) return true;
  if (eventType.startsWith('llm.stream.')) return false;
  if (eventType.startsWith('tool_call.')) return false;
  return true;
}

class RuntimeRpcWorker {
  constructor({ queue, runner, bus, voiceRunTimeoutMs = 90000, runTimeoutMs = 180000 }) {
    this.queue = queue;
    this.runner = runner;
    this.bus = bus;
    this.running = false;
    this.activeRun = null;
    this.activeRuns = new Map();
    this.inFlight = new Set();
    this.voiceRunTimeoutMs = voiceRunTimeoutMs;
    this.runTimeoutMs = runTimeoutMs;
    this.unsubscribeSubmit = this.queue.onSubmit?.((envelope) => this.interruptForNewVoice(envelope)) || (() => {});
  }

  interruptForNewVoice(envelope) {
    if (this.runner.supportsNativeQueueing) return false;
    const request = envelope?.request;
    const params = request?.params || {};
    const sessionId = typeof params.session_id === 'string' ? params.session_id : '';
    if (request?.method !== 'runtime.run' || !params.input_audio || !sessionId) return false;
    const active = this.activeRun;
    if (!active || active.sessionId !== sessionId || active.controller.signal.aborted) return false;
    active.controller.abort({ code: 'SUPERSEDED_BY_VOICE', message: '已停止上一条任务，正在处理新的语音。' });
    return true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    this.activeRun?.controller.abort({ code: 'WORKER_STOPPED', message: '运行时已停止。' });
    for (const active of this.activeRuns.values()) {
      active.controller.abort({ code: 'WORKER_STOPPED', message: '运行时已停止。' });
    }
  }

  async loop() {
    while (this.running) {
      const envelope = await this.queue.pop();
      if (!envelope || !this.running) continue;
      if (!this.runner.supportsNativeQueueing) {
        await this.processEnvelope(envelope);
        continue;
      }
      const work = this.processEnvelope(envelope).catch((error) => {
        publishChainEvent(this.bus, 'worker.envelope.failed', {
          request_id: envelope?.request?.id ?? null,
          error: String(error?.message || error)
        });
        if (envelope?.request?.id !== undefined) {
          envelope.context?.send?.(createRpcError(envelope.request.id, RpcErrorCode.INTERNAL_ERROR, 'runtime execution failed'));
        }
      }).finally(() => this.inFlight.delete(work));
      this.inFlight.add(work);
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
    const requestedDeliveryMode = params.delivery_mode === undefined ? null : String(params.delivery_mode);
    if (requestedDeliveryMode && !['steer', 'followUp'].includes(requestedDeliveryMode)) {
      if (request.id !== undefined) {
        context.send?.(createRpcError(request.id, RpcErrorCode.INVALID_PARAMS,
          'params.delivery_mode must be steer or followUp'));
      }
      return;
    }
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

    let slashCommandResult = null;
    try {
      slashCommandResult = await context.handleSlashCommand?.({
        request,
        session_id: sessionId,
        input,
        input_images: inputImages,
        input_audio: inputAudio
      }) || null;
    } catch {
      publishChainEvent(this.bus, 'worker.slash_command.error', {
        request_id: request?.id ?? null,
        session_id: sessionId
      });
    }

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
      if (inputAudio) {
        runtimeContext = { ...runtimeContext, input_audio: { ...inputAudio } };
        if (!input.trim() && inputAudio.transcribed_text) input = inputAudio.transcribed_text;
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

    if (slashCommandResult?.handled === true) {
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

      const payload = {
        session_id: sessionId,
        output: String(slashCommandResult.output || ''),
        trace_id: slashCommandResult.trace_id || `slash-${uuidv4()}`,
        state: slashCommandResult.state || 'DONE',
        metrics: slashCommandResult.metrics || null
      };

      context.sendEvent?.(toRpcEvent('runtime.final', payload));
      publishChainEvent(this.bus, 'worker.runtime.final_sent', {
        request_id: request?.id ?? null,
        session_id: sessionId,
        trace_id: payload.trace_id,
        slash_command: true
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
          trace_id: payload.trace_id
        });
      }
      return;
    }

    if (!input.trim() && inputAudio && runtimeContext.direct_audio_to_model !== true
      && typeof context.transcribeAudio === 'function') {
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

    if (!input.trim() && inputImages.length === 0 && runtimeContext.direct_audio_to_model !== true) {
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

    // Resolve the requested/session model before persistence hooks so every
    // input record can be attributed to the model selection that reached the runner.
    const modelRef = typeof params.model_ref === 'string' && params.model_ref.trim()
      ? params.model_ref.trim()
      : (runtimeContext?.model_ref || null);
    if (modelRef) runtimeContext = { ...runtimeContext, model_ref: modelRef };

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
      input_images: inputImages.length,
      requested_model_ref: modelRef
    });
    const controller = new AbortController();
    const timeoutMs = inputAudio ? this.voiceRunTimeoutMs : this.runTimeoutMs;
    const timer = setTimeout(() => controller.abort({
      code: 'RUN_TIMEOUT',
      message: inputAudio ? '语音任务执行超时，已停止。请重试或换一种说法。' : '任务执行超时，已停止。'
    }), timeoutMs);
    const activeKey = Symbol(String(request?.id ?? 'runtime.run'));
    const activeRecord = { sessionId, requestId: request?.id ?? null, controller };
    if (this.runner.supportsNativeQueueing) this.activeRuns.set(activeKey, activeRecord);
    else this.activeRun = activeRecord;
    let result;
    try {
      result = await this.runner.run({
        sessionId,
        input,
        inputImages,
        seedMessages,
        runtimeContext,
        modelRef,
        deliveryMode: requestedDeliveryMode || (inputAudio ? 'steer' : 'followUp'),
        signal: controller.signal,
        onEvent: (event) => {
        if (shouldPublishRuntimeEventToDebugBus(event)) {
          this.bus.publish('runtime.event', event);
        }
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

        const toolCallEvent = extractToolCallEventFromRuntimeEvent(event);
        if (toolCallEvent) {
          context.sendEvent?.(toRpcEvent('tool_call.event', toolCallEvent));
        }
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      result = null;
    } finally {
      clearTimeout(timer);
      if (this.runner.supportsNativeQueueing) this.activeRuns.delete(activeKey);
      else if (this.activeRun?.controller === controller) this.activeRun = null;
    }
    if (controller.signal.aborted) {
      const reason = controller.signal.reason || {};
      result = {
        output: reason.message || '任务已停止。',
        traceId: result?.traceId || `aborted-${uuidv4()}`,
        state: 'ABORTED',
        metrics: { ...(result?.metrics || {}), aborted: true, abort_code: reason.code || 'ABORTED' }
      };
    }

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
