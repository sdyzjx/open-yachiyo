'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../apps/android/app/src/main/assets/web/js/layout.js');

const content = { x0: 0, y0: 0, x1: 1000, y1: 2000 };

test('spring converges to target without overshooting wildly and settles', () => {
  const s = L.createSpring({ value: 0, stiffness: 170, damping: 26 });
  s.to(1);
  let max = 0;
  for (let i = 0; i < 120; i += 1) { s.step(1 / 60); max = Math.max(max, s.value); }
  assert.ok(s.settled());
  assert.equal(s.value, 1);
  assert.ok(max < 1.1);
});

test('spring keeps release velocity when retargeted', () => {
  const s = L.createSpring({ value: 0.3, stiffness: 170, damping: 26 });
  s.to(1, 3);
  s.step(1 / 60);
  assert.ok(s.value > 0.3 + 3 / 60 * 0.5);
});

test('portrait full-body frame fits height with bottom margin', () => {
  const f = L.computeFrame({ viewW: 360, viewH: 640, content, focus: 'full' });
  const p = L.placeModel(f);
  assert.ok(Math.abs(p.y + 2000 * p.scale - (640 - 640 * 0.025)) < 1e-6);
  assert.ok(2000 * p.scale <= 640 * (1 - 0.04 - 0.025) + 1e-6);
  assert.ok(Math.abs(p.x + 500 * p.scale - 180) < 1e-6);
});

test('landscape upper-body focus uses top 55% of bounds and bleeds off bottom', () => {
  const f = L.computeFrame({ viewW: 640, viewH: 360, content, focus: 'upper' });
  const p = L.placeModel(f);
  const upperBottom = p.y + 2000 * 0.55 * p.scale;
  assert.ok(Math.abs(upperBottom - 360) < 1e-6);
  const full = L.computeFrame({ viewW: 640, viewH: 360, content, focus: 'full' });
  assert.ok(f.scale > full.scale * 1.5);
});

test('panel transforms: apps panel visible on left swipe, widgets on right swipe', () => {
  const geom = L.panelGeometry({ viewW: 800, viewH: 360 });
  const left = L.panelTransforms(-1, geom);
  assert.equal(left.modelDx, -geom.shiftPx);
  assert.equal(left.appsX, 0);
  assert.equal(left.widgetsX, -geom.panelW);
  const right = L.panelTransforms(1, geom);
  assert.equal(right.modelDx, geom.shiftPx);
  assert.equal(right.widgetsX, 0);
  assert.equal(right.appsX, geom.panelW);
  const mid = L.panelTransforms(0, geom);
  assert.equal(Math.abs(mid.modelDx), 0);
  assert.ok(Math.abs(mid.modelScaleMul - 1) < 1e-9);
});

test('rubberband resists beyond limits', () => {
  assert.equal(L.rubberband(0.5), 0.5);
  assert.ok(L.rubberband(1.5) < 1.2 && L.rubberband(1.5) > 1);
  assert.ok(L.rubberband(-1.5) > -1.2);
});

test('snap: slow short drag springs back, long drag commits, flick commits', () => {
  assert.equal(L.resolvePanelSnap({ progress: -0.15, velocity: 0, from: 0 }), 0);
  assert.equal(L.resolvePanelSnap({ progress: -0.45, velocity: 0, from: 0 }), -1);
  assert.equal(L.resolvePanelSnap({ progress: -0.1, velocity: -2, from: 0 }), -1);
  assert.equal(L.resolvePanelSnap({ progress: 0.1, velocity: 2, from: 0 }), 1);
  // from open panel: drag back past threshold closes, cannot skip to the other side
  assert.equal(L.resolvePanelSnap({ progress: -0.6, velocity: 0.4, from: -1 }), 0);
  assert.equal(L.resolvePanelSnap({ progress: -0.95, velocity: 0, from: -1 }), -1);
  assert.equal(L.resolvePanelSnap({ progress: 0.5, velocity: 5, from: -1 }), 0);
});

test('drawer snap by progress and velocity', () => {
  assert.equal(L.resolveDrawerSnap({ progress: 0.2, velocity: 0 }), 0);
  assert.equal(L.resolveDrawerSnap({ progress: 0.6, velocity: 0 }), 1);
  assert.equal(L.resolveDrawerSnap({ progress: 0.2, velocity: 2 }), 1);
  assert.equal(L.resolveDrawerSnap({ progress: 0.8, velocity: -2 }), 0);
});

test('gesture tracker locks axis after slop and reports velocity', () => {
  const g = L.createGestureTracker({ slop: 10 });
  g.down(100, 100, 0);
  assert.equal(g.move(104, 101, 10).axis, null);
  const r = g.move(130, 104, 50);
  assert.equal(r.axis, 'x');
  assert.ok(r.vx > 300);
  g.move(190, 106, 100);
  const up = g.up();
  assert.equal(up.axis, 'x');
  assert.ok(up.vx > 500);
  g.down(0, 0, 0);
  assert.equal(g.move(2, 40, 30).axis, 'y');
});

test('quality and focus resolution', () => {
  assert.equal(L.resolveQuality({ configured: 'auto', lowRam: true }), 2048);
  assert.equal(L.resolveQuality({ configured: 'auto', totalMemMb: 2048 }), 2048);
  assert.equal(L.resolveQuality({ configured: 'auto', totalMemMb: 6000 }), 4096);
  assert.equal(L.resolveQuality({ configured: '2048', totalMemMb: 6000 }), 2048);
  assert.equal(L.resolveFocus({ landscape: true, config: { landscape_focus: 'upper_body' } }), 'upper');
  assert.equal(L.resolveFocus({ landscape: true, config: { landscape_focus: 'full_body' } }), 'full');
  assert.equal(L.resolveFocus({ landscape: false, config: { portrait_full_body: true } }), 'full');
});
