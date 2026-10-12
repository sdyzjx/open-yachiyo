'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../apps/android/app/src/main/assets/web/js/transfer.js');

const dims = { viewH: 640, modelH: 500 };

test('cubic bezier hits endpoints and is monotonic for the exit curve', () => {
  const e = T.cubicBezier(0.55, 0, 0.75, 0.2);
  assert.equal(e(0), 0);
  assert.equal(e(1), 1);
  let prev = 0;
  for (let i = 1; i <= 20; i += 1) { const v = e(i / 20); assert.ok(v >= prev); prev = v; }
  assert.ok(e(0.5) < 0.3, 'ease-in curve is slow at the start');
});

test('enter curve overshoots slightly (bounce)', () => {
  const e = T.cubicBezier(0.2, 0.8, 0.2, 1.1);
  let max = 0;
  for (let i = 0; i <= 100; i += 1) max = Math.max(max, e(i / 100));
  assert.ok(max > 1.0);
});

test('exit: squat 2% in 120ms then leaves the screen in 480ms', () => {
  assert.equal(T.exitDuration(), 600);
  assert.equal(T.exitOffset(0, dims), 0);
  assert.ok(Math.abs(T.exitOffset(120, dims) - 640 * 0.02) < 1e-6);
  assert.ok(T.exitOffset(60, dims) > 0 && T.exitOffset(60, dims) < 640 * 0.02);
  assert.ok(Math.abs(T.exitOffset(600, dims) - 1140) < 1e-6);
  assert.ok(T.exitOffset(300, dims) < T.exitOffset(450, dims));
});

test('enter: starts below the screen, ends at rest with a small overshoot above', () => {
  assert.equal(T.enterOffset(0, dims), 1140);
  assert.ok(Math.abs(T.enterOffset(520, dims)) < 1e-6);
  let minOffset = Infinity;
  for (let t = 0; t <= 520; t += 5) minOffset = Math.min(minOffset, T.enterOffset(t, dims));
  assert.ok(minOffset < 0, 'rebounds above the resting position');
  assert.ok(minOffset > -dims.viewH * 0.15);
});
