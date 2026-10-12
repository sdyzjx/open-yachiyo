'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createAndroidTransferController,
  createTransferEventGuard,
  resolveAndroidTransferControl
} = require('../../apps/android/app/src/main/assets/web/js/transferControl');

const phone = 'android-phone';
const desktop = { device_id: 'desktop-a', device_type: 'desktop' };

test('persistent transfer control reflects connection, owner, pending and desktop presence', () => {
  assert.deepEqual(resolveAndroidTransferControl({ hub: { state: 'disconnected' }, deviceId: phone }), {
    disabled: true, label: '设备未连接', reason: '连接后可迁移角色', owner: '', desktopOnline: false
  });
  assert.deepEqual(resolveAndroidTransferControl({
    hub: { state: 'connected', avatar_host: 'desktop', devices: [desktop] }, deviceId: phone
  }), {
    disabled: false, label: '让她过来', reason: '当前在电脑 · 电脑在线', target: phone, owner: 'desktop', desktopOnline: true
  });
  assert.deepEqual(resolveAndroidTransferControl({
    hub: { state: 'connected', avatar_host: phone, devices: [] }, deviceId: phone
  }), {
    disabled: true, label: '叫回电脑', reason: '当前在手机 · 电脑离线', owner: phone, desktopOnline: false
  });
  assert.equal(resolveAndroidTransferControl({
    hub: { state: 'connected', avatar_host: phone, devices: [desktop] }, deviceId: phone, pending: true
  }).label, '迁移中…');
});

test('controller blocks duplicate clicks and always clears request pending', async () => {
  let pending = false;
  let release;
  const calls = [];
  const controller = createAndroidTransferController({
    getSnapshot: () => ({
      hub: { state: 'connected', avatar_host: phone, devices: [desktop] }, deviceId: phone, pending
    }),
    request: (target) => new Promise((resolve) => { calls.push(target); release = resolve; }),
    setPending: (value) => { pending = value; }
  });
  const first = controller.activate('desktop');
  assert.equal((await controller.activate('desktop')).ok, false);
  assert.deepEqual(calls, ['desktop']);
  release();
  assert.deepEqual(await first, { ok: true, target: 'desktop' });
  assert.equal(pending, false);
});

test('transfer event guard invalidates stale async work and ignores duplicate cancel', () => {
  const guard = createTransferEventGuard();
  const first = guard.begin('transfer-1');
  assert.equal(guard.isCurrent(first), true);
  assert.equal(guard.clear('other-transfer'), false);
  assert.equal(guard.isCurrent(first), true);
  assert.equal(guard.clear('transfer-1'), true);
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.clear('transfer-1'), false); // failed broadcast followed by direct cancel
  const next = guard.begin('transfer-2');
  assert.equal(guard.isCurrent(next), true);
  guard.clear(); // disconnect
  assert.equal(guard.isCurrent(next), false);
});

test('app gates entered acknowledgement after model load and animation, and aborts failed transfers', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../apps/android/app/src/main/assets/web/js/app.js'), 'utf8');
  const enter = source.slice(source.indexOf('async function onEnter'), source.indexOf('async function onCancel2'));
  assert.match(enter, /transferEvents\.isCurrent\(ticket\)/);
  assert.match(enter, /if \(!completed \|\| !transferEvents\.isCurrent\(ticket\)\) return;/);
  assert.ok(enter.indexOf("publish('avatar.transfer.entered'") > enter.indexOf('if (!completed'));
  assert.match(source, /case 'avatar\.transfer\.failed': onCancel2\(d\)/);
  assert.match(source, /onCancel2\(d\)\.then\(\(\) => recoverOwnedAvatar\(\)\)/);
  assert.match(source, /stage\.setVisible\(true\)/);
  assert.match(source, /case 'avatar\.transfer\.cancel': onCancel2\(d\)/);
});

test('main screen exposes the transfer control independently of avatar visibility', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../apps/android/app/src/main/assets/web/index.html'), 'utf8');
  assert.match(html, /id="transfer-control"/);
  assert.match(html, /id="btn-transfer"/);
  assert.match(html, /js\/transferControl\.js/);
});
