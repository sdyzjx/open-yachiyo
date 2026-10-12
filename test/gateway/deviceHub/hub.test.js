const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { fixture } = require('./helpers');
const { matches } = require('../../../apps/gateway/deviceHub/topics');

test('Hub authentication and legacy websocket coexist', async (t) => {
  const f = await fixture(t);
  const bad = new WebSocket(`${f.base.replace('http', 'ws')}/ws/device?token=bad`);
  assert.equal((await once(bad, 'close'))[0], 1008);
  const legacy = new WebSocket(`${f.base.replace('http', 'ws')}/ws`);
  assert.equal(String((await once(legacy, 'message'))[0]), 'legacy');
  legacy.close();
  const c = await f.client('phone');
  assert.equal(c.welcome.data.session_id, 'device-phone');
  assert.equal((await (await fetch(`${f.base}/api/device/devices`)).json()).devices.length, 1);
});

test('Hub wildcard routing, directed events and lockscreen filtering', async (t) => {
  assert.equal(matches('avatar.*', 'avatar.transfer.ready'), false);
  assert.equal(matches('plugin.x.**', 'plugin.x.a.b'), true);
  const f = await fixture(t);
  const a = await f.client('a');
  const b = await f.client('b');
  a.send('sub', { topics: ['*'] }); b.send('sub', { topics: ['plugin.**'] });
  await a.sync(); await b.sync();
  a.send('pub', { __target: 'b', value: 1 }, { topic: 'plugin.x.tick' });
  assert.equal((await b.next((m) => m.topic === 'plugin.x.tick')).from, 'a');
  await a.sync();
  assert.equal(a.inbox.some((m) => m.topic === 'plugin.x.tick'), false);
  b.send('pub', { mode: 'lockscreen' }, { topic: 'sys.device.mode' });
  b.send('sub', { topics: ['plugin.x.*'] });
  assert.equal((await b.next((m) => m.type === 'error')).data.code, -32006);
  b.send('pub', {}, { topic: 'plugin.x.tick' });
  assert.equal((await b.next((m) => m.type === 'error')).data.code, -32006);
  await b.sync();
  f.hub.publish('plugin.x.tick', {});
  await b.sync();
  assert.equal(b.inbox.some((m) => m.topic === 'plugin.x.tick'), false);
  a.send('unsub', { topics: ['*'] }); await a.sync();
  assert.equal(f.hub.devices.get('a').subscriptions.size, 0);
});

test('Hub RPC registration, two directions, timeout, offline and response ownership', async (t) => {
  const f = await fixture(t);
  const a = await f.client('a'); const b = await f.client('b');
  let changes = 0; f.hub.on('tools.changed', () => changes++);
  b.send('rpc.register', { methods: [{ name: 'device.vibrate', expose_as_tool: true }] }); await b.sync();
  assert.equal(f.hub.listToolMethods()[0].tool_name, 'b__device_vibrate');
  assert.equal(changes, 1);
  const result = f.hub.invoke('b', 'device.vibrate', { ms: 20 });
  const req = await b.next((m) => m.type === 'rpc.req');
  a.send('rpc.res', { result: 'spoof' }, { id: req.id }); await a.sync();
  b.send('rpc.res', { result: 'ok' }, { id: req.id });
  assert.equal(await result, 'ok');
  a.send('rpc.req', { target: 'b', method: 'device.vibrate', params: {} }, { id: 'caller' });
  const routed = await b.next((m) => m.type === 'rpc.req');
  b.send('rpc.res', { result: 42 }, { id: routed.id });
  assert.equal((await a.next((m) => m.type === 'rpc.res')).data.result, 42);
  await assert.rejects(f.hub.invoke('b', 'device.vibrate', {}, { timeoutMs: 10 }), { code: -32003 });
  await assert.rejects(f.hub.invoke('absent', 'state.get'), { code: -32010 });
  b.send('rpc.unregister', { methods: ['device.vibrate'] }); await b.sync();
  assert.equal(f.hub.listToolMethods().length, 0);
  await assert.rejects(f.hub.invoke('b', 'device.vibrate'), { code: -32601 });
});

test('Hub heartbeat disconnects silent peers and handshake is required', async (t) => {
  const f = await fixture(t, { config: { pairing_token: 'test-token', heartbeat_ms: 25 } });
  const c = await f.client('quiet');
  await Promise.all([once(c.ws, 'close'), once(f.hub, 'offline')]);
  assert.equal(f.hub.listDevices().length, 0);
});

test('Lockscreen hides tools and cancels pending plugin RPC; disconnect rejects pending calls', async (t) => {
  const f = await fixture(t); const phone = await f.client('phone');
  phone.send('rpc.register', { methods: [{ name: 'plugin.demo.read', expose_as_tool: true }] }); await phone.sync();
  const pending = f.hub.invoke('phone', 'plugin.demo.read');
  const denied = assert.rejects(pending, { code: -32006 });
  await phone.next((m) => m.type === 'rpc.req');
  phone.send('pub', { mode: 'lockscreen' }, { topic: 'sys.device.mode' }); await denied;
  assert.equal(f.hub.listToolMethods().length, 0);
  phone.send('pub', { mode: 'normal' }, { topic: 'sys.device.mode' }); await phone.sync();
  assert.equal(f.hub.listToolMethods().length, 1);
  const offline = assert.rejects(f.hub.invoke('phone', 'state.get'), { code: -32010 });
  await phone.next((m) => m.type === 'rpc.req'); phone.ws.close(); await offline;
});
