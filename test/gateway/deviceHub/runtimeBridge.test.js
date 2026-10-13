const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { EventBridge } = require('../../../apps/runtime/agent-pi/eventBridge');
const { fixture } = require('./helpers');

test('Runtime bridge maps chat, aggregates tools and prevents publication loops', async (t) => {
  const bus = new RuntimeEventBus();
  const runs = [];
  const f = await fixture(t, { bus, enqueueRun: async (sink, request) => { runs.push(request); sink.send(JSON.stringify({ method: 'runtime.final', params: { session_id: request.params.session_id, trace_id: 'r', output: 'done' } })); } });
  const a = await f.client('phone'); const b = await f.client('desktop-test', { device_type: 'desktop' });
  a.send('sub', { topics: ['*'] }); b.send('sub', { topics: ['*'] }); await a.sync(); await b.sync();
  bus.publish('ui.live2d.action', { action_id: 'one' });
  await b.next((m) => m.topic === 'ui.live2d.action'); await a.sync();
  assert.equal(a.inbox.some((m) => m.topic === 'ui.live2d.action'), false);
  bus.publish('message.delta', { session_id: 'device-phone', trace_id: 'r', delta: 'hello' });
  assert.equal((await a.next((m) => m.topic === 'chat.delta')).data.delta, 'hello');
  const envelope = { session_id: 'device-phone', trace_id: 'r', seq: 1, event: 'llm.stream.delta', payload: { delta: 'world' } };
  bus.publish('runtime.event', envelope); bus.publish('runtime.event', envelope);
  await a.next((m) => m.topic === 'chat.delta'); await a.sync();
  assert.equal(a.inbox.some((m) => m.topic === 'chat.delta'), false);
  bus.publish('runtime.event', {
    session_id: 'device-phone', trace_id: 'ui-trace', seq: 2, event: 'ui.chat.post',
    payload: { message_id: 'msg-1', text: 'explicit reply', format: 'markdown', bubble: true }
  });
  assert.equal((await a.next((m) => m.topic === 'ui.chat.post')).data.text, 'explicit reply');
  bus.publish('runtime.event', {
    session_id: 'device-phone', trace_id: 'hidden', seq: 3, event: 'llm.stream.delta',
    payload: { delta: 'internal only', ui_hidden: true }
  });
  bus.publish('runtime.final', { session_id: 'device-phone', trace_id: 'hidden', output: 'internal only', ui_hidden: true });
  await a.sync();
  assert.equal(a.inbox.some((m) => m.topic === 'chat.delta' || m.topic === 'chat.final'), false);
  let count = 0; bus.subscribe('plugin.demo.tick', (data) => { count++; assert.equal(data.__from_device, 'phone'); });
  a.send('pub', { value: 1 }, { topic: 'plugin.demo.tick' }); await a.sync();
  assert.equal(count, 1);
  assert.equal(a.inbox.filter((m) => m.topic === 'plugin.demo.tick').length, 1);
  a.send('pub', { text: 'hi', session_id: 'another-session', model_ref: 'qwen/qwen3.8-omni-flash' }, { topic: 'chat.input' });
  assert.equal((await a.next((m) => m.topic === 'chat.final')).data.output, 'done');
  assert.equal(runs[0].params.session_id, 'device-phone');
  assert.equal(runs[0].params.model_ref, 'qwen/qwen3.8-omni-flash');
  bus.publish('runtime.event', { session_id: 'desktop', trace_id: 'legacy', seq: 3, event: 'done', payload: { output: 'complete' } });
  bus.publish('runtime.final', { session_id: 'desktop', trace_id: 'legacy', output: 'complete' });
  assert.equal((await a.next((m) => m.topic === 'chat.final')).data.output, 'complete');
  await a.sync(); assert.equal(a.inbox.some((m) => m.topic === 'chat.final'), false);
  bus.publish('tool_call.started', { trace_id: 'r', call_id: 'a', name: 'weather' });
  assert.equal((await a.next((m) => m.topic === 'task.update')).data.status, 'running');
  bus.publish('tool_call.completed', { trace_id: 'r', call_id: 'a', name: 'weather' });
  assert.equal((await a.next((m) => m.topic === 'task.update')).data.status, 'done');
  bus.publish('tool.call.result', { trace_id: 'r', call_id: 'a', name: 'weather', ok: false });
  assert.equal((await a.next((m) => m.topic === 'task.update')).data.status, 'failed');
});

