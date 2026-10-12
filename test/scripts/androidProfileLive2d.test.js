'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile, summarize, parseArgs } = require('../../scripts/android-profile-live2d');

test('Live2D profiler parses an explicit CDP port and duration', () => {
  assert.deepEqual(parseArgs(['--port', '9223', '--duration', '6', '--swipe']), { port: 9223, durationMs: 6000, swipe: true });
  assert.throws(() => parseArgs([]), /--port is required/);
});

test('Live2D profiler reports rAF, draw, and worker rates separately', () => {
  assert.equal(percentile([1, 2, 9, 3], 0.95), 9);
  const report = summarize({
    rafFrames: 300, drawFrames: 90, workerFrames: 88,
    elapsedMs: 4000,
    frameIntervals: [16, 17], drawSamples: [5, 7], workerSamples: [31, 35],
    workerReady: true, workerActive: true, workerFailed: false,
    gl: { drawCalls: 123 }
  }, 5000, 'continuous-swipe');
  assert.equal(report.elapsedMs, 4000);
  assert.equal(report.hostElapsedMs, 5000);
  assert.equal(report.raf.fps, 75);
  assert.equal(report.draw.fps, 22.5);
  assert.equal(report.worker.fps, 22);
  assert.equal(report.worker.p95Ms, 35);
  assert.equal(report.mode, 'continuous-swipe');
  assert.equal(report.gl.drawCalls, 123);
});
