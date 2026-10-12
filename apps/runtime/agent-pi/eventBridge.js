const { randomUUID } = require('node:crypto');

function contentText(content) {
  return (content || []).filter((part) => part.type === 'text').map((part) => part.text).join('');
}

class EventBridge {
  constructor({ bus, sessionId, onEvent, streaming = true, resolveToolName = (name) => name }) {
    this.bus = bus;
    this.sessionId = sessionId;
    this.traceId = randomUUID();
    this.onEvent = onEvent;
    this.streaming = streaming;
    this.seq = 0;
    this.step = 0;
    this.events = [];
    this.hasOutput = false;
    this.hasTools = false;
    this.toolFailures = new Map();
    this.resolveToolName = resolveToolName;
    this.metrics = { run_started_ms: Date.now(), first_token_ms: null, first_tool_stable_ms: null,
      first_tool_result_ms: null, final_ms: null, out_of_order_events: 0, tool_dedup_hit: 0, tool_parse_error: 0 };
  }

  toolName(name) {
    return this.resolveToolName(name) || name;
  }

  setToolNameResolver(resolveToolName) {
    this.resolveToolName = resolveToolName;
  }

  mark(key) {
    this.metrics[key] ??= Math.max(0, Date.now() - this.metrics.run_started_ms);
  }

  emit(event, payload = {}) {
    const envelope = { trace_id: this.traceId, session_id: this.sessionId, task_id: null, step_index: this.step,
      seq: ++this.seq, event, source: 'runtime', latency_budget_ms: 1200, payload };
    this.events.push(envelope);
    this.bus?.publish('runtime.event', envelope);
    this.onEvent?.(envelope);
  }

  accept(event) {
    if (event.type === 'turn_start') {
      this.step += 1;
      if (this.streaming) this.emit('llm.stream.start', { mode: 'decision_stream' });
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') {
        this.hasOutput = true;
        this.mark('first_token_ms');
        if (this.streaming) {
          this.emit('llm.stream.delta', { delta: update.delta });
          this.bus?.publish('message.delta', { session_id: this.sessionId, trace_id: this.traceId, step_index: this.step, delta: update.delta });
        }
      } else if (update.type === 'toolcall_end') {
        this.mark('first_tool_stable_ms');
        this.emit('tool_call.stable', { call_id: update.toolCall.id, name: this.toolName(update.toolCall.name), args: update.toolCall.arguments });
      } else if (update.type === 'toolcall_delta') {
        this.emit('tool_call.delta', { index: update.contentIndex, delta: update.delta });
      }
    } else if (event.type === 'tool_execution_start') {
      this.hasTools = true;
      const payload = { call_id: event.toolCallId, name: this.toolName(event.toolName), args: event.args, dispatch_mode: 'pi' };
      this.emit('tool.call', payload);
      this.emit('tool_call.requested', payload);
      this.emit('tool_call.started', payload);
    } else if (event.type === 'tool_execution_end') {
      this.mark('first_tool_result_ms');
      const failure = this.toolFailures.get(event.toolCallId);
      this.toolFailures.delete(event.toolCallId);
      const result = failure ? JSON.stringify({ error: failure.error, code: failure.code, details: failure.details || null }) : contentText(event.result?.content);
      const payload = { call_id: event.toolCallId, name: this.toolName(event.toolName), result, error: Boolean(event.isError),
        ...(event.isError ? { code: failure?.code || event.result?.details?.code || 'RUNTIME_ERROR' } : {}) };
      this.emit('tool.result', payload);
      this.emit(event.isError ? 'tool_call.failed' : 'tool_call.completed', payload);
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      if (this.streaming) this.emit('llm.stream.end', { mode: 'decision_stream' });
      const calls = event.message.content.filter((part) => part.type === 'toolCall');
      const text = contentText(event.message.content);
      if (text) this.mark('first_token_ms');
      if (!['error', 'aborted'].includes(event.message.stopReason)) {
        this.emit('llm.final', { decision: calls.length
          ? { type: 'tool', tools: calls.map((call) => ({ name: this.toolName(call.name), args: call.arguments })) }
          : { type: 'final', preview: text.slice(0, 160) }, streamed: this.streaming, stream_meta: null });
      }
    } else if (event.type === 'compaction_start' || event.type === 'compaction_end') {
      this.emit(`pi.${event.type}`, { reason: event.reason || null, aborted: event.aborted || false, error: event.errorMessage || null });
    }
  }

  finish(output, state = 'DONE') {
    this.mark('final_ms');
    const result = { output, state, traceId: this.traceId, metrics: { ...this.metrics } };
    this.emit('done', { output, state, metrics: result.metrics });
    this.bus?.publish('runtime.final', { session_id: this.sessionId, trace_id: this.traceId, output, state, metrics: result.metrics });
    return result;
  }
}

module.exports = { EventBridge, contentText };
