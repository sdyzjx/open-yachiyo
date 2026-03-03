const { publishChainEvent } = require('../bus/chainDebug');

class ToolCallDispatcher {
  constructor({ bus, executor, dedupTtlMs = 5 * 60 * 1000 }) {
    this.bus = bus;
    this.executor = executor;
    this.unsubscribe = null;
    this.dedupTtlMs = Math.max(1000, Number(dedupTtlMs) || 5 * 60 * 1000);
    this.completedCalls = new Map();
    this.inflightCalls = new Map();
  }

  buildDedupKey(traceId, callId) {
    const t = String(traceId || '').trim();
    const c = String(callId || '').trim();
    if (!t || !c) return '';
    return `${t}:${c}`;
  }

  cleanupDedupCache(now = Date.now()) {
    for (const [key, entry] of this.completedCalls.entries()) {
      if (!entry || !Number.isFinite(Number(entry.expiresAt)) || Number(entry.expiresAt) <= now) {
        this.completedCalls.delete(key);
      }
    }
  }

  buildResultPayload(result) {
    if (!result || typeof result !== 'object') {
      return {
        ok: false,
        error: 'tool dispatcher received invalid result payload'
      };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        code: result.code,
        details: result.details,
        metrics: result.metrics
      };
    }
    return {
      ok: true,
      result: result.result,
      metrics: result.metrics
    };
  }

  async handleDispatch(payload) {
    const {
      trace_id: traceId,
      session_id: sessionId,
      step_index: stepIndex,
      call_id: callId,
      workspace_root: workspaceRoot,
      permission_level: permissionLevel,
      tool,
      meta
    } = payload;

    const base = {
      trace_id: traceId,
      session_id: sessionId,
      step_index: stepIndex,
      call_id: callId,
      name: tool.name
    };

    const dedupKey = this.buildDedupKey(traceId, callId);
    const now = Date.now();
    if (dedupKey) {
      this.cleanupDedupCache(now);
      const cached = this.completedCalls.get(dedupKey);
      if (cached?.payload) {
        publishChainEvent(this.bus, 'dispatch.dedup.hit', {
          trace_id: traceId,
          session_id: sessionId,
          step_index: stepIndex,
          call_id: callId,
          tool_name: tool.name,
          source: 'cache'
        });
        this.bus.publish('tool.call.result', {
          ...base,
          ...cached.payload,
          dedup_hit: true
        });
        return;
      }

      const inflight = this.inflightCalls.get(dedupKey);
      if (inflight?.promise) {
        publishChainEvent(this.bus, 'dispatch.dedup.hit', {
          trace_id: traceId,
          session_id: sessionId,
          step_index: stepIndex,
          call_id: callId,
          tool_name: tool.name,
          source: 'inflight'
        });
        const inflightPayload = await inflight.promise;
        this.bus.publish('tool.call.result', {
          ...base,
          ...inflightPayload,
          dedup_hit: true
        });
        return;
      }
    }

    publishChainEvent(this.bus, 'dispatch.received', {
      trace_id: traceId,
      session_id: sessionId,
      step_index: stepIndex,
      call_id: callId,
      tool_name: tool.name
    });

    this.bus.publish('tool.call.dispatched', { ...base, args: tool.args });

    const executePromise = (async () => {
      try {
        const result = await this.executor.execute(tool, {
          permission_level: permissionLevel || null,
          workspace_root: workspaceRoot || null,
          meta: {
            ...(meta || {}),
            trace_id: traceId,
            session_id: sessionId,
            step_index: stepIndex,
            call_id: callId,
            permission_level: permissionLevel || null,
            workspace_root: workspaceRoot || null
          },
          workspaceRoot: workspaceRoot || process.cwd(),
          bus: this.bus,
          publishEvent: (topic, eventPayload = {}) => {
            this.bus.publish(topic, {
              trace_id: traceId,
              session_id: sessionId,
              step_index: stepIndex,
              call_id: callId,
              tool_name: tool.name,
              ...eventPayload
            });
          }
        });
        return this.buildResultPayload(result);
      } catch (err) {
        return this.buildResultPayload({
          ok: false,
          error: err?.message || String(err || 'unknown tool execution error')
        });
      }
    })();

    if (dedupKey) {
      this.inflightCalls.set(dedupKey, { startedAt: now, promise: executePromise });
    }

    const resultPayload = await executePromise;
    if (!resultPayload.ok) {
      publishChainEvent(this.bus, 'dispatch.completed', {
        trace_id: traceId,
        session_id: sessionId,
        step_index: stepIndex,
        call_id: callId,
        tool_name: tool.name,
        ok: false,
        code: resultPayload.code || null
      });
    } else {
      publishChainEvent(this.bus, 'dispatch.completed', {
        trace_id: traceId,
        session_id: sessionId,
        step_index: stepIndex,
        call_id: callId,
        tool_name: tool.name,
        ok: true
      });
    }

    if (dedupKey) {
      this.completedCalls.set(dedupKey, {
        expiresAt: now + this.dedupTtlMs,
        payload: resultPayload
      });
      this.inflightCalls.delete(dedupKey);
    }

    this.bus.publish('tool.call.result', {
      ...base,
      ...resultPayload
    });
  }

  start() {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe('tool.call.requested', async (payload) => {
      await this.handleDispatch(payload);
    });
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.inflightCalls.clear();
    this.completedCalls.clear();
  }
}

module.exports = { ToolCallDispatcher };