test('Runtime bridge relays real pi deltas once and never reports failed tools as done', async (t) => {
  const bus = new RuntimeEventBus();
  const f = await fixture(t, { bus });
  const phone = await f.client('phone');
  phone.send('sub', { topics: ['chat.**', 'task.**'] });
  await phone.sync();

  const bridge = new EventBridge({ bus, sessionId: 'device-phone', streaming: true });
  bridge.accept({ type: 'turn_start' });
  bridge.accept({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'only once' }
  });
  assert.equal((await phone.next((message) => message.topic === 'chat.delta')).data.delta, 'only once');
  await phone.sync();
  assert.equal(phone.inbox.filter((message) => message.topic === 'chat.delta').length, 0);

  bridge.accept({ type: 'tool_execution_start', toolCallId: 'call-fail', toolName: 'demo_tool', args: {} });
  bridge.accept({
    type: 'tool_execution_end',
    toolCallId: 'call-fail',
    toolName: 'demo_tool',
    isError: true,
    result: { content: [{ type: 'text', text: 'failed' }], details: { code: 'RUNTIME_ERROR' } }
  });
  await phone.sync();
  const statuses = phone.inbox
    .filter((message) => message.topic === 'task.update')
    .map((message) => message.data.status);
  assert.equal(statuses.includes('running'), true);
  assert.equal(statuses.includes('failed'), true);
  assert.equal(statuses.includes('done'), false);
});

test('Runtime bridge forwards approval requests and scopes phone decisions to its session', async (t) => {
  const bus = new RuntimeEventBus();
  const decisions = [];
  const approvalCoordinator = {
    decide(decision) {
      decisions.push(decision);
      return decision.approvalId === 'apr-phone' && decision.sessionId === 'device-phone';
    }
  };
  const f = await fixture(t, { bus, approvalCoordinator });
  const phone = await f.client('phone');
  phone.send('sub', { topics: ['approval.**'] });
  await phone.sync();

  bus.publish('approval.requested', {
    approval_id: 'apr-phone',
    session_id: 'device-phone',
    command: 'pwd'
  });
  const request = await phone.next((message) => message.topic === 'approval.requested');
  assert.equal(request.data.approval_id, 'apr-phone');

  phone.send('pub', { approval_id: 'apr-phone', approved: true, scope: 'once' }, {
    topic: 'approval.decision'
  });
  await phone.sync();
  assert.deepEqual(decisions[0], {
    approvalId: 'apr-phone',
    sessionId: 'device-phone',
    approved: true,
    scope: 'once'
  });
});

test('Device session control RPC isolates settings and approvals by authenticated device', async (t) => {
  const bus = new RuntimeEventBus();
  const settings = new Map();
  const decisions = [];
  const pending = [
    { approval_id: 'apr-phone', session_id: 'device-phone', command: 'pwd' },
    { approval_id: 'apr-other', session_id: 'device-other', command: 'whoami' }
  ];
  const sessionStore = {
    async getSessionSettings(sessionId) { return settings.get(sessionId) || null; },
    async updateSessionSettings(sessionId, patch) {
      const value = { permission_level: 'high', approval_mode: 'manual', ...(settings.get(sessionId) || {}), ...patch };
      settings.set(sessionId, value);
      return value;
    }
  };
  const approvalCoordinator = {
    list({ sessionId }) { return pending.filter((entry) => entry.session_id === sessionId); },
    decide(decision) {
      decisions.push(decision);
      return decision.approvalId === 'apr-phone' && decision.sessionId === 'device-phone';
    }
  };
  const f = await fixture(t, { bus, sessionStore, approvalCoordinator });
  const phone = await f.client('phone');
  let rpcIndex = 0;
  const rpc = async (method, params = {}) => {
    const id = `rpc-${++rpcIndex}`;
    phone.send('rpc.req', { method, params }, { id });
    const response = await phone.next((message) => message.type === 'rpc.res' && message.id === id);
    if (response.data.error) throw Object.assign(new Error(response.data.error.message), response.data.error);
    return response.data.result;
  };

  assert.equal((await rpc('session.settings.get')).approval_mode, 'manual');
  assert.equal((await rpc('session.settings.update', { approval_mode: 'auto_approve' })).approval_mode, 'auto_approve');
  assert.equal(settings.get('device-phone').approval_mode, 'auto_approve');
  assert.equal(settings.has('device-other'), false);
  await assert.rejects(rpc('session.settings.update', { approval_mode: 'unsafe' }), /manual\|auto_approve\|full_access/);

  const visible = await rpc('approval.pending.list');
  assert.deepEqual(visible.map((entry) => entry.approval_id), ['apr-phone']);
  await assert.rejects(rpc('approval.decision', { approval_id: 'apr-other', approved: true }), /not found/);
  const decided = await rpc('approval.decision', { approval_id: 'apr-phone', approved: true, scope: 'always' });
  assert.deepEqual(decided, { approval_id: 'apr-phone', approved: true, scope: 'always' });
  assert.deepEqual(decisions.at(-1), {
    approvalId: 'apr-phone',
    sessionId: 'device-phone',
    approved: true,
    scope: 'always'
  });
});
