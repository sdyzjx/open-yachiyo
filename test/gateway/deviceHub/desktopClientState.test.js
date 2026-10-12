const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceHubClient } = require('../../../apps/desktop-live2d/main/deviceHubClient');

// Drives the client's message handler directly: no socket, only the state machine.
function makeClient(options = {}) {
  const sent = [];
  const states = [];
  const client = new DeviceHubClient({
    gatewayUrl: 'http://127.0.0.1:1', token: 't', deviceId: 'desktop-test',
    invokeRenderer: options.invokeRenderer || (async () => ({ ok: true })),
    onStateChange: () => states.push({ host: client.host, target: client.transferTarget, connected: client.connected }),
    transferWatchdogMs: options.watchdogMs || 25000
  });
  client.send = (type, data, extra = {}) => sent.push({ type, data, ...extra });
  client.ws = { terminate() {}, close() {} };
  return { client, sent, states };
}
const welcome = (client, host = 'desktop', devices = [{ device_id: 'mi6', device_type: 'android', name: 'mi6' }]) =>
  client.receive({ type: 'welcome', data: { avatar_host: host, devices, heartbeat_ms: 60000 } });
const event = (client, topic, data) => client.receive({ type: 'event', topic, data });

test('TC-DSK-020 transfer state follows prepare/exit to terminal events and notifies the UI', async (t) => {
  const { client, states } = makeClient();
  t.after(() => client.stop());
  await welcome(client);
  assert.equal(client.connected, true);
  await event(client, 'avatar.transfer.exit', { transfer_id: 'a', to: 'mi6' });
  assert.equal(client.transferTarget, 'mi6');
  await event(client, 'avatar.host.changed', { host: 'mi6', transfer_id: 'a' });
  await event(client, 'avatar.transfer.completed', { transfer_id: 'a', host: 'mi6' });
  assert.equal(client.transferTarget, '');
  assert.equal(client.host, 'mi6');
  assert.ok(states.some((s) => s.target === 'mi6'));
  assert.equal(states.at(-1).target, '');
});

test('TC-DSK-021 local transfer sets pending immediately, rejects duplicates and clears on the reply', async (t) => {
  const { client, sent } = makeClient();
  t.after(() => client.stop());
  await welcome(client);
  const first = client.transfer('mi6');
  assert.equal(client.transferTarget, 'mi6');
  await assert.rejects(client.transfer('mi6'), /already in progress/);
  const request = sent.find((m) => m.type === 'rpc.req');
  await client.receive({ type: 'rpc.res', id: request.id, data: { result: { status: 'completed' } } });
  await first;
  assert.equal(client.transferTarget, '');
  await assert.rejects(client.transfer('desktop'), /already on this device/);
});

test('TC-DSK-022 prepare failure in the renderer clears pending and publishes no ready ack', async (t) => {
  const { client, sent } = makeClient({
    invokeRenderer: async (method, params) => { if (params?.topic === 'avatar.transfer.prepare') throw new Error('renderer gone'); return {}; }
  });
  t.after(() => client.stop());
  await welcome(client, 'mi6');
  await assert.rejects(event(client, 'avatar.transfer.prepare', { transfer_id: 'p1', to: 'desktop', from: 'mi6' }), /renderer gone/);
  assert.equal(client.transferTarget, '');
  assert.equal(sent.some((m) => m.topic === 'avatar.transfer.ready'), false);
});

test('TC-DSK-023 a cancel that lands during enter suppresses the stale entered ack', async (t) => {
  let finishEnter;
  const { client, sent } = makeClient({
    invokeRenderer: (method, params) => params?.topic === 'avatar.transfer.enter' ? new Promise((resolve) => { finishEnter = resolve; }) : Promise.resolve({})
  });
  t.after(() => client.stop());
  await welcome(client, 'mi6');
  const enter = event(client, 'avatar.transfer.enter', { transfer_id: 'e1', from: 'mi6' });
  await event(client, 'avatar.transfer.cancel', { transfer_id: 'e1' });
  finishEnter({});
  await enter;
  assert.equal(sent.some((m) => m.topic === 'avatar.transfer.entered'), false);
  assert.equal(client.transferTarget, '');
});

test('TC-DSK-024 normal enter is acknowledged and watchdog clears a lost terminal event', async (t) => {
  const { client, sent } = makeClient({ watchdogMs: 30 });
  t.after(() => client.stop());
  await welcome(client, 'mi6');
  await event(client, 'avatar.transfer.enter', { transfer_id: 'e2', from: 'mi6' });
  assert.equal(sent.filter((m) => m.topic === 'avatar.transfer.entered').length, 1);
  await event(client, 'avatar.transfer.prepare', { transfer_id: 'e3', to: 'desktop' });
  assert.equal(client.transferTarget, 'desktop');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(client.transferTarget, '');
});

test('TC-DSK-025 disconnect drops pending transfer and host visibility', async (t) => {
  const { client, states } = makeClient();
  t.after(() => client.stop());
  await welcome(client);
  await event(client, 'avatar.transfer.exit', { transfer_id: 'x', to: 'mi6' });
  client.connected = false; client.activeTransfer = null; // simulate ws close handler side effects
  client.emitState();
  assert.equal(states.at(-1).connected, false);
  assert.equal(client.isHost, false);
});
