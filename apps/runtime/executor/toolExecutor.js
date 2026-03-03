const { compose } = require('../tooling/toolPipeline');
const { ToolingError, ErrorCode } = require('../tooling/errors');
const { resolveTool } = require('../tooling/middlewares/resolveTool');
const { validateSchema } = require('../tooling/middlewares/validateSchema');
const { enforcePolicy } = require('../tooling/middlewares/enforcePolicy');
const { auditLog } = require('../tooling/middlewares/auditLog');
const { publishChainEvent } = require('../bus/chainDebug');

function isRegistryObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) && !obj.get && !obj.list;
}

function buildMeta(context = {}) {
  return {
    ...(context.meta || {}),
    trace_id: context.trace_id || context.meta?.trace_id || null,
    session_id: context.session_id || context.meta?.session_id || null,
    step_index: context.step_index ?? context.meta?.step_index ?? null,
    call_id: context.call_id || context.meta?.call_id || null,
    permission_level: context.permission_level || context.meta?.permission_level || null,
    workspace_root: context.workspace_root || context.meta?.workspace_root || null
  };
}

class ToolExecutor {
  constructor(registryOrToolRegistry, opts = {}) {
    if (isRegistryObject(registryOrToolRegistry)) {
      this.legacyRegistry = registryOrToolRegistry;
      this.registry = {
        get: (name) => {
          const t = this.legacyRegistry[name];
          return t ? { name, ...t } : null;
        },
        list: () => Object.entries(this.legacyRegistry).map(([name, tool]) => ({
          name,
          type: tool.type || 'local',
          description: tool.description || '',
          input_schema: tool.input_schema || { type: 'object', properties: {}, additionalProperties: true },
          side_effect_level: tool.side_effect_level || null,
          requires_lock: Boolean(tool.requires_lock)
        }))
      };
      this.policy = { allow: [], deny: [], byProvider: {} };
      this.execConfig = { security: 'allowlist', safeBins: [], timeoutSec: 20, maxOutputChars: 8000, workspaceOnly: true };
    } else {
      this.registry = registryOrToolRegistry;
      this.policy = opts.policy || { allow: [], deny: [], byProvider: {} };
      this.execConfig = opts.exec || { security: 'allowlist', safeBins: [], timeoutSec: 20, maxOutputChars: 8000, workspaceOnly: true };
    }

    this.pipeline = compose([
      auditLog,
      resolveTool,
      validateSchema,
      enforcePolicy,
      async (ctx) => {
        const meta = ctx.meta || {};
        ctx.result = await ctx.tool.run(ctx.request.args || {}, {
          workspaceRoot: ctx.workspaceRoot,
          security: this.execConfig.security,
          safeBins: this.execConfig.safeBins,
          timeoutSec: this.execConfig.timeoutSec,
          maxOutputChars: this.execConfig.maxOutputChars,
          workspaceOnly: this.execConfig.workspaceOnly,
          trace_id: meta.trace_id || null,
          session_id: meta.session_id || null,
          step_index: meta.step_index ?? null,
          call_id: meta.call_id || null,
          permission_level: meta.permission_level || null,
          workspace_root: meta.workspace_root || null,
          publishEvent: ctx.publishEvent || null,
          bus: ctx.bus || null
        });
      }
    ]);
  }

  listTools() {
    return this.registry.list();
  }

  async execute(toolCall, context = {}) {
    const ctx = {
      request: {
        name: toolCall.name,
        args: toolCall.args || {}
      },
      meta: buildMeta(context),
      workspaceRoot: context.workspaceRoot || process.cwd(),
      publishEvent: context.publishEvent || null,
      bus: context.bus || null,
      registry: this.registry,
      policy: this.policy,
      result: null,
      metrics: {}
    };

    try {
      publishChainEvent(ctx.bus, 'executor.start', {
        trace_id: ctx.meta.trace_id,
        session_id: ctx.meta.session_id,
        step_index: ctx.meta.step_index,
        call_id: ctx.meta.call_id,
        tool_name: toolCall?.name || null
      });
      await this.pipeline(ctx);
      publishChainEvent(ctx.bus, 'executor.completed', {
        trace_id: ctx.meta.trace_id,
        session_id: ctx.meta.session_id,
        step_index: ctx.meta.step_index,
        call_id: ctx.meta.call_id,
        tool_name: toolCall?.name || null,
        ok: true
      });
      return { ok: true, result: String(ctx.result), metrics: ctx.metrics };
    } catch (e) {
      publishChainEvent(ctx.bus, 'executor.completed', {
        trace_id: ctx.meta.trace_id,
        session_id: ctx.meta.session_id,
        step_index: ctx.meta.step_index,
        call_id: ctx.meta.call_id,
        tool_name: toolCall?.name || null,
        ok: false,
        code: e?.code || ErrorCode.RUNTIME_ERROR,
        error: e?.message || String(e)
      });
      if (e instanceof ToolingError) {
        return {
          ok: false,
          error: e.message,
          code: e.code,
          details: e.details,
          metrics: ctx.metrics
        };
      }

      return {
        ok: false,
        error: e.message || String(e),
        code: ErrorCode.RUNTIME_ERROR,
        metrics: ctx.metrics
      };
    }
  }
}

module.exports = { ToolExecutor };
