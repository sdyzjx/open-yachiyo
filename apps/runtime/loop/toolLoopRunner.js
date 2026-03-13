const fs = require('node:fs');
const { v4: uuidv4 } = require('uuid');
const Ajv = require('ajv');
const { RuntimeState, RuntimeStateMachine } = require('./stateMachine');
const { publishChainEvent } = require('../bus/chainDebug');

function isValidMessageContent(content) {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
    if (part.type === 'text') {
      return typeof part.text === 'string' && part.text.trim().length > 0;
    }
    if (part.type === 'image_url') {
      return typeof part.image_url?.url === 'string' && part.image_url.url.trim().length > 0;
    }
    return false;
  });
}

function normalizeInputImages(inputImages) {
  if (!Array.isArray(inputImages)) return [];
  return inputImages
    .filter((image) => image && typeof image === 'object' && typeof image.data_url === 'string')
    .map((image) => ({
      data_url: image.data_url.trim(),
      name: typeof image.name === 'string' ? image.name.trim() : '',
      mime_type: typeof image.mime_type === 'string' ? image.mime_type.trim() : '',
      size_bytes: Number(image.size_bytes) || 0
    }))
    .filter((image) => image.data_url.length > 0);
}

function buildCurrentUserMessage(input, inputImages = []) {
  const text = typeof input === 'string' ? input.trim() : '';
  const images = normalizeInputImages(inputImages);

  if (images.length === 0) {
    return { role: 'user', content: text };
  }

  const content = [];
  if (text) {
    content.push({ type: 'text', text });
  }

  for (const image of images) {
    content.push({
      type: 'image_url',
      image_url: { url: image.data_url }
    });
  }

  return { role: 'user', content };
}

function serializePromptContentForLog(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return content == null ? '' : String(content);
  }
  return content.map((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      return { type: 'unknown', value: String(part || '') };
    }
    if (part.type === 'text') {
      return {
        type: 'text',
        text: typeof part.text === 'string' ? part.text : String(part.text || '')
      };
    }
    if (part.type === 'image_url') {
      return {
        type: 'image_url',
        image_url: '[omitted]'
      };
    }
    return part;
  });
}

function serializePromptMessagesForLog(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message, index) => ({
    index,
    role: String(message?.role || ''),
    content: serializePromptContentForLog(message?.content)
  }));
}

function formatDecisionEvent(decision) {
  if (decision.type === 'final') {
    return { type: 'final', preview: String(decision.output || '').slice(0, 160) };
  }

  const tools = Array.isArray(decision.tools) && decision.tools.length > 0
    ? decision.tools
    : (decision.tool ? [decision.tool] : []);

  return {
    type: 'tool',
    tools: tools.map((t) => ({ name: t?.name, args: t?.args || {} }))
  };
}

function isToolResultRetryable(toolResult = {}) {
  const code = String(toolResult?.code || '').trim().toUpperCase();
  const rpcReason = String(toolResult?.details?.rpcError?.data?.reason || '').trim().toUpperCase();
  const errorText = String(toolResult?.error || '').toLowerCase();
  if (code === 'APPROVAL_REQUIRED') return false;
  if (code === 'VALIDATION_ERROR' || code === 'OUT_OF_BOUNDS') return false;
  if (rpcReason === 'OUT_OF_BOUNDS') return false;
  if (errorText.includes('stay within the virtual desktop')) return false;
  if (errorText.includes('stay within one display')) return false;
  return true;
}

function normalizeToolCalls(decision) {
  const calls = Array.isArray(decision.tools) && decision.tools.length > 0
    ? decision.tools
    : (decision.tool ? [decision.tool] : []);

  return calls.map((call) => ({
    call_id: call.call_id || uuidv4(),
    name: call.name,
    args: call.args || {}
  }));
}

function shouldHintPersonaTool(input) {
  const text = String(input || '').toLowerCase();
  if (!text.trim()) return false;
  const keywords = ['修改人格', '人格', '称呼', '叫我', 'persona', 'nickname', 'custom name'];
  return keywords.some((kw) => text.includes(kw));
}

function isLive2dToolName(name) {
  return String(name || '').trim().startsWith('live2d.');
}

function isVoiceAutoReplyToolName(name) {
  return String(name || '').trim() === 'voice.tts_aliyun_vc';
}

function buildVoiceAutoReplyPrompt(runtimeContext = {}) {
  if (runtimeContext?.voice_auto_reply_enabled !== true) return null;
  if (runtimeContext?.voice_auto_reply_mode === 'force_on') {
    return [
      'Voice auto-reply force mode is enabled for this session.',
      'For every user-facing assistant reply with non-empty text, you MUST call voice.tts_aliyun_vc in the same turn before returning the final answer.',
      'Do not skip the TTS call even for short replies.',
      'For voice.tts_aliyun_vc args, use text/voiceTag only; do not use durationSec or duration_sec.',
      'Voice text constraints: plain text only, no markdown, no code block, and no more than 5 sentences.'
    ].join(' ');
  }
  return [
    'Voice auto-reply mode is enabled for this turn.',
    'Before long text response, first call voice.tts_aliyun_vc to produce a short spoken message.',
    'For voice.tts_aliyun_vc args, use text/voiceTag only; do not use durationSec or duration_sec.',
    'The voice text can be either: (1) summary of your long reply, or (2) brief commentary on current context.',
    'Voice text constraints: plain text only, no markdown, no code block, and no more than 5 sentences.'
  ].join(' ');
}

