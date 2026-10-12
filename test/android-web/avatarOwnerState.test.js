'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOwnerTracker } = require('../../apps/android/app/src/main/assets/web/js/avatarOwnerState');

const phone = 'android-phone';

test('desktop owner remains hidden through socket loss, reconnect and repeated welcome', () => {
  const tracker = createOwnerTracker({ deviceId: phone, initialHub: { state: 'connected', avatar_host: 'desktop' } });
  assert.equal(tracker.snapshot().isHost, false);
  assert.deepEqual(tracker.update({ state: 'disconnected', avatar_host: '' }), {
    host: 'desktop', previousHost: 'desktop', ownerChanged: false, isHost: false
  });
  assert.equal(tracker.update({ state: 'connected', avatar_host: 'desktop' }).isHost, false);
  assert.equal(tracker.update({ state: 'connected', avatar_host: 'desktop' }).ownerChanged, false);
});

test('unknown owner stays hidden and last phone owner survives disconnect without a new transition', () => {
  const tracker = createOwnerTracker({ deviceId: phone });
  assert.equal(tracker.snapshot().isHost, false);
  assert.equal(tracker.update({ state: 'connecting', avatar_host: '' }).isHost, false);
  assert.equal(tracker.update({ state: 'connected', avatar_host: phone }).isHost, true);
  const disconnected = tracker.update({ state: 'disconnected', avatar_host: '' });
  assert.equal(disconnected.isHost, true);
  assert.equal(disconnected.ownerChanged, false);
});

test('Hub state refresh does not start enter or exit animations', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../apps/android/app/src/main/assets/web/js/app.js'), 'utf8');
  const hubStateBody = source.slice(source.indexOf('function onHubState'), source.indexOf('/* ------------------------------------------------------------------ mic / chat */'));
  const enterBody = source.slice(source.indexOf('async function onEnter'), source.indexOf('async function onCancel2'));
  const exitBody = source.slice(source.indexOf('async function onExit'), source.indexOf('async function onEnter'));
  assert.doesNotMatch(hubStateBody, /runAnim\(/);
  assert.match(enterBody, /runAnim\('enter'/);
  assert.match(exitBody, /runAnim\('exit'/);
});
