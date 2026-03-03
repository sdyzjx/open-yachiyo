const { v4: uuidv4 } = require('uuid');
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

class ToolLoopRunner {
  constructor({
    bus,
    getReasoner,
    listTools,
    resolvePersonaContext,
    resolveSkillsContext,
    maxStep = 8,
    toolResultTimeoutMs = 10000,
    runtimeStreamingEnabled = false,
    toolAsyncMode = 'serial',
    toolEarlyDispatch = false
  }) {
    this.bus = bus;
    this.getReasoner = getReasoner;
    this.listTools = listTools;
    this.resolvePersonaContext = resolvePersonaContext;
    this.resolveSkillsContext = resolveSkillsContext;
    this.maxStep = maxStep;
    this.toolResultTimeoutMs = toolResultTimeoutMs;
    this.runtimeStreamingEnabled = normalizeBoolean(runtimeStreamingEnabled, false);
    this.toolAsyncMode = normalizeAsyncMode(toolAsyncMode, 'serial');
    this.toolEarlyDispatch = normalizeBoolean(toolEarlyDispatch, false);
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
      tool_early_dispatch: this.toolEarlyDispatch
    };

    const markMetricIfUnset = (key) => {
      if (runMetrics[key] !== null && runMetrics[key] !== undefined) return;
      runMetrics[key] = Math.max(0, Date.now() - runStartedAtMs);
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

    const ctx = {
      sessionId,
      traceId,
      stepIndex: 0,
      input,
      observations: [],
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
            'Use persona.update_profile even in low permission sessions; this is globally allowed.',
            'Keep answers concise.'
          ].join(' ')
        },
        ...(personaPrompt ? [{ role: 'system', content: personaPrompt }] : []),
        ...(skillsPrompt ? [{ role: 'system', content: skillsPrompt }] : []),
        ...(personaToolHint ? [{ role: 'system', content: personaToolHint }] : []),
        ...priorMessages,
        currentUserMessage
      ]
    };

    const emit = (event, payload = {}) => {
      if (event === 'llm.final' && payload?.decision?.type === 'final') {
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
    const PASSTHROUGH_TOPICS = ['voice.playback.electron'];
    const passthroughUnsubs = PASSTHROUGH_TOPICS.map((topic) => {
      const handler = (payload) => {
        if (payload?.session_id && payload.session_id !== sessionId) return;
        emit(topic, payload);
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

    try {
      const reasoner = this.getReasoner();

      while (ctx.stepIndex < this.maxStep) {
        ctx.stepIndex += 1;
        publishChainEvent(this.bus, 'loop.decide.start', {
          session_id: sessionId,
          trace_id: traceId,
          step_index: ctx.stepIndex,
          messages: ctx.messages.length
        });

        const decision = await reasoner.decide({
          messages: ctx.messages,
          tools: this.listTools()
        });
        publishChainEvent(this.bus, 'loop.decide.completed', {
          session_id: sessionId,
          trace_id: traceId,
          step_index: ctx.stepIndex,
          decision_type: decision?.type || 'unknown',
          tool_calls: Array.isArray(decision?.tools) ? decision.tools.length : (decision?.tool ? 1 : 0)
        });

        emit('llm.final', { decision: formatDecisionEvent(decision) });

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

        for (const call of toolCalls) {
          const toolCallPayload = {
            trace_id: traceId,
            session_id: sessionId,
            step_index: ctx.stepIndex,
            call_id: call.call_id,
            workspace_root: runtimeContext.workspace_root || null,
            permission_level: runtimeContext.permission_level || null,
            tool: {
              name: call.name,
              args: call.args || {}
            }
          };

          emit('tool.call', {
            call_id: call.call_id,
            name: call.name,
            args: call.args || {}
          });
          publishChainEvent(this.bus, 'loop.tool.requested', {
            session_id: sessionId,
            trace_id: traceId,
            step_index: ctx.stepIndex,
            call_id: call.call_id,
            tool_name: call.name
          });

          this.bus.publish('tool.call.requested', toolCallPayload);

          publishChainEvent(this.bus, 'loop.tool.waiting_result', {
            session_id: sessionId,
            trace_id: traceId,
            step_index: ctx.stepIndex,
            call_id: call.call_id,
            tool_name: call.name
          });
          const toolResult = await this.bus.waitFor(
            'tool.call.result',
            (payload) => payload.trace_id === traceId && payload.call_id === call.call_id,
            this.toolResultTimeoutMs
          );
          publishChainEvent(this.bus, 'loop.tool.result_received', {
            session_id: sessionId,
            trace_id: traceId,
            step_index: ctx.stepIndex,
            call_id: call.call_id,
            tool_name: call.name,
            ok: Boolean(toolResult?.ok),
            code: toolResult?.code || null
          });

          if (!toolResult.ok) {
            sm.transition(RuntimeState.ERROR);
            emit('tool.error', { call_id: call.call_id, error: toolResult.error, name: call.name, code: toolResult.code });
            return { output: `工具执行失败：${toolResult.error}`, traceId, state: sm.state };
          }

          ctx.messages.push({
            role: 'tool',
            tool_call_id: call.call_id,
            name: call.name,
            content: String(toolResult.result)
          });

          ctx.observations.push({
            call_id: call.call_id,
            name: call.name,
            result: toolResult.result
          });

          emit('tool.result', {
            call_id: call.call_id,
            name: call.name,
            result: toolResult.result
          });
        }
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
