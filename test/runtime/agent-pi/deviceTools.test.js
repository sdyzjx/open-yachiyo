const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DeviceTools } = require('../../../apps/runtime/agent-pi/deviceTools');

test('TC-PI-008 device tools refresh next snapshot and preserve in-flight definitions', async () => {
  const hub = new EventEmitter();
  let methods = [{ tool_name: 'mi6__device_vibrate', device_id: 'mi6', method: 'device.vibrate', params_schema: { type: 'object' } }];
  hub.listToolMethods = () => methods;
  hub.invoke = async (...args) => args;
  const bridge = new DeviceTools({ deviceHub: hub });
  const previous = bridge.snapshot({});
  methods = [];
  hub.emit('tools.changed');
  assert.equal(bridge.snapshot({}).some((tool) => tool.name === 'mi6__device_vibrate'), false);
  const result = await previous.find((tool) => tool.name === 'mi6__device_vibrate').execute('id', { ms: 10 });
  assert.deepEqual(JSON.parse(result.content[0].text), ['mi6', 'device.vibrate', { ms: 10 }, { timeoutMs: 8000 }]);
  bridge.dispose();
  assert.equal(hub.listenerCount('tools.changed'), 0);
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
