const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ToolExecutor } = require('../../../apps/runtime/executor/toolExecutor');
const { bridgeTools, toolExecutionMode } = require('../../../apps/runtime/agent-pi/toolBridge');

test('TC-PI-005 bridge preserves schema, permission, trace, workspace and publishEvent', async () => {
  let received;
  const events = [];
  const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] };
  const executor = new ToolExecutor({ echo: { input_schema: schema, run: (args, ctx) => {
    received = ctx;
    ctx.publishEvent('ui.test', { value: args.value });
    return args.value;
  } } });
  const [tool] = bridgeTools({ executor, bus: { publish: (...args) => events.push(args) }, context: {
    trace_id: 'trace', session_id: 'session', step_index: 2, permission_level: 'low', workspace_root: '/workspace'
  } });
  assert.equal(tool.parameters, schema);
  assert.equal((await tool.execute('call', { value: 'hello' })).content[0].text, 'hello');
  assert.equal(received.workspaceRoot, '/workspace');
  assert.equal(received.permission_level, 'low');
  assert.equal(received.call_id, 'call');
  assert.equal(events.find(([topic]) => topic === 'ui.test')[1].trace_id, 'trace');
  await assert.rejects(tool.execute('bad', {}), /invalid tool args/i);
});

test('TC-PI-006 permission rejection becomes a pi tool error without executing', async () => {
  let called = false;
  const executor = new ToolExecutor({ memory_write: { run: () => { called = true; return 'bad'; } } });
  const [tool] = bridgeTools({ executor, context: { permission_level: 'low' } });
  await assert.rejects(tool.execute('call', {}), /not allowed for permission level/);
  assert.equal(called, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tool.execute('call', {}, controller.signal), /abort/i);
});

test('TC-PI-043 Pi abort signal reaches a running executor tool', async () => {
  let receivedSignal;
  let started;
  const didStart = new Promise((resolve) => { started = resolve; });
  const executor = new ToolExecutor({ hold: { run: async (_args, context) => {
    receivedSignal = context.signal;
    started();
    await new Promise((resolve) => context.signal.addEventListener('abort', resolve, { once: true }));
    context.signal.throwIfAborted();
    return 'late';
  } } });
  const [tool] = bridgeTools({ executor });
  const controller = new AbortController();
  const running = tool.execute('call', {}, controller.signal);
  await didStart;
  controller.abort();
  await assert.rejects(running, /abort/i);
  assert.equal(receivedSignal, controller.signal);
});

test('TC-PI-043 abort releases Pi even when a tool adapter cannot cancel its side effect', async () => {
  let started;
  const didStart = new Promise((resolve) => { started = resolve; });
  const executor = new ToolExecutor({ hold: { run: () => {
    started();
    return new Promise(() => {});
  } } });
  const [tool] = bridgeTools({ executor });
  const controller = new AbortController();
  const running = tool.execute('call', {}, controller.signal);
  await didStart;
  controller.abort();
  await assert.rejects(running, /ABORTED.*tool execution aborted/);
});

test('TC-PI-007 desktop capture result includes an actual image block', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-capture-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'image.png');
  await fs.writeFile(file, Buffer.from('offline-image'));
  const executor = new ToolExecutor({ 'desktop.capture.screen': { run: () => JSON.stringify({ capture_id: 'c', path: file, mime_type: 'image/png' }) } });
  const [tool] = bridgeTools({ executor });
  const result = await tool.execute('call', {});
  assert.deepEqual(result.content[1], { type: 'image', data: Buffer.from('offline-image').toString('base64'), mimeType: 'image/png' });
});

test('TC-PI-026 model-visible tools exclude the approval capability', async () => {
  const executor = new ToolExecutor({
    'shell.exec': { run: () => 'ok' },
    'shell.approve': { run: () => 'ok' }
  });
  const tools = bridgeTools({ executor });
  assert.ok(tools.some((tool) => tool.originalName === 'shell.exec'));
  assert.equal(tools.some((tool) => tool.originalName === 'shell.approve'), false);
});

test('TC-PI-027 other tool failures keep their code and details in the error text', async () => {
  const { ToolingError, ErrorCode } = require('../../../apps/runtime/tooling/errors');
  const executor = new ToolExecutor({ broken: { run: () => { throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'boom', { hint: 'x' }); } } });
  const [tool] = bridgeTools({ executor });
  await assert.rejects(tool.execute('c', {}), (err) => /boom/.test(err.message) && /"hint":"x"/.test(err.message));
});

test('TC-PI-033 tool scheduling parallelizes safe reads and serializes writes or locks', () => {
  assert.equal(toolExecutionMode({ side_effect_level: 'none' }), 'parallel');
  assert.equal(toolExecutionMode({ side_effect_level: 'read' }), 'parallel');
  assert.equal(toolExecutionMode({ side_effect_level: 'read', requires_lock: true }), 'sequential');
  assert.equal(toolExecutionMode({ side_effect_level: 'write' }), 'sequential');
  assert.equal(toolExecutionMode({}), 'sequential');
  const executor = new ToolExecutor({
    inspect_a: { side_effect_level: 'read', run: () => 'a' },
    mutate_b: { side_effect_level: 'write', run: () => 'b' }
  });
  const tools = bridgeTools({ executor });
  assert.equal(tools.find((tool) => tool.name === 'inspect_a').executionMode, 'parallel');
  assert.equal(tools.find((tool) => tool.name === 'mutate_b').executionMode, 'sequential');
});
