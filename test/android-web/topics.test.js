'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchTopic, patternCovers } = require('../../apps/android/app/src/main/assets/web/js/topics.js');

test('matchTopic: exact, single-segment and multi-segment wildcards', () => {
  assert.ok(matchTopic('avatar.transfer.enter', 'avatar.transfer.enter'));
  assert.ok(matchTopic('avatar.*', 'avatar.host'));
  assert.ok(!matchTopic('avatar.*', 'avatar.transfer.enter'));
  assert.ok(matchTopic('avatar.**', 'avatar.transfer.enter'));
  assert.ok(!matchTopic('avatar.**', 'avatar'));
  assert.ok(matchTopic('plugin.com.x.**', 'plugin.com.x.tick.a'));
  assert.ok(!matchTopic('plugin.com.x.**', 'plugin.com.y.tick'));
  assert.ok(matchTopic('*', 'anything.at.all'));
  assert.ok(!matchTopic('a.b', 'a.b.c'));
  assert.ok(!matchTopic('a.b.c', 'a.b'));
  assert.ok(!matchTopic('', 'a'));
});

test('patternCovers: allowed patterns must contain the requested pattern', () => {
  assert.ok(patternCovers('task.*', 'task.update'));
  assert.ok(patternCovers('task.*', 'task.*'));
  assert.ok(!patternCovers('task.*', 'task.**'));
  assert.ok(!patternCovers('task.*', 'task.a.b'));
  assert.ok(patternCovers('task.**', 'task.a.b'));
  assert.ok(patternCovers('task.**', 'task.*'));
  assert.ok(!patternCovers('task.update', 'task.*'));
  assert.ok(!patternCovers('task.*', '*'));
  assert.ok(patternCovers('*', 'x.**'));
  assert.ok(!patternCovers('task.*', 'chat.delta'));
});
