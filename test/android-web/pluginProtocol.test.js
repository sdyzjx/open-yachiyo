'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../apps/android/app/src/main/assets/web/js/pluginProtocol.js');

const manifest = {
  id: 'com.example.pomodoro', name: 'x', version: '1.0.0', type: 'app', entry: 'index.html', sdk: 1,
  permissions: ['bus.publish:plugin.com.example.pomodoro.**', 'bus.subscribe:task.*', 'rpc.call:avatar.*', 'rpc.register', 'agent.tool']
};

test('validateManifest accepts valid and reports problems', () => {
  assert.deepEqual(P.validateManifest(manifest), []);
  assert.ok(P.validateManifest({ ...manifest, id: 'A' }).length > 0);
  assert.ok(P.validateManifest({ ...manifest, type: 'x' }).length > 0);
  assert.ok(P.validateManifest({ ...manifest, entry: '../evil.html' }).length > 0);
  assert.ok(P.validateManifest({ ...manifest, type: 'widget', widget: { w: 0 } }).length > 0);
});

test('envelope detection', () => {
  assert.ok(P.isEnvelope({ __yachiyo: 1, kind: 'req', op: 'ready' }));
  assert.ok(!P.isEnvelope({ kind: 'req', op: 'ready' }));
  assert.ok(!P.isEnvelope({ __yachiyo: 1, kind: 'bogus', op: 'ready' }));
  assert.ok(!P.isEnvelope(null));
});

test('publish: own namespace implicit, declared permitted, others denied, shorthand expanded', () => {
  const ok = P.checkOp({ id: 'com.a.b', permissions: [] }, 'bus.publish', { topic: '.tick', data: 1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.topic, 'plugin.com.a.b.tick');
  assert.equal(P.checkOp(manifest, 'bus.publish', { topic: 'plugin.com.example.pomodoro.done' }).ok, true);
  const denied = P.checkOp(manifest, 'bus.publish', { topic: 'chat.input' });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, -32006);
  assert.equal(P.checkOp(manifest, 'bus.publish', { topic: 'plugin.other.x' }).code, -32006);
  assert.equal(P.checkOp(manifest, 'bus.publish', { topic: 'plugin.com.example.pomodoro.*' }).code, -32602);
});

test('subscribe: must be covered by declared patterns', () => {
  assert.equal(P.checkOp(manifest, 'bus.subscribe', { pattern: 'task.update' }).ok, true);
  assert.equal(P.checkOp(manifest, 'bus.subscribe', { pattern: 'task.**' }).code, -32006);
  assert.equal(P.checkOp(manifest, 'bus.subscribe', { pattern: 'chat.*' }).code, -32006);
  assert.equal(P.checkOp(manifest, 'bus.subscribe', { pattern: '.ping' }).ok, true);
});

test('rpc.call permission by method pattern; own methods allowed', () => {
  assert.equal(P.checkOp(manifest, 'rpc.call', { method: 'avatar.status' }).ok, true);
  assert.equal(P.checkOp(manifest, 'rpc.call', { method: 'device.vibrate' }).code, -32006);
  assert.equal(P.checkOp(manifest, 'rpc.call', { method: 'plugin.com.example.pomodoro.start_timer' }).ok, true);
});

test('rpc.register requires permissions; exposeAsTool requires agent.tool; names are prefixed', () => {
  const r = P.checkOp(manifest, 'rpc.register', { name: 'start_timer', exposeAsTool: true, description: 'd' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.full_name, 'plugin.com.example.pomodoro.start_timer');
  assert.equal(r.payload.expose_as_tool, true);
  const noReg = { ...manifest, permissions: [] };
  assert.equal(P.checkOp(noReg, 'rpc.register', { name: 'a' }).code, -32006);
  const noTool = { ...manifest, permissions: ['rpc.register'] };
  assert.equal(P.checkOp(noTool, 'rpc.register', { name: 'a', exposeAsTool: true }).code, -32006);
  assert.equal(P.checkOp(noTool, 'rpc.register', { name: 'a' }).ok, true);
  assert.equal(P.checkOp(manifest, 'rpc.register', { name: 'bad name!' }).code, -32602);
});

test('avatar.act requires live2d rpc permission', () => {
  const a = { action: { type: 'emote', name: 'happy' } };
  assert.equal(P.checkOp(manifest, 'avatar.act', a).code, -32006);
  const m = { ...manifest, permissions: ['rpc.call:live2d.**'] };
  assert.equal(P.checkOp(m, 'avatar.act', a).ok, true);
});

test('lockscreen denies everything, unknown ops are invalid', () => {
  assert.equal(P.checkOp(manifest, 'storage.get', { key: 'a' }, { lockscreen: true }).code, -32006);
  assert.equal(P.checkOp(manifest, 'nope', {}).code, -32600);
  assert.equal(P.checkOp(manifest, 'storage.get', {}).code, -32602);
});

test('manifest revision changes when the same version is reinstalled', () => {
  const base = { id: 'com.example.x', version: '1.0.0', type: 'app', entry: 'index.html', installed_at: 10 };
  assert.equal(P.manifestRevision(base), P.manifestRevision({ ...base }));
  assert.notEqual(P.manifestRevision(base), P.manifestRevision({ ...base, installed_at: 11 }));
  assert.notEqual(P.manifestRevision(base), P.manifestRevision({ ...base, entry: 'next.html' }));
});
