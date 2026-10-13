const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { SessionEventSubscriptions, matchesTopic,
  validTopicPattern } = require('../../../apps/runtime/agent-pi/sessionEventSubscriptions');

test('TC-PI-036 event subscription topic ACL and wildcard matching are deterministic', () => {
  assert.equal(validTopicPattern('device.phone.**'), true);
  assert.equal(validTopicPattern('runtime.**'), false);
  assert.equal(validTopicPattern('*'), false);
  assert.equal(matchesTopic('device.*.state', 'device.phone.state'), true);
  assert.equal(matchesTopic('device.**', 'device.phone.battery.state'), true);
  assert.equal(matchesTopic('device.*', 'device.phone.state'), false);
});

test('TC-PI-036 pull subscriptions keep bounded cursor queues and ignore self events', () => {
  const bus = new RuntimeEventBus();
  const subscriptions = new SessionEventSubscriptions({ bus, sessionId: 's' });
  const sub = subscriptions.subscribe({ pattern: 'device.**', max_queue: 2 });
  bus.publish('device.phone.state', { value: 1 });
  bus.publish('device.phone.state', { value: 2, session_id: 's' });
  bus.publish('device.phone.state', { value: 99, session_id: 'another-session' });
  bus.publish('device.phone.state', { value: 3 });
  bus.publish('device.phone.state', { value: 4 });
  const page = subscriptions.pull({ limit: 10, acknowledge: false });
  assert.deepEqual(page.items.map((event) => event.data.value), [3, 4]);
  assert.equal(page.items.every((event) => event.subscription_ids.includes(sub.subscription_id)), true);
  assert.equal(subscriptions.pull({ after_cursor: page.items[0].cursor }).items[0].data.value, 4);
  bus.publish('device.phone.state', { value: 'x'.repeat(70 * 1024) });
  assert.equal(subscriptions.pull({ acknowledge: false }).dropped_events, 1);
  assert.equal(subscriptions.unsubscribe(sub.subscription_id), true);
  subscriptions.dispose();
  assert.equal(bus.emitter.listenerCount('__bus_all__'), 0);
});

test('TC-PI-036 only explicit high-priority subscriptions deliver steering and TTL expires', async () => {
  const bus = new RuntimeEventBus();
  let now = 1000;
  const steers = [];
  const subscriptions = new SessionEventSubscriptions({ bus, sessionId: 's', now: () => now,
    onSteer: async (event) => steers.push(event) });
  assert.throws(() => subscriptions.subscribe({ pattern: 'audio.**', delivery: 'steer' }), /priority=high/);
  subscriptions.subscribe({ pattern: 'audio.input.**', delivery: 'steer', priority: 'high', ttl_ms: 1000 });
  bus.publish('audio.input.ready', { device_id: 'phone' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1);
  now += 1001;
  bus.publish('audio.input.ready', { device_id: 'phone' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1);
  assert.equal(subscriptions.listChannels().subscriptions.length, 0);
  subscriptions.dispose();
});