function buildSatisfiedTurnRequirementPrompt(turnRequirements = {}, availableTools = []) {
  const toolNames = new Set(
    (Array.isArray(availableTools) ? availableTools : [])
      .map((tool) => String(tool?.name || '').trim())
      .filter(Boolean)
  );
  const parts = [];
  if (turnRequirements?.live2d_satisfied && Array.from(toolNames).some((name) => isLive2dToolName(name))) {
    parts.push(
      'Status update for the current reply turn: the required Live2D action has already been completed. Do not call another live2d.* tool before producing the final answer.'
    );
  }
  if (turnRequirements?.voice_tts_satisfied && toolNames.has('voice.tts_aliyun_vc')) {
    parts.push(
      'Status update for the current reply turn: the required voice.tts_aliyun_vc call has already been completed. Do not call voice.tts_aliyun_vc again before producing the final answer.'
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function filterToolsForSatisfiedTurnRequirements(availableTools = [], turnRequirements = {}) {
  if (!Array.isArray(availableTools) || availableTools.length === 0) return [];
  return availableTools.filter((tool) => {
    const toolName = String(tool?.name || '').trim();
    if (!toolName) return false;
    if (turnRequirements?.live2d_satisfied && isLive2dToolName(toolName)) return false;
    if (turnRequirements?.voice_tts_satisfied && isVoiceAutoReplyToolName(toolName)) return false;
    return true;
  });
}

function buildDesktopCapturePrompt(availableTools = []) {
  const toolNames = new Set(
    (Array.isArray(availableTools) ? availableTools : [])
      .map((tool) => String(tool?.name || '').trim())
      .filter(Boolean)
  );
  const hasLocateTool = toolNames.has('desktop.locate.capture') || toolNames.has('desktop.locate.desktop');
  if (
    !toolNames.has('desktop.capture.screen')
    && !toolNames.has('desktop.capture.region')
    && !toolNames.has('desktop.capture.window')
    && !toolNames.has('desktop.capture.desktop')
  ) {
    return null;
  }
  return [
    'Desktop capture tools are available for this turn.',
    'When the user asks about current desktop, screen, UI, dialog, window, button, error, or any visible on-screen state, you MUST first call an appropriate desktop.capture.* tool before answering.',
    'Use desktop.capture.screen for one display, desktop.capture.region for a specific area, desktop.capture.window for one window, and desktop.capture.desktop for the full virtual desktop.',
    'After a desktop.capture.* tool succeeds, the loop will attach the screenshot in the next turn. Analyze that attached screenshot directly instead of guessing.',
    hasLocateTool
      ? 'When you need the position of an icon, button, text block, or other on-screen target, prefer desktop.locate.* tools. Use the returned display_id and display_relative_bounds directly instead of manually estimating desktop.capture.region coordinates.'
      : 'Do not manually guess region coordinates from screenshots unless they are explicitly known from prior tool output.',
    'If desktop.capture.region includes display_id, then x/y/width/height are relative to that display and must fit within that display bounds.',
    'If desktop.capture.region omits display_id, then x/y/width/height are global desktop coordinates and must stay within the target capture or virtual desktop bounds.',
    'Do not answer desktop-visibility questions without first capturing a screenshot.'
  ].join(' ');
}

function buildDesktopCaptureAnalysisPrompt(artifact = null) {
  if (!artifact) return null;
  return [
    'A tool-generated desktop screenshot is attached in the next user message.',
    'Analyze that screenshot directly to answer the latest user request.',
    'If the screenshot already contains enough evidence, answer directly instead of calling another desktop.capture.* tool.',
    'Do not invent invisible details.'
  ].join(' ');
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeDesktopCaptureArtifact(toolName, rawResult) {
  const safeToolName = String(toolName || '').trim();
  if (
    !safeToolName.startsWith('desktop.capture.')
    || safeToolName === 'desktop.capture.delete'
  ) {
    return null;
  }
  const parsed = parseJsonObject(rawResult);
  if (!parsed) return null;
  const captureId = String(parsed.capture_id || '').trim();
  const capturePath = String(parsed.path || '').trim();
  const mimeType = String(parsed.mime_type || 'image/png').trim() || 'image/png';
  if (!captureId || !capturePath) {
    return null;
  }
  return {
    scope: safeToolName.slice('desktop.capture.'.length),
    capture_id: captureId,
    path: capturePath,
    mime_type: mimeType,
    display_id: String(parsed.display_id || '').trim() || null,
    display_ids: Array.isArray(parsed.display_ids)
      ? parsed.display_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    source_id: String(parsed.source_id || '').trim() || null,
    window_title: String(parsed.window_title || '').trim() || null,
    bounds: parsed.bounds && typeof parsed.bounds === 'object' ? { ...parsed.bounds } : null,
    pixel_size: parsed.pixel_size && typeof parsed.pixel_size === 'object' ? { ...parsed.pixel_size } : null,
    scale_factor: Number(parsed.scale_factor) || 1
  };
}

function readDesktopCaptureDataUrl(artifact) {
  if (!artifact?.path || !fs.existsSync(artifact.path)) {
    return null;
  }
  const buffer = fs.readFileSync(artifact.path);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  return `data:${artifact.mime_type};base64,${buffer.toString('base64')}`;
}

function buildDesktopCaptureUserMessage(artifact, dataUrl) {
  if (!artifact || !dataUrl) return null;
  const descriptor = [
    `capture_id=${artifact.capture_id}`,
    artifact.scope ? `scope=${artifact.scope}` : null,
    artifact.display_id ? `display_id=${artifact.display_id}` : null,
    artifact.window_title ? `window_title=${artifact.window_title}` : null
  ].filter(Boolean).join(', ');
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Tool-generated desktop screenshot attached (${descriptor}). Analyze this screenshot to answer the latest user request.`
      },
      {
        type: 'image_url',
        image_url: { url: dataUrl }
      }
    ]
  };
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return Boolean(fallback);
}

function normalizeAsyncMode(value, fallback = 'serial') {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === 'parallel' || raw === 'serial') return raw;
  return String(fallback || 'serial');
}

function normalizePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, Number.parseInt(fallback, 10) || 1);
  return parsed;
}

function normalizeSideEffectLevel(value, fallback = 'write') {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === 'none' || raw === 'read' || raw === 'write') return raw;
  return String(fallback || 'write');
}

class ToolLoopRunner {
  constructor({
    bus,
    getReasoner,
    listTools,
    resolvePersonaContext,
    resolveSkillsContext,
    maxStep = 128,
    toolErrorMaxRetries = 5,
    toolResultTimeoutMs = 10000,
    runtimeStreamingEnabled = false,
    toolAsyncMode = 'serial',
    toolEarlyDispatch = false,
    maxParallelTools = 3
  }) {
    this.bus = bus;
    this.getReasoner = getReasoner;
    this.listTools = listTools;
    this.resolvePersonaContext = resolvePersonaContext;
    this.resolveSkillsContext = resolveSkillsContext;
    this.maxStep = maxStep;
    this.toolErrorMaxRetries = normalizePositiveInt(toolErrorMaxRetries, 5);
    this.toolResultTimeoutMs = toolResultTimeoutMs;
    this.runtimeStreamingEnabled = normalizeBoolean(runtimeStreamingEnabled, false);
    this.toolAsyncMode = normalizeAsyncMode(toolAsyncMode, 'serial');
    this.toolEarlyDispatch = normalizeBoolean(toolEarlyDispatch, false);
    this.maxParallelTools = normalizePositiveInt(maxParallelTools, 3);
  }

  async run({ sessionId, input, inputImages = [], seedMessages = [], runtimeContext = {}, onEvent }) {
    const sm = new RuntimeStateMachine();
    const traceId = uuidv4();
    const runStartedAtMs = Date.now();
    let eventSeq = 0;
    const runMetrics = {
      run_started_ms: runStartedAtMs,
      first_token_ms: null,
      first_tool_stable_ms: null,
      first_tool_result_ms: null,
      final_ms: null,
      out_of_order_events: 0,
      tool_dedup_hit: 0,
      tool_parse_error: 0
    };
    const runtimeFlags = {
      streaming_enabled: this.runtimeStreamingEnabled,
      tool_async_mode: this.toolAsyncMode,
      tool_early_dispatch: this.toolEarlyDispatch,
      max_parallel_tools: this.maxParallelTools,
      tool_error_max_retries: this.toolErrorMaxRetries
    };

    const markMetricIfUnset = (key) => {
      if (runMetrics[key] !== null && runMetrics[key] !== undefined) return;
      runMetrics[key] = Math.max(0, Date.now() - runStartedAtMs);
    };

    const markMetricAtTimeIfUnset = (key, timestampMs) => {
      if (runMetrics[key] !== null && runMetrics[key] !== undefined) return;
      const ts = Number(timestampMs);
      if (!Number.isFinite(ts)) return;
      runMetrics[key] = Math.max(0, ts - runStartedAtMs);
    };

    const finalizeMetrics = () => {
      if (runMetrics.final_ms === null || runMetrics.final_ms === undefined) {
        runMetrics.final_ms = Math.max(0, Date.now() - runStartedAtMs);
      }
      return { ...runMetrics };
    };

    const priorMessages = Array.isArray(seedMessages)
      ? seedMessages.filter((msg) => (
        msg
        && (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant')
        && isValidMessageContent(msg.content)
      ))
      : [];
    const currentUserMessage = buildCurrentUserMessage(input, inputImages);
    const normalizedInputImages = normalizeInputImages(inputImages);

    let personaContext = null;
    if (typeof this.resolvePersonaContext === 'function') {
      try {
        personaContext = await this.resolvePersonaContext({ sessionId, input });
      } catch {
        personaContext = null;
      }
    }

    let skillsContext = null;
    if (typeof this.resolveSkillsContext === 'function') {
      try {
        skillsContext = await this.resolveSkillsContext({ sessionId, input });
      } catch {
        skillsContext = null;
      }
    }

    const personaPrompt = personaContext?.prompt && String(personaContext.prompt).trim()
      ? String(personaContext.prompt)
      : null;

    const skillsPrompt = skillsContext?.prompt && String(skillsContext.prompt).trim()
      ? String(skillsContext.prompt)
      : null;

    const personaToolHint = shouldHintPersonaTool(input)
      ? 'User intent likely about persona/addressing. Prefer persona.update_profile tool call with {custom_name}.'
      : null;
    const voiceAutoReplyPrompt = buildVoiceAutoReplyPrompt(runtimeContext);
    const initialAvailableTools = this.listTools();
    const desktopCapturePrompt = buildDesktopCapturePrompt(initialAvailableTools);

    const ctx = {
      sessionId,
      traceId,
      stepIndex: 0,
      input,
      observations: [],
      turnRequirements: {
        live2d_satisfied: false,
        voice_tts_satisfied: false
      },
      desktopCaptureAttachment: null,
      messages: [
        {
          role: 'system',
          content: [
            'You are a runtime planner that can either return a final answer or call tools.',
            'If tools are needed, you may emit one or more tool calls and wait for results in the next turn.',
            'Long-term memory operations must go through tools (memory_write / memory_search).',
            'For every reply turn, decide one Live2D action and a duration_sec based on the chat context.',
            'When live2d tools are available, call exactly one live2d.* tool with valid preset/action names and explicit duration_sec before final text response.',
            'When user asks to modify persona/addressing/custom title (e.g. 修改人格/修改称呼/叫我xxx), call persona.update_profile with {custom_name}.',
            'For requests that mention named targets (e.g. playlist/file/tab), avoid assuming exact names: first list/search candidates via tools, then choose the best semantic match before action.',
            'If shell.exec returns APPROVAL_REQUIRED, call shell.approve with approval_id, then retry shell.exec.',
            `If a tool returns an error, use the error details to re-plan and retry with an alternative approach. Maximum tool-error retries per run: ${this.toolErrorMaxRetries}.`,
            'Use persona.update_profile even in low permission sessions; this is globally allowed.',
            'Keep answers concise.'
          ].join(' ')
        },
        ...(personaPrompt ? [{ role: 'system', content: personaPrompt }] : []),
        ...(skillsPrompt ? [{ role: 'system', content: skillsPrompt }] : []),
        ...(personaToolHint ? [{ role: 'system', content: personaToolHint }] : []),
        ...(voiceAutoReplyPrompt ? [{ role: 'system', content: voiceAutoReplyPrompt }] : []),
        ...(desktopCapturePrompt ? [{ role: 'system', content: desktopCapturePrompt }] : []),
        ...priorMessages,
        currentUserMessage
      ]
    };

    const emit = (event, payload = {}) => {
      if (event === 'llm.final' && payload?.decision?.type === 'final') {
        markMetricIfUnset('first_token_ms');
      }
      if (event === 'llm.stream.delta') {
        markMetricIfUnset('first_token_ms');
      }
      if (event === 'tool.result') {
        markMetricIfUnset('first_tool_result_ms');
      }

      const envelope = {
        trace_id: traceId,
        session_id: sessionId,
        task_id: null,
        step_index: ctx.stepIndex,
        seq: ++eventSeq,
        event,
        source: 'runtime',
        latency_budget_ms: 1200,
        payload
      };
      this.bus.publish('runtime.event', envelope);
      onEvent?.(envelope);
    };

    // passthrough select bus topics to runtime.event stream (e.g. for Electron IPC)
    const PASSTHROUGH_TOPICS = {
      'voice.playback.electron': 'voice.playback.electron',
      'tool.call.progress': 'tool.progress'
    };
    const passthroughUnsubs = Object.entries(PASSTHROUGH_TOPICS).map(([topic, eventName]) => {
      const handler = (payload) => {
        if (payload?.session_id && payload.session_id !== sessionId) return;
        emit(eventName, payload);
      };
      return this.bus.subscribe(topic, handler);
    });

    sm.transition(RuntimeState.RUNNING);
    publishChainEvent(this.bus, 'loop.start', {
      session_id: sessionId,
      trace_id: traceId,
      input_chars: String(input || '').length,
      input_images: normalizedInputImages.length
    });
    emit('plan', {
      input,
      input_images: normalizedInputImages.length,
      max_step: this.maxStep,
      context_messages: priorMessages.length,
      persona_mode: personaContext?.mode || null,
      skills_selected: skillsContext?.selected?.length || 0,
      skills_clipped_by: skillsContext?.clippedBy || null,
      runtime_flags: runtimeFlags
    });
    emit('llm.prompt.assembled', {
      message_count: ctx.messages.length,
      messages: serializePromptMessagesForLog(ctx.messages)
    });

    try {
      const reasoner = this.getReasoner();
      const schemaAjv = new Ajv({ allErrors: true, strict: false });
      const schemaValidatorCache = new Map();
      let toolErrorRetryCount = 0;
      let lastRetryableToolError = null;
      const getSchemaValidator = (toolDef) => {
        const toolName = String(toolDef?.name || '').trim();
        if (!toolName) return null;
        if (schemaValidatorCache.has(toolName)) {
          return schemaValidatorCache.get(toolName);
        }
        const schema = toolDef?.input_schema || {
          type: 'object',
          properties: {},
          additionalProperties: true
        };
        const validate = schemaAjv.compile(schema);
        schemaValidatorCache.set(toolName, validate);
        return validate;
      };

      while (ctx.stepIndex < this.maxStep) {
        ctx.stepIndex += 1;
        const allAvailableTools = this.listTools();
        const availableTools = filterToolsForSatisfiedTurnRequirements(allAvailableTools, ctx.turnRequirements);
        const toolDefByName = new Map(
          (Array.isArray(availableTools) ? availableTools : [])
            .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
            .map((tool) => [tool.name, tool])
        );
        const satisfiedTurnRequirementPrompt = buildSatisfiedTurnRequirementPrompt(ctx.turnRequirements, allAvailableTools);
        const reasonerMessages = [
          ...ctx.messages,
          ...(satisfiedTurnRequirementPrompt ? [{ role: 'system', content: satisfiedTurnRequirementPrompt }] : []),
          ...(ctx.desktopCaptureAttachment?.analysis_prompt
            ? [{ role: 'system', content: ctx.desktopCaptureAttachment.analysis_prompt }]
            : []),
          ...(ctx.desktopCaptureAttachment?.message ? [ctx.desktopCaptureAttachment.message] : [])
        ];
        publishChainEvent(this.bus, 'loop.decide.start', {
          session_id: sessionId,
          trace_id: traceId,
          step_index: ctx.stepIndex,
          messages: reasonerMessages.length
        });

        const pendingToolCallPromises = new Map();
        const pendingToolCallDefs = new Map();
        const dispatchToolCall = (rawCall, dispatchMode = 'normal') => {
          const callId = String(rawCall?.call_id || '').trim();
          const name = String(rawCall?.name || '').trim();
          if (!callId || !name) {
            return null;
          }
          const normalizedCall = {
            call_id: callId,
            name,
            args: rawCall?.args || {}
          };

          const existingPromise = pendingToolCallPromises.get(callId);
          if (existingPromise) {
            const existingCall = pendingToolCallDefs.get(callId) || {};
            const argsChanged = JSON.stringify(existingCall.args || {}) !== JSON.stringify(normalizedCall.args || {});
            const nameChanged = String(existingCall.name || '') !== normalizedCall.name;
            if (argsChanged || nameChanged) {
              emit('tool.call.stable_mismatch', {
                call_id: callId,
                previous_name: existingCall.name || null,
                next_name: normalizedCall.name,
                previous_args: existingCall.args || {},
                next_args: normalizedCall.args || {},
                dispatch_mode: dispatchMode
              });
            }
            return existingPromise;
          }

          const toolCallPayload = {
            trace_id: traceId,
            session_id: sessionId,
            step_index: ctx.stepIndex,
            call_id: normalizedCall.call_id,
            workspace_root: runtimeContext.workspace_root || null,
            permission_level: runtimeContext.permission_level || null,
            tool: {
              name: normalizedCall.name,
              args: normalizedCall.args || {}
            }
          };

          emit('tool.call', {
            call_id: normalizedCall.call_id,
            name: normalizedCall.name,
            args: normalizedCall.args || {},
            dispatch_mode: dispatchMode
          });
          if (dispatchMode === 'early') {
            emit('tool.call.early_dispatched', {
              call_id: normalizedCall.call_id,
              name: normalizedCall.name
            });
          }
          publishChainEvent(this.bus, 'loop.tool.requested', {
            session_id: sessionId,
            trace_id: traceId,
            step_index: ctx.stepIndex,
            call_id: normalizedCall.call_id,
            tool_name: normalizedCall.name
          });

          const waitPromise = this.bus.waitFor(
            'tool.call.result',
            (payload) => payload.trace_id === traceId && payload.call_id === normalizedCall.call_id,
            this.toolResultTimeoutMs
          ).then((toolResult) => ({
            call: normalizedCall,
            toolResult,
            resolved_at_ms: Date.now()
          }));

          this.bus.publish('tool.call.requested', toolCallPayload);
          publishChainEvent(this.bus, 'loop.tool.waiting_result', {
            session_id: sessionId,
            trace_id: traceId,
            step_index: ctx.stepIndex,
            call_id: normalizedCall.call_id,
            tool_name: normalizedCall.name
          });

          pendingToolCallDefs.set(callId, normalizedCall);
          pendingToolCallPromises.set(callId, waitPromise);
          return waitPromise;
        };

        let decision = null;
        const useStreamingDecision = this.runtimeStreamingEnabled && typeof reasoner.decideStream === 'function';
        if (useStreamingDecision) {
          const emittedParseErrorKeys = new Set();
          const emitParseError = (parseError) => {
            const payload = parseError && typeof parseError === 'object' ? parseError : {};
            const key = [
              payload.index ?? '',
              payload.call_id ?? '',
              payload.name ?? '',
              payload.parse_reason ?? '',
              payload.args_raw ?? ''
            ].join('|');
            if (emittedParseErrorKeys.has(key)) return;
            emittedParseErrorKeys.add(key);
            runMetrics.tool_parse_error += 1;
            emit('tool_call.parse_error', payload);
          };

          emit('llm.stream.start', {
            mode: 'decision_stream'
          });
          decision = await reasoner.decideStream({
            messages: reasonerMessages,
            tools: availableTools,
            onDelta: (delta) => {
              emit('llm.stream.delta', {
                delta: String(delta || '')
              });
            },
            onToolCallDelta: (delta) => {
              emit('tool_call.delta', delta || {});
            },
            onToolCallStable: (stableCall) => {
              markMetricIfUnset('first_tool_stable_ms');
              emit('tool_call.stable', stableCall || {});
              if (this.toolEarlyDispatch) {
                const stableToolName = String(stableCall?.name || '').trim();
                if (!stableToolName) {
                  emit('tool.call.early_skipped', {
                    reason: 'missing_call_id_or_name',
                    call_id: stableCall?.call_id || null,
                    name: stableCall?.name || null
                  });
                  return;
                }
                const stableToolDef = toolDefByName.get(stableToolName) || null;
                if (!stableToolDef) {
                  emit('tool.call.early_skipped', {
                    reason: 'tool_not_found',
                    call_id: stableCall?.call_id || null,
                    name: stableToolName
                  });
                  return;
                }
                const validate = getSchemaValidator(stableToolDef);
                const stableArgs = stableCall?.args && typeof stableCall.args === 'object' && !Array.isArray(stableCall.args)
                  ? stableCall.args
                  : {};
                const argsReady = validate ? validate(stableArgs) : true;
                if (!argsReady) {
                  emit('tool.call.early_skipped', {
                    reason: 'args_not_ready',
                    call_id: stableCall?.call_id || null,
                    name: stableToolName,
                    validation_errors: validate?.errors || []
                  });
                  return;
                }
                const earlyPromise = dispatchToolCall({
                  call_id: stableCall?.call_id || '',
                  name: stableCall?.name || '',
                  args: stableCall?.args || {}
                }, 'early');
                if (!earlyPromise) {
                  emit('tool.call.early_skipped', {
                    reason: 'missing_call_id_or_name',
                    call_id: stableCall?.call_id || null,
                    name: stableCall?.name || null
                  });
                }
              }
            },
            onToolCallParseError: (parseError) => {
              emitParseError(parseError);
            }
          });
          const parseErrors = Array.isArray(decision?.stream_meta?.parse_errors)
            ? decision.stream_meta.parse_errors
            : [];
          parseErrors.forEach((item) => emitParseError(item));
          emit('llm.stream.end', {
            mode: 'decision_stream'
          });
        } else {
          decision = await reasoner.decide({
            messages: reasonerMessages,
            tools: availableTools
          });
        }
        publishChainEvent(this.bus, 'loop.decide.completed', {
          session_id: sessionId,
          trace_id: traceId,
          step_index: ctx.stepIndex,
          decision_type: decision?.type || 'unknown',
          tool_calls: Array.isArray(decision?.tools) ? decision.tools.length : (decision?.tool ? 1 : 0)
        });

        emit('llm.final', {
          decision: formatDecisionEvent(decision),
          streamed: useStreamingDecision,
          stream_meta: decision?.stream_meta || null
        });

        if (decision.type === 'final') {
          if (decision.assistantMessage) {
            ctx.messages.push(decision.assistantMessage);
          }

          sm.transition(RuntimeState.DONE);
          publishChainEvent(this.bus, 'loop.final', {
            session_id: sessionId,
            trace_id: traceId,
            step_index: ctx.stepIndex,
            state: sm.state
          });
          const metrics = finalizeMetrics();
          emit('done', { output: decision.output, state: sm.state, metrics });
          return { output: decision.output, traceId, state: sm.state, metrics };
        }

        const toolCalls = normalizeToolCalls(decision);
        if (toolCalls.length === 0) {
          sm.transition(RuntimeState.ERROR);
          emit('tool.error', { error: '模型返回了 tool 类型但没有可执行的工具调用。' });
          return { output: '运行错误：模型未返回可执行的工具调用。', traceId, state: sm.state };
        }

        const assistantMessage = decision.assistantMessage || {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((call) => ({
            id: call.call_id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args || {})
            }
          }))
        };

        if (!decision.assistantMessage) {
          ctx.messages.push(assistantMessage);
        } else {
          // keep model's original message for traceability
          ctx.messages.push(decision.assistantMessage);
        }

        const toolMetaByName = new Map(
          (Array.isArray(availableTools) ? availableTools : [])
            .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
            .map((tool) => [tool.name, tool])
        );
        const canRunParallel = this.toolAsyncMode === 'parallel'
          && toolCalls.length > 1
          && toolCalls.every((call) => {
            const meta = toolMetaByName.get(call.name) || {};
            const sideEffectLevel = normalizeSideEffectLevel(meta.side_effect_level, 'write');
            const requiresLock = normalizeBoolean(meta.requires_lock, false);
            return sideEffectLevel === 'none' && !requiresLock;
          });
        const chunkWidth = canRunParallel ? Math.min(this.maxParallelTools, toolCalls.length) : 1;
        emit('tool.dispatch.mode', {
          mode: canRunParallel ? 'parallel' : 'serial',
          total_calls: toolCalls.length,
          chunk_width: chunkWidth
        });

        let stepHasRetryableToolError = false;
        for (let start = 0; start < toolCalls.length; start += chunkWidth) {
          const chunk = toolCalls.slice(start, start + chunkWidth);
          const chunkResults = await Promise.all(chunk.map((call) => {
            const waitPromise = dispatchToolCall(call, 'normal');
            if (!waitPromise) {
              throw new Error(`invalid tool call payload: ${call?.call_id || 'unknown'}`);
            }
            return waitPromise.then((payload) => ({
              requestedCall: call,
              ...payload
            }));
          }));
          const earliestResolvedAtMs = chunkResults.reduce((acc, current) => {
            const ts = Number(current?.resolved_at_ms);
            if (!Number.isFinite(ts)) return acc;
            if (!Number.isFinite(acc)) return ts;
            return Math.min(acc, ts);
          }, Number.NaN);
          markMetricAtTimeIfUnset('first_tool_result_ms', earliestResolvedAtMs);

          for (const { requestedCall, toolResult } of chunkResults) {
            const effectiveCall = requestedCall || {};
            publishChainEvent(this.bus, 'loop.tool.result_received', {
              session_id: sessionId,
              trace_id: traceId,
              step_index: ctx.stepIndex,
              call_id: effectiveCall.call_id,
              tool_name: effectiveCall.name,
              ok: Boolean(toolResult?.ok),
              code: toolResult?.code || null
            });

            if (!toolResult.ok) {
              if (toolResult.code === 'APPROVAL_REQUIRED') {
                const approvalPayload = {
                  ok: false,
                  code: toolResult.code,
                  error: toolResult.error,
                  details: toolResult.details || null
                };
                const approvalContent = JSON.stringify(approvalPayload);

                ctx.messages.push({
                  role: 'tool',
                  tool_call_id: effectiveCall.call_id,
                  name: effectiveCall.name,
                  content: approvalContent
                });

                ctx.observations.push({
                  call_id: effectiveCall.call_id,
                  name: effectiveCall.name,
                  error: toolResult.error,
                  code: toolResult.code,
                  details: toolResult.details || null
                });

                emit('tool.result', {
                  call_id: effectiveCall.call_id,
                  name: effectiveCall.name,
                  result: approvalContent,
                  approval_required: true,
                  code: toolResult.code
                });
                continue;
              }

              const retryAllowed = isToolResultRetryable(toolResult);
              const nextRetryCount = retryAllowed ? (toolErrorRetryCount + 1) : toolErrorRetryCount;
              const retryLimitReached = !retryAllowed || nextRetryCount > this.toolErrorMaxRetries;
              const retryPayload = {
                ok: false,
                code: toolResult.code || 'RUNTIME_ERROR',
                error: toolResult.error,
                details: toolResult.details || null,
                retryable: retryAllowed && !retryLimitReached,
                retry_count: retryAllowed ? Math.min(nextRetryCount, this.toolErrorMaxRetries) : toolErrorRetryCount,
                retry_limit: this.toolErrorMaxRetries
              };
              const retryContent = JSON.stringify(retryPayload);

              ctx.messages.push({
                role: 'tool',
                tool_call_id: effectiveCall.call_id,
                name: effectiveCall.name,
                content: retryContent
              });
              ctx.observations.push({
                call_id: effectiveCall.call_id,
                name: effectiveCall.name,
                error: toolResult.error,
                code: toolResult.code,
                details: toolResult.details || null,
                retry_count: retryAllowed ? Math.min(nextRetryCount, this.toolErrorMaxRetries) : toolErrorRetryCount,
                retry_limit: this.toolErrorMaxRetries
              });
              emit('tool.result', {
                call_id: effectiveCall.call_id,
                name: effectiveCall.name,
                result: retryContent,
                code: toolResult.code || 'RUNTIME_ERROR',
                error: true,
                retryable: retryAllowed && !retryLimitReached,
                retry_count: retryAllowed ? Math.min(nextRetryCount, this.toolErrorMaxRetries) : toolErrorRetryCount,
                retry_limit: this.toolErrorMaxRetries
              });

              if (retryLimitReached) {
                sm.transition(RuntimeState.ERROR);
                emit('tool.error', {
                  call_id: effectiveCall.call_id,
                  error: toolResult.error,
                  name: effectiveCall.name,
                  code: toolResult.code,
                  retry_exhausted: retryAllowed,
                  non_retryable: !retryAllowed,
                  retry_count: retryAllowed ? this.toolErrorMaxRetries : toolErrorRetryCount,
                  retry_limit: this.toolErrorMaxRetries
                });
                return {
                  output: retryAllowed
                    ? `工具执行失败：${toolResult.error}（已达到最大重试次数 ${this.toolErrorMaxRetries}）`
                    : `工具执行失败：${toolResult.error}`,
                  traceId,
                  state: sm.state
                };
              }

              toolErrorRetryCount = nextRetryCount;
              lastRetryableToolError = {
                call_id: effectiveCall.call_id,
                name: effectiveCall.name,
                error: toolResult.error,
                code: toolResult.code
              };
              stepHasRetryableToolError = true;
              emit('tool.error', {
                call_id: effectiveCall.call_id,
                error: toolResult.error,
                name: effectiveCall.name,
                code: toolResult.code,
                will_retry: true,
                retry_count: toolErrorRetryCount,
                retry_limit: this.toolErrorMaxRetries
              });
              continue;
            }

            if (toolResult?.dedup_hit) {
              runMetrics.tool_dedup_hit += 1;
            }

            ctx.messages.push({
              role: 'tool',
              tool_call_id: effectiveCall.call_id,
              name: effectiveCall.name,
              content: String(toolResult.result)
            });

            ctx.observations.push({
              call_id: effectiveCall.call_id,
              name: effectiveCall.name,
              result: toolResult.result
            });

            if (!ctx.turnRequirements.live2d_satisfied && isLive2dToolName(effectiveCall.name)) {
              ctx.turnRequirements.live2d_satisfied = true;
              ctx.messages.push({
                role: 'system',
                content: 'Status update for the current reply turn: one live2d.* action has completed successfully. Do not call another live2d.* tool before producing the final answer.'
              });
            }
            if (!ctx.turnRequirements.voice_tts_satisfied && isVoiceAutoReplyToolName(effectiveCall.name)) {
              ctx.turnRequirements.voice_tts_satisfied = true;
              ctx.messages.push({
                role: 'system',
                content: 'Status update for the current reply turn: voice.tts_aliyun_vc has completed successfully. Do not call voice.tts_aliyun_vc again before producing the final answer.'
              });
            }

            const desktopCaptureArtifact = normalizeDesktopCaptureArtifact(effectiveCall.name, toolResult.result);
            if (desktopCaptureArtifact) {
              const imageDataUrl = readDesktopCaptureDataUrl(desktopCaptureArtifact);
              if (imageDataUrl) {
                ctx.desktopCaptureAttachment = {
                  artifact: desktopCaptureArtifact,
                  analysis_prompt: buildDesktopCaptureAnalysisPrompt(desktopCaptureArtifact),
                  message: buildDesktopCaptureUserMessage(desktopCaptureArtifact, imageDataUrl)
                };
                emit('tool.capture.attached', {
                  call_id: effectiveCall.call_id,
                  name: effectiveCall.name,
                  capture_id: desktopCaptureArtifact.capture_id,
                  scope: desktopCaptureArtifact.scope
                });
              } else {
                publishChainEvent(this.bus, 'loop.desktop_capture.unavailable', {
                  session_id: sessionId,
                  trace_id: traceId,
                  step_index: ctx.stepIndex,
                  call_id: effectiveCall.call_id,
                  tool_name: effectiveCall.name,
                  capture_id: desktopCaptureArtifact.capture_id
                });
              }
            }

            emit('tool.result', {
              call_id: effectiveCall.call_id,
              name: effectiveCall.name,
              result: toolResult.result
            });
          }
        }

        if (stepHasRetryableToolError) {
          emit('tool.retry.scheduled', {
            retry_count: toolErrorRetryCount,
            retry_limit: this.toolErrorMaxRetries,
            last_error: lastRetryableToolError?.error || null,
            last_code: lastRetryableToolError?.code || null
          });
        }
      }

      if (lastRetryableToolError) {
        sm.transition(RuntimeState.ERROR);
        emit('tool.error', {
          call_id: lastRetryableToolError.call_id,
          error: lastRetryableToolError.error,
          name: lastRetryableToolError.name,
          code: lastRetryableToolError.code,
          retry_exhausted: false,
          retry_count: toolErrorRetryCount,
          retry_limit: this.toolErrorMaxRetries,
          reason: 'max_step_reached_with_pending_tool_errors'
        });
        const metrics = finalizeMetrics();
        return {
          output: `工具执行失败：${lastRetryableToolError.error}（已达到 max_step，重试 ${toolErrorRetryCount}/${this.toolErrorMaxRetries}）`,
          traceId,
          state: sm.state,
          metrics
        };
      }

      sm.transition(RuntimeState.DONE);
      const fallback = '达到 max_step，已停止工具调用并收束。';
      publishChainEvent(this.bus, 'loop.max_step_reached', {
        session_id: sessionId,
        trace_id: traceId,
        max_step: this.maxStep
      });
      const metrics = finalizeMetrics();
      emit('done', { output: fallback, state: sm.state, metrics });
      return { output: fallback, traceId, state: sm.state, metrics };
    } catch (err) {
      sm.transition(RuntimeState.ERROR);
      publishChainEvent(this.bus, 'loop.error', {
        session_id: sessionId,
        trace_id: traceId,
        error: err?.message || String(err)
      });
      emit('tool.error', { error: err.message || String(err) });
      const metrics = finalizeMetrics();
      return { output: `运行错误：${err.message || String(err)}`, traceId, state: sm.state, metrics };
    } finally {
      passthroughUnsubs.forEach((unsub) => unsub());
    }
  }
}

module.exports = { ToolLoopRunner };
