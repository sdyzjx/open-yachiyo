const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

function wrapDefinition(definition, context) {
  const execute = definition.execute.bind(definition);
  return {
    ...definition,
    executionMode: READ_ONLY_TOOLS.has(definition.name) ? 'parallel' : 'sequential',
    async execute(callId, args, signal, onUpdate, toolContext) {
      try {
        return await execute(callId, args, signal, onUpdate, toolContext);
      } catch (error) {
        context().reportToolError?.(callId, {
          code: error?.code || 'RUNTIME_ERROR',
          error: String(error?.message || error)
        });
        throw error;
      }
    }
  };
}

function createStandardTools({ sdk, cwd, context }) {
  const current = () => context() || {};
  const definitions = [
    sdk.createReadToolDefinition(cwd),
    sdk.createBashToolDefinition(cwd),
    sdk.createEditToolDefinition(cwd),
    sdk.createWriteToolDefinition(cwd),
    sdk.createGrepToolDefinition(cwd),
    sdk.createFindToolDefinition(cwd),
    sdk.createLsToolDefinition(cwd)
  ];
  return definitions.map((definition) => wrapDefinition(definition, current));
}

module.exports = { createStandardTools };
