const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { SessionEventSubscriptions } = require('../../../apps/runtime/agent-pi/sessionEventSubscriptions');
const { createBusTools } = require('../../../apps/runtime/agent-pi/busTools');

test('TC-PI-036 bus tools publish, subscribe, pull and list through one session owner', async () => {
  const bus = new RuntimeEventBus();
  const subscriptions = new SessionEventSubscriptions({ bus, sessionId: 's' });
  const published = [];
  bus.subscribe('plugin.demo.tick', (payload) => published.push(payload));
  const context = () => ({ session_id: 's', publishEvent: null });
  const tools = Object.fromEntries(createBusTools({
    subscriptions,
    bus,
    policy: { allow: ['bus.publish', 'bus.subscribe', 'bus.unsubscribe', 'bus.events.pull', 'bus.channels.list'], deny: [] },
    context
  }).map((tool) => [tool.originalName, tool]));

  const subscribe = JSON.parse((await tools['bus.subscribe'].execute('sub', {
    pattern: 'device.**', max_queue: 4
  })).content[0].text);
  bus.publish('device.phone.battery', { level: 70 });
  const pull = JSON.parse((await tools['bus.events.pull'].execute('pull', {})).content[0].text);
  assert.equal(pull.items[0].data.level, 70);
  const channels = JSON.parse((await tools['bus.channels.list'].execute('list', {})).content[0].text);
  assert.equal(channels.channels.some((entry) => entry.topic === 'device.phone.battery'), true);

  await tools['bus.publish'].execute('pub', { topic: 'plugin.demo.tick', data: { ok: true } });
  assert.equal(published[0].session_id, 's');
  await assert.rejects(tools['bus.publish'].execute('bad', { topic: 'sys.secret', data: {} }));
  const removed = JSON.parse((await tools['bus.unsubscribe'].execute('unsub', {
    subscription_id: subscribe.subscription_id
  })).content[0].text);
  assert.equal(removed.removed, true);
  subscriptions.dispose();
});
