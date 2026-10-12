const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DeviceTools } = require('../../../apps/runtime/agent-pi/deviceTools');

test('TC-PI-008 device tools refresh next snapshot and preserve in-flight definitions', async () => {
  const hub = new EventEmitter();
  let methods = [{ tool_name: 'mi6__device_vibrate', device_id: 'mi6', method: 'device.vibrate', params_schema: { type: 'object' } }];
  hub.listToolMethods = () => methods;
  hub.invoke = async (...args) => args;
  const bridge = new DeviceTools({ deviceHub: hub, policy: {
    allow: ['bus_publish', 'avatar_status', 'avatar_transfer'],
    deny: [],
    deviceHub: { allow: ['mi6__device_*'], deny: [] }
  } });
  const previous = bridge.snapshot({});
  methods = [];
  hub.emit('tools.changed');
  assert.equal(bridge.snapshot({}).some((tool) => tool.name === 'mi6__device_vibrate'), false);
  const result = await previous.find((tool) => tool.name === 'mi6__device_vibrate').execute('id', { ms: 10 });
  assert.deepEqual(JSON.parse(result.content[0].text), ['mi6', 'device.vibrate', { ms: 10 }, { timeoutMs: 8000 }]);
  bridge.dispose();
  assert.equal(hub.listenerCount('tools.changed'), 0);
});

test('TC-PI-008 dynamic Hub tools require explicit patterns and keep deny precedence', async () => {
  const methods = [
    { tool_name: 'mi6__device_vibrate', device_id: 'mi6', method: 'device.vibrate' },
    { tool_name: 'mi6__device_secret', device_id: 'mi6', method: 'device.secret' },
    { tool_name: 'tablet__device_vibrate', device_id: 'tablet', method: 'device.vibrate' }
  ];
  const hub = { listToolMethods: () => methods, invoke: async () => 'ok' };
  const disabled = new DeviceTools({ deviceHub: hub, policy: { allow: ['bus_publish'], deny: [] } }).snapshot({});
  assert.deepEqual(disabled.map((tool) => tool.originalName).sort(), ['avatar_status', 'avatar_transfer', 'bus_publish']);
  const tools = new DeviceTools({ deviceHub: hub, policy: {
    allow: ['bus_publish'], deny: ['mi6__device_secret'],
    deviceHub: { allow: ['mi6__device_*'], deny: ['*secret'] }
  } }).snapshot({});
  assert.ok(tools.some((tool) => tool.originalName === 'mi6__device_vibrate'));
  assert.ok(!tools.some((tool) => tool.originalName === 'mi6__device_secret'));
  assert.ok(!tools.some((tool) => tool.originalName === 'tablet__device_vibrate'));
  await assert.rejects(
    new DeviceTools({ deviceHub: hub, policy: {
      allow: ['bus_publish'], deny: ['mi6__device_vibrate'], deviceHub: { allow: ['mi6__device_*'] }
    } }).snapshot({}).find((tool) => tool.originalName === 'mi6__device_vibrate').execute('id', {}),
    /denied/
  );
});

test('TC-PI-009 bus namespace, schema, policy and avatar routing are enforced', async () => {
  const events = [];
  const bridge = new DeviceTools({ bus: { publish: (...args) => events.push(args) }, avatar: {
    transfer: async (to) => ({ host: to }), status: async () => ({ host: 'desktop' })
  } });
  const tools = Object.fromEntries(bridge.snapshot({ session_id: 's' }).map((tool) => [tool.name, tool]));
  await tools.bus_publish.execute('id', { topic: 'plugin.example.tick', data: {} });
  assert.equal(events.find(([topic]) => topic === 'plugin.example.tick')[1].session_id, 's');
  await assert.rejects(tools.bus_publish.execute('id', { topic: 'sys.config.changed', data: {} }));
  assert.deepEqual(JSON.parse((await tools.avatar_transfer.execute('id', { to: 'mi6' })).content[0].text), { host: 'mi6' });
  const denied = new DeviceTools({ policy: { deny: ['bus_publish'] } }).snapshot({})[0];
  await assert.rejects(denied.execute('id', { topic: 'ui.test', data: {} }), /denied/);
  assert.throws(() => bridge.snapshot({}, ['bus_publish']), /Duplicate/);
});

test('TC-PI-009 avatar transfer uses the coordinator-defined Hub API', async () => {
  let call;
  const hub = { listToolMethods: () => [], requestAvatarTransfer: async (...args) => { call = args; return { host: args[0], status: 'completed' }; } };
  const tool = new DeviceTools({ deviceHub: hub }).snapshot({}).find((item) => item.name === 'avatar_transfer');
  await tool.execute('transfer', { to: 'phone' });
  assert.deepEqual(call, ['phone', { reason: 'agent' }]);
});
