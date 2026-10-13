const { randomUUID } = require('node:crypto');
const { fault } = require('./hub');

function attachRuntimeBridge({ hub, bus, enqueueRun, approvalCoordinator }) {
  const tasks = new Map();
  const seen = new Set();
  const pendingDeltaAliases = new Map();
  const mark = (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 2048) seen.delete(seen.values().next().value);
    return true;
  };
  const sendChat = (topic, payload) => hub.publish(topic, payload);
  const deltaKey = (data) => JSON.stringify([
    data.session_id || null,
    data.trace_id || null,
    data.step_index ?? null,
    data.delta || ''
  ]);
  const relayDelta = (data, { expectCanonicalAlias = false } = {}) => {
    const key = deltaKey(data);
    if (!expectCanonicalAlias) {
      const count = pendingDeltaAliases.get(key) || 0;
      if (count > 0) {
        if (count === 1) pendingDeltaAliases.delete(key);
        else pendingDeltaAliases.set(key, count - 1);
        return;
      }
    } else {
      pendingDeltaAliases.set(key, (pendingDeltaAliases.get(key) || 0) + 1);
      queueMicrotask(() => {
        const count = pendingDeltaAliases.get(key) || 0;
        if (count <= 1) pendingDeltaAliases.delete(key);
        else pendingDeltaAliases.set(key, count - 1);
      });
    }
    sendChat('chat.delta', {
      session_id: data.session_id,
      trace_id: data.trace_id,
      delta: data.delta
    });
  };
  const aggregate = (topic, data) => {
    const payload = data.payload || data;
    const failed = data.ok === false
      || payload.ok === false
      || data.error === true
      || payload.error === true
      || (typeof data.error === 'string' && data.error)
      || (typeof payload.error === 'string' && payload.error)
      || /failed|error/.test(topic);
    const status = failed ? 'failed' : /completed|result/.test(topic) ? 'done' : 'running';
    const taskId = data.trace_id || data.task_id || data.session_id;
    if (!taskId) return;
    const name = payload.name || payload.tool_name || payload.tool?.name || 'tool';
    const stepId = payload.call_id || payload.tool_call_id || `${data.step_index || 0}:${name}`;
    const task = tasks.get(taskId) || { task_id: taskId, title: 'Agent tools', steps: new Map() };
    task.steps.set(stepId, { name, status });
    tasks.set(taskId, task);
    if (tasks.size > 128) tasks.delete(tasks.keys().next().value);
    const steps = [...task.steps.values()];
    hub.publish('task.update', { task_id: taskId, title: task.title, status: steps.some((s) => s.status === 'failed') ? 'failed' : steps.some((s) => s.status === 'running') ? 'running' : 'done', steps, updated_at: Date.now() });
  };
  const handle = (topic, data = {}) => {
    if (!data || typeof data !== 'object' || data.__from_device) return; // Publications were already delivered by the Hub.
    if (/^(ui|client|voice|avatar|task|plugin|sys|approval)\./.test(topic)) hub.publish(topic, data, { from: 'runtime', target: data.__target });
    if (topic === 'message.delta') relayDelta(data);
    if (topic === 'runtime.final' && (!data.trace_id || mark(`final:${data.session_id}:${data.trace_id}`))) sendChat('chat.final', { session_id: data.session_id, trace_id: data.trace_id, output: data.output });
    if (/^tool[._]call\.(requested|started|dispatched|completed|failed|result)$/.test(topic)) aggregate(topic, data);
    if (topic === 'runtime.event') {
      if (data.seq != null && !mark(`${data.session_id}:${data.trace_id}:${data.seq}`)) return;
      if (data.event === 'done') handle('runtime.final', { ...data, output: data.payload?.output || '' });
      if (data.event === 'llm.stream.delta') relayDelta({ ...data, delta: data.payload?.delta || '' }, { expectCanonicalAlias: true });
      if (data.event === 'llm.final' && !data.payload?.streamed && data.payload?.decision?.type === 'final') handle('message.delta', { ...data, delta: data.payload.decision.preview || '' });
      if (/^tool[._]call\.(requested|started|dispatched|completed|failed|result)$/.test(data.event || '') || data.event === 'tool.result') aggregate(data.event, data);
    }
  };
  hub.runInput = async (device, { text, input_audio, model_ref } = {}) => {
    if (typeof text !== 'string' || !text.trim()) throw fault(-32602, 'Non-empty text required');
    if (!enqueueRun) throw fault(-32601, 'Runtime unavailable');
    const request = { jsonrpc: '2.0', id: randomUUID(), method: 'runtime.run', params: { session_id: `device-${device.device_id}`, input: text, ...(input_audio ? { input_audio } : {}), ...(typeof model_ref === 'string' && model_ref.trim() ? { model_ref: model_ref.trim() } : {}) } };
    // Reuse gateway persistence, permission and queue hooks via a WS-compatible sink.
    const sink = { readyState: 1, send(raw) {
      const msg = JSON.parse(raw);
      if (msg.method === 'runtime.final') handle(msg.method, msg.params);
      if (msg.error) hub.send(device.ws, 'error', { ...msg.error, ref_id: request.id });
    } };
    await enqueueRun(sink, request, 'rpc');
  };
  const publication = ({ topic, data, device }) => {
    if (/^(plugin|device|avatar|audio|chat|sys)\./.test(topic)) bus.publish(topic, { ...data, __from_device: device.device_id });
    if (topic === 'chat.input') hub.runInput(device, data).catch((err) => hub.send(device.ws, 'error', { code: err.code || -32600, message: err.message }));
    if (topic === 'approval.decision') {
      const sessionId = `device-${device.device_id}`;
      const decided = approvalCoordinator?.decide({
        approvalId: data.approval_id,
        sessionId,
        approved: data.approved === true,
        scope: data.scope
      });
      if (!decided) hub.send(device.ws, 'error', { code: -32602, message: 'approval not found for this device session' });
    }
  };
  const off = bus.subscribe('*', handle);
  hub.on('publication', publication);
  hub.once('shutdown', () => { off(); hub.off('publication', publication); });
  return { handle, tasks };
}
module.exports = { attachRuntimeBridge };
