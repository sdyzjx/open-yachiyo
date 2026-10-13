const { createPiRuntime } = require('./piRuntime');

function createGatewayRunner({ core = process.env.AGENT_CORE || 'pi', legacyFactory, ...deps }) {
  if (core === 'legacy') return legacyFactory();
  if (core !== 'pi') throw new Error(`Invalid AGENT_CORE: ${core}`);
  let runtime;
  return {
    runtimeStreamingEnabled: deps.runtimeStreamingEnabled !== false,
    toolAsyncMode: 'parallel', toolEarlyDispatch: false, maxParallelTools: null,
    toolErrorMaxRetries: deps.toolErrorMaxRetries || 5,
    supportsNativeQueueing: true,
    async run(args) {
      runtime ||= createPiRuntime({ ...deps, mirrorHistory: false }).catch((error) => {
        runtime = null;
        throw error;
      });
      return (await runtime).run(args);
    },
    async dispose() {
      if (!runtime) return;
      const active = await runtime;
      runtime = null;
      await active.dispose?.();
    }
  };
}

// Kept temporarily for the gateway assembly import. RuntimeRpcWorker now
// forwards model_ref itself, so wrapping it here would duplicate that logic.
function attachModelContext(worker) {
  return worker;
}

module.exports = { createGatewayRunner, attachModelContext };
