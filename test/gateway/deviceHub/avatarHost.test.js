const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');
const { DeviceHub } = require('../../../apps/gateway/deviceHub/hub');
const { attachAvatarHost } = require('../../../apps/gateway/deviceHub/avatarHost');

test('Avatar transfer completes in order, persists and routes live2d RPC to host', async (t) => {
  const dir = fs.mkdtempSync(path.join(__dirname, '.avatar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'state.json');
  const f = await fixture(t, { avatar: { statePath, stepTimeoutMs: 20 } });
  const desktop = await f.client('desk', { device_type: 'desktop' }); const phone = await f.client('phone');
  const transfer = f.hub.transferAvatar({ to: 'phone' });
  const prepare = await phone.next((m) => m.topic === 'avatar.transfer.prepare');
  phone.send('pub', { transfer_id: prepare.data.transfer_id }, { topic: 'avatar.transfer.ready' });
  const exit = await desktop.next((m) => m.topic === 'avatar.transfer.exit');
  desktop.send('pub', { transfer_id: exit.data.transfer_id }, { topic: 'avatar.transfer.exited' });
  const enter = await phone.next((m) => m.topic === 'avatar.transfer.enter');
  phone.send('pub', { transfer_id: enter.data.transfer_id }, { topic: 'avatar.transfer.entered' });
  assert.equal((await transfer).host, 'phone');
  const restored = new DeviceHub({ pairing_token: 'test' });
  attachAvatarHost({ hub: restored, statePath }); assert.equal(restored.getAvatarHost(), 'phone'); restored.close();
  const { invokeLive2dRpc } = require('../../../apps/runtime/tooling/adapters/live2d').__internal;
  const rpc = invokeLive2dRpc({ method: 'model.param.set', params: { id: 'X', value: 1 } });
  const req = await phone.next((m) => m.type === 'rpc.req');
  phone.send('rpc.res', { result: { ok: true } }, { id: req.id });
  assert.deepEqual(await rpc, { ok: true });
  const reverse = f.hub.transferAvatar({ to: 'desktop' });
  const prep = await desktop.next((m) => m.topic === 'avatar.transfer.prepare');
  desktop.send('pub', { transfer_id: prep.data.transfer_id }, { topic: 'avatar.transfer.ready' });
  // Missing exit/enter acknowledgments are allowed after step deadlines.
  assert.equal((await reverse).host, 'desktop');
});

test('Avatar prepare timeout and offline target retain host; forged ready ignored', async (t) => {
  const f = await fixture(t, { avatar: { prepareTimeoutMs: 25 } });
  const desktop = await f.client('desk', { device_type: 'desktop' }); const phone = await f.client('phone');
  const transfer = f.hub.transferAvatar({ to: 'phone' });
  const rejection = assert.rejects(transfer, { code: -32003 });
  const prepare = await phone.next((m) => m.topic === 'avatar.transfer.prepare');
  desktop.send('pub', { transfer_id: prepare.data.transfer_id }, { topic: 'avatar.transfer.ready' });
  await rejection;
  assert.equal(f.hub.getAvatarHost(), 'desktop');
  await desktop.next((m) => m.topic === 'avatar.transfer.cancel');
  const response = await fetch(`${f.base}/api/device/avatar/transfer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'missing' }) });
  assert.equal((await response.json()).error.code, -32010);
});
