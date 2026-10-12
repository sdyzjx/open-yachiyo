const fs = require('node:fs/promises');

function textResult(value, details = {}) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) ?? '' }], details };
}

function bridgeTools({ executor, bus, context = {} }) {
  return executor.listTools().map((definition) => ({
    name: definition.name,
    label: definition.name,
    description: definition.description || definition.name,
    parameters: definition.input_schema || { type: 'object', properties: {} },
    // Existing tools share workspace and voice/avatar state.
    executionMode: 'sequential',
    async execute(callId, args, signal) {
      signal?.throwIfAborted();
      const current = typeof context === 'function' ? context() : context;
      const meta = { ...current, call_id: callId };
      const result = await executor.execute({ name: definition.name, args }, {
        ...meta, bus, workspaceRoot: current.workspace_root || process.cwd(),
        publishEvent: (topic, payload = {}) => bus?.publish(topic, {
          ...payload, trace_id: current.trace_id, session_id: current.session_id,
          step_index: current.step_index, call_id: callId, tool_name: definition.name
        })
      });
      if (!result.ok) {
        current.reportToolError?.(callId, result);
        const error = new Error(result.error || 'Tool execution failed');
        error.code = result.code;
        error.details = result.details;
        throw error;
      }
      const response = textResult(result.result, { ...result });
      if (definition.name.startsWith('desktop.capture.') && definition.name !== 'desktop.capture.delete') {
        let artifact;
        try { artifact = JSON.parse(result.result); } catch { /* Non-artifact output remains text. */ }
        if (artifact?.capture_id && artifact.path) {
          try {
            const data = await fs.readFile(artifact.path);
            response.content.push({ type: 'image', data: data.toString('base64'), mimeType: artifact.mime_type || 'image/png' });
          } catch {
            response.content.push({ type: 'text', text: 'Screenshot attachment unavailable; do not infer screen content from the path.' });
          }
        }
      }
      return response;
    }
  }));
}

module.exports = { bridgeTools, textResult };
