const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { fixture } = require('./helpers');
const { DeviceHubClient } = require('../../../apps/desktop-live2d/main/deviceHubClient');
const { createAvatarTransfer } = require('../../../apps/desktop-live2d/renderer/avatarTransfer');

test('Desktop Hub client pairs, acknowledges handoff, mutes and invokes renderer RPC', async (t) => {
  const f = await fixture(t);
  const calls = [];
  const desktop = new DeviceHubClient({ gatewayUrl: f.base, deviceId: 'desktop-test', invokeRenderer: async (method, params) => { calls.push({ method, params }); return { ok: true }; } });
  t.after(() => desktop.stop());
  const online = once(f.hub, 'online'); await desktop.start(); await online;
  // Round trip on the same connection ensures welcome/subscription are processed.
  await f.hub.invoke('desktop', 'state.get');
  assert.equal(desktop.isHost, true);
  const phone = await f.client('phone');
  const transfer = desktop.transfer('phone');
  const prepare = await phone.next((m) => m.topic === 'avatar.transfer.prepare');
  phone.send('pub', { transfer_id: prepare.data.transfer_id }, { topic: 'avatar.transfer.ready' });
  const enter = await phone.next((m) => m.topic === 'avatar.transfer.enter');
  phone.send('pub', { transfer_id: enter.data.transfer_id }, { topic: 'avatar.transfer.entered' });
  await transfer;
  assert.equal(desktop.isHost, false);
  assert.ok(calls.some((c) => c.params?.topic === 'avatar.transfer.exit'));
});

test('Desktop avatar animation follows timing and hides/stops voice off host', async () => {
  const animations = []; const visibility = []; let stopped = 0; let greeted = 0;
  const element = { style: {}, getBoundingClientRect: () => ({ height: 400 }), animate(frames, options) { animations.push({ frames, options }); return { finished: Promise.resolve(), cancel() {} }; } };
  const controller = createAvatarTransfer({ element, height: () => 800, setVisible: (v) => visibility.push(v), stopVoice: () => stopped++, greet: async () => greeted++ });
  await controller.handle({ topic: 'avatar.welcome', data: { host: 'desktop' } });
  await controller.handle({ topic: 'avatar.transfer.exit' });
  assert.deepEqual(animations.map((a) => a.options.duration), [120, 480]);
  assert.equal(visibility.at(-1), false);
  await controller.handle({ topic: 'avatar.host.changed', data: { host: 'phone' } });
  assert.equal(controller.isHost, false);
  await controller.handle({ topic: 'avatar.transfer.prepare' });
  await controller.handle({ topic: 'avatar.host.changed', data: { host: 'desktop' } });
  assert.equal(visibility.at(-1), false);
  await controller.handle({ topic: 'avatar.transfer.enter' });
  assert.equal(animations.at(-1).options.duration, 520);
  assert.equal(greeted, 1);
  assert.equal(visibility.at(-1), true);
  await controller.handle({ topic: 'avatar.connection.lost' });
  assert.equal(visibility.at(-1), false);
  assert.ok(stopped > 0);
});

test('Desktop handoff cancellation cannot resume an obsolete animation', async () => {
  let cancelFrame; let visible = false; let animations = 0;
  const element = { style: {}, getBoundingClientRect: () => ({ height: 200 }), animate() {
    animations++;
    const finished = new Promise((resolve, reject) => { cancelFrame = reject; });
    return { finished, cancel() { cancelFrame(new Error('cancelled')); } };
  } };
  const controller = createAvatarTransfer({ element, height: () => 800, setVisible: (v) => { visible = v; }, stopVoice() {}, async greet() {} });
  await controller.handle({ topic: 'avatar.welcome', data: { host: 'desktop' } });
  const exit = controller.handle({ topic: 'avatar.transfer.exit' });
  assert.equal(controller.isHost, false);
  await controller.handle({ topic: 'avatar.transfer.cancel' });
  await exit;
  assert.equal(visible, true); assert.equal(animations, 1);
  assert.equal(controller.isHost, true);
});

test('Realtime voice cannot start after host is lost during AudioContext resume', async () => {
  let finishResume; let host = true;
  const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
  const audioContext = { state: 'suspended', resume: () => new Promise((resolve) => { finishResume = resolve; }), createAnalyser: () => ({ connect() {} }), createGain: () => ({ gain: {}, connect() {} }) };
  const context = { window: { AudioContext: class {} }, module: { exports: {} }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../apps/desktop-live2d/renderer/realtimeVoicePlayer.js'), 'utf8'), context);
  const player = new context.module.exports.RealtimeVoicePlayer({ audioContext });
  const start = player.startSession({ requestId: 'voice', shouldPlay: () => host });
  host = false; finishResume(); await start;
  assert.equal(player.session, null);
});
