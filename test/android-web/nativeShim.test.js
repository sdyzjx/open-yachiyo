'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shim = require('../../apps/android/app/src/main/assets/web/js/nativeShim.js');

function fakeNative(token = 'tok123') {
  const calls = [];
  let handed = false;
  return {
    calls,
    handshake() { if (handed) return ''; handed = true; return token; },
    invoke(t, method, argsJson) { calls.push({ t, method, args: JSON.parse(argsJson) }); return 'ret'; }
  };
}

test('installs YachiyoNative forwarding every method through invoke with the captured token', () => {
  const root = { __YachiyoBridge: fakeNative(), console };
  assert.equal(shim.install(root), true);
  assert.equal(root.YachiyoNative.hubSubscribe('["avatar.*"]'), 'ret');
  root.YachiyoNative.vibrate(20);
  root.YachiyoNative.hubRpc('c1', 'state.get', '{}', '');
  const calls = root.__YachiyoBridge.calls;
  assert.deepEqual(calls[0], { t: 'tok123', method: 'hubSubscribe', args: ['["avatar.*"]'] });
  assert.deepEqual(calls[1].args, [20]);
  assert.deepEqual(calls[2].args, ['c1', 'state.get', '{}', '']);
  for (const name of ['dismissKeyguard', 'consumeBack', 'listLaunchableApps', 'launchApp', 'micStart', 'pluginStorageSet', 'startServerDiscovery', 'stopServerDiscovery']) {
    assert.equal(typeof root.YachiyoNative[name], 'function', name);
  }
});

test('token never appears on the global object or the shim', () => {
  const root = { __YachiyoBridge: fakeNative('secret-token'), console };
  shim.install(root);
  assert.ok(!JSON.stringify(Object.keys(root)).includes('secret'));
  assert.ok(!Object.values(root.YachiyoNative).some((v) => typeof v === 'string'));
  assert.equal(Object.isFrozen(root.YachiyoNative), true);
  assert.throws(() => { 'use strict'; root.YachiyoNative = {}; });
});

test('second install (handshake returns empty) is ignored and logged', () => {
  const native = fakeNative();
  const root = { __YachiyoBridge: native, console: { error() { root.logged = true; } } };
  assert.equal(shim.install(root), true);
  const second = { __YachiyoBridge: native, console: { error() { second.logged = true; } } };
  assert.equal(shim.install(second), false);
  assert.equal(second.logged, true);
  assert.equal(second.YachiyoNative, undefined);
});

test('without the native bridge nothing is defined (mockNative takes over)', () => {
  const root = { console };
  assert.equal(shim.install(root), false);
  assert.equal(root.YachiyoNative, undefined);
});
