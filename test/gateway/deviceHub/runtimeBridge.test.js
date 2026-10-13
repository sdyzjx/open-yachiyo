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
