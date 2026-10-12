const { createPiRuntime } = require('./piRuntime');

function createGatewayRunner({ core = process.env.AGENT_CORE || 'pi', legacyFactory, ...deps }) {
  if (core === 'legacy') return legacyFactory();
  if (core !== 'pi') throw new Error(`Invalid AGENT_CORE: ${core}`);
  let runtime;
  return {
    runtimeStreamingEnabled: deps.runtimeStreamingEnabled !== false,
    toolAsyncMode: 'serial', toolEarlyDispatch: false, maxParallelTools: 1,
    toolErrorMaxRetries: deps.toolErrorMaxRetries || 5,
    async run(args) {
      runtime ||= createPiRuntime({ ...deps, mirrorHistory: false }).catch((error) => {
        runtime = null;
        throw error;
      });
      return (await runtime).run(args);
    }
  };
}

// C4 model_ref is not forwarded by the existing read-only worker. Adapt its
// context hook at assembly time without changing worker or wire semantics.
function attachModelContext(worker) {
  const processEnvelope = worker.processEnvelope.bind(worker);
  worker.processEnvelope = (envelope) => {
    const context = envelope.context || {};
    return processEnvelope({ ...envelope, context: { ...context,
      buildRunContext: async (args) => ({
        ...await context.buildRunContext?.(args),
        ...(envelope.request?.params?.model_ref ? { model_ref: envelope.request.params.model_ref } : {})
      })
    } });
  };
  return worker;
}

module.exports = { createGatewayRunner, attachModelContext };
