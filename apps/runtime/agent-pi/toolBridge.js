const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const ONLINE_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function encodeToolName(name) {
  const original = String(name || '');
  if (!original) throw new Error('Tool name is required');
  if (ONLINE_TOOL_NAME.test(original)) return original;
  let encoded = '';
  for (const char of original) {
    if (/^[a-zA-Z0-9_-]$/.test(char)) encoded += char;
    else if (char === '.') encoded += '__';
    else for (const byte of Buffer.from(char)) encoded += `_x${byte.toString(16).padStart(2, '0')}`;
  }
  if (encoded.length > 64) encoded = `tool_${createHash('sha256').update(original).digest('hex').slice(0, 48)}`;
  if (!ONLINE_TOOL_NAME.test(encoded)) throw new Error(`Unable to encode tool name: ${original}`);
  return encoded;
}

function allocateToolName(originalName, onlineNames) {
  const preferred = encodeToolName(originalName);
  if (!onlineNames.has(preferred)) {
    onlineNames.set(preferred, originalName);
    return preferred;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = createHash('sha256').update(`${originalName}\0${attempt}`).digest('hex').slice(0, 12);
    const candidate = `${preferred.slice(0, 51)}_${suffix}`;
    if (!onlineNames.has(candidate)) {
      onlineNames.set(candidate, originalName);
      return candidate;
    }
  }
  throw new Error(`Unable to allocate collision-free tool name: ${originalName}`);
}

function textResult(value, details = {}) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) ?? '' }], details };
}

function toolExecutionMode(definition = {}) {
  const sideEffectLevel = String(definition.side_effect_level || '').trim().toLowerCase();
  if (definition.requires_lock) return 'sequential';
  return sideEffectLevel === 'none' || sideEffectLevel === 'read' ? 'parallel' : 'sequential';
}

function bridgeTools({ executor, bus, context = {}, onlineNames = new Map(), approvalCoordinator = null }) {
  const originalNames = new Set();
  return executor.listTools().filter((definition) => definition.name !== 'shell.approve').map((definition) => {
    if (originalNames.has(definition.name)) throw new Error(`Duplicate tool name: ${definition.name}`);
    originalNames.add(definition.name);
    const name = allocateToolName(definition.name, onlineNames);
    return {
      name,
      originalName: definition.name,
      label: definition.name,
      description: definition.description || definition.name,
      parameters: definition.input_schema || { type: 'object', properties: {} },
      // Pi batches parallel tools concurrently. Unknown/write tools remain conservative;
      // an explicit lock always serializes the full provider-requested batch.
      executionMode: toolExecutionMode(definition),
      async execute(callId, args, signal) {
        signal?.throwIfAborted();
        const current = typeof context === 'function' ? context() : context;
        const meta = { ...current, call_id: callId };
        const execute = () => executor.execute({ name: definition.name, args }, {
          ...meta, bus, workspaceRoot: current.workspace_root || process.cwd(),
          signal,
          publishEvent: (topic, payload = {}) => bus?.publish(topic, {
            ...payload, trace_id: current.trace_id, session_id: current.session_id,
            step_index: current.step_index, call_id: callId, tool_name: definition.name
          })
        });
        let result = await execute();
        if (approvalCoordinator) result = await approvalCoordinator.coordinate({
          result, execute, context: current, signal, toolName: definition.name
        });
        if (!result.ok) {
          current.reportToolError?.(callId, result);
          const detail = result.details ? ` details=${JSON.stringify(result.details)}` : '';
          const error = new Error(`${result.code ? `[${result.code}] ` : ''}${result.error || 'Tool execution failed'}${detail}`);
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
    };
  });
}

module.exports = { bridgeTools, textResult, toolExecutionMode, encodeToolName, allocateToolName, ONLINE_TOOL_NAME };
