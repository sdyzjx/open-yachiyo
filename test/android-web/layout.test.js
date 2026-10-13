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
  assert.equal(left.settingsX, -geom.panelW);
  const right = L.panelTransforms(1, geom);
  assert.equal(right.modelDx, geom.shiftPx);
  assert.equal(right.widgetsX, 0);
  assert.equal(right.appsX, geom.panelW);
  assert.equal(right.settingsX, 0);
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
  assert.equal(L.resolveChatFaceRatio('upper'), 0.2);
  assert.equal(L.resolveChatFaceRatio('full'), 0.3);
});

test('face region covers the top 30% of the drawn character in screen space', () => {
  const f = L.computeFrame({ viewW: 1080, viewH: 1920, content: { x0: 0, y0: 0, x1: 1000, y1: 2000 }, focus: 'full' });
  const p = L.placeModel(f);
  const face = L.faceRegion({ content: { x0: 0, y0: 0, x1: 1000, y1: 2000 }, scale: p.scale, x: p.x, y: p.y });
  assert.ok(Math.abs(face.top - 1920 * 0.04) < 1);
  assert.ok(Math.abs(face.bottom - (face.top + 0.3 * 2000 * p.scale)) < 1e-6);
  assert.ok(face.bottom < 1920 * 0.4);
});

test('chat panel stays below the face, is capped, and hides when there is no room', () => {
  const roomy = L.chatPanelBounds({ viewH: 1920, faceBottom: 650, bottomOffset: 92 });
  assert.equal(roomy.hidden, false);
  assert.equal(roomy.maxHeight, Math.floor(1920 * 0.42)); // capped by max ratio, top edge = 1920-92-806 = 1022 > face bottom
  assert.ok(1920 - 92 - roomy.maxHeight >= 650 + 10);
  const withIme = L.chatPanelBounds({ viewH: 1920, faceBottom: 650, bottomOffset: 92 + 800 });
  assert.equal(withIme.maxHeight, 1920 - 892 - 660); // 368: limited by the face, not by the cap
  const cramped = L.chatPanelBounds({ viewH: 1920, faceBottom: 650, bottomOffset: 92 + 1200 });
  assert.equal(cramped.hidden, true);
  assert.equal(cramped.maxHeight >= 0, true);
});

test('B9 portrait chat stays below the 24% neck line and above the input', () => {
  const modelBounds = { left: 80, top: 40, right: 280, bottom: 600 };
  const result = L.computeChatPanelLayout({
    viewport: { width: 360, height: 640 }, modelBounds,
    hud: { input: { left: 0, top: 560, right: 360, bottom: 640 } }
  });
  const neckY = 40 + (600 - 40) * 0.24;
  assert.equal(result.neckY, neckY);
  assert.ok(result.top >= neckY + 10);
  assert.ok(result.bottom <= 550);
  assert.deepEqual([result.left, result.right], [14, 346]);
  assert.equal(result.hidden, false);
});

test('B9 landscape center uses the wider blank side and avoids HUD rectangles', () => {
  const result = L.computeChatPanelLayout({
    viewport: { width: 640, height: 360 },
    modelBounds: { left: 260, top: 10, right: 400, bottom: 500 },
    preferredSide: 'left',
    hud: {
      input: { left: 0, top: 304, right: 640, bottom: 360 },
      transfer: { left: 38, top: 90, right: 210, bottom: 160 },
      settings: { left: 584, top: 10, right: 626, bottom: 52 }
    }
  });
  assert.ok(result.right <= 250); // left of the character plus the 10 px gap
  assert.ok(result.top >= 170); // pushed under the overlapping transfer control
  assert.ok(result.bottom <= 294); // above the input bar plus gap
  assert.equal(result.style.alignment, 1);
});

test('B9 landscape center split lanes fill both sides and avoid every HUD rectangle', () => {
  const result = L.computeChatSplitLayout({
    viewport: { width: 640, height: 360 },
    modelBounds: { left: 250, top: 10, right: 390, bottom: 500 },
    hud: {
      status: { left: 18, top: 18, right: 26, bottom: 26 },
      transfer: { left: 38, top: 10, right: 220, bottom: 50 },
      settings: { left: 584, top: 10, right: 626, bottom: 52 },
      input: { left: 0, top: 304, right: 640, bottom: 360 },
      chat: { left: 22, top: 290, right: 70, bottom: 338 },
      mic: { left: 554, top: 282, right: 618, bottom: 346 }
    }
  });
  assert.deepEqual([result.agent.left, result.agent.right], [14, 312]);
  assert.deepEqual([result.user.left, result.user.right], [328, 626]);
  assert.ok(result.agent.top >= 173);
  assert.ok(result.user.top >= 173);
  assert.ok(result.agent.bottom <= 274);
  assert.ok(result.user.bottom <= 266);
  assert.equal(result.hidden, false);
});

test('TC-AWB-051 Xiaomi 6 upper-body framing keeps the landscape chat panel visible', () => {
  const modelBounds = {
    left: 162.27228501652118, top: 14.4,
    right: 477.7277149834788, bottom: 642.7636363636365
  };
  const hud = { input: { left: 0, top: 282, right: 640, bottom: 360 } };
  const oldLayout = L.computeChatSplitLayout({
    viewport: { width: 640, height: 360 }, modelBounds, hud, faceRatio: 0.3
  });
  const layout = L.computeChatWideLayout({
    viewport: { width: 640, height: 360 }, modelBounds, hud,
    faceRatio: L.resolveChatFaceRatio('upper')
  });
  assert.equal(oldLayout.hidden, true);
  assert.equal(layout.hidden, false);
  assert.ok(layout.top >= layout.neckY + 12);
  assert.ok(layout.height >= 110);
  assert.equal(layout.width, 612);
});

test('TC-AWB-039 landscape centre uses one wide readable chat panel', () => {
  const modelBounds = {
    left: 162.27228501652118, top: 14.4,
    right: 477.7277149834788, bottom: 642.7636363636365
  };
  const layout = L.computeChatWideLayout({
    viewport: { width: 640, height: 360 }, modelBounds,
    hud: { input: { left: 0, top: 282, right: 640, bottom: 360 } },
    faceRatio: L.resolveChatFaceRatio('upper')
  });
  assert.deepEqual([layout.left, layout.right, layout.width], [14, 626, 612]);
  assert.ok(layout.top >= layout.neckY + 12);
  assert.ok(layout.height >= 110);
  assert.equal(layout.hidden, false);
});

test('B9 split lanes use the wide lower screen while staying below the face region', () => {
  const result = L.computeChatSplitLayout({
    viewport: { width: 1600, height: 700 },
    modelBounds: { left: 500, top: 0, right: 1100, bottom: 900 },
    hud: {}
  });
  assert.deepEqual([result.agent.left, result.agent.right, result.agent.width], [14, 792, 778]);
  assert.deepEqual([result.user.left, result.user.right, result.user.width], [808, 1586, 778]);
  assert.equal(result.agent.top, 286);
  assert.equal(result.user.top, 286);
  assert.equal(result.agent.neckY, 270);
});

test('B9 open side layouts exclude either drawer and plugin sheet', () => {
  const base = {
    viewport: { width: 640, height: 360 },
    modelBounds: { left: 200, top: 8, right: 440, bottom: 500 },
    panelWidth: 294,
    hud: { input: { left: 0, top: 304, right: 640, bottom: 360 } }
  };
  const apps = L.computeChatPanelLayout({ ...base, panelState: -1,
    sidePanel: { left: 346, top: 0, right: 640, bottom: 360 } });
  assert.ok(apps.right <= 336);
  const widgets = L.computeChatPanelLayout({ ...base, panelState: 1,
    sidePanel: { left: 0, top: 0, right: 294, bottom: 360 } });
  assert.ok(widgets.left >= 304);
  const fullPlugin = L.computeChatPanelLayout({ ...base, panelState: -1,
    hud: { ...base.hud, pluginPanel: { left: 0, top: 0, right: 640, bottom: 360 } } });
  assert.equal(fullPlugin.hidden, true);
});

test('B9 chat interpolation is exact at t=0/0.5/1 and clamps boundaries', () => {
  const a = { left: 10, top: 100, right: 210, bottom: 300, width: 200, height: 200, neckY: 90, hidden: false,
    style: { radius: 20, opacity: 0.96, alignment: 1 } };
  const b = { left: 300, top: 150, right: 620, bottom: 290, width: 320, height: 140, neckY: 140, hidden: false,
    style: { radius: 14, opacity: 0.9, alignment: 0 } };
  assert.deepEqual(L.interpolateChatPanelLayout(a, b, 0), a);
  assert.deepEqual(L.interpolateChatPanelLayout(a, b, 1), b);
  const mid = L.interpolateChatPanelLayout(a, b, 0.5);
  assert.equal(mid.left, 155);
  assert.equal(mid.width, 260);
  assert.equal(mid.style.radius, 17);
  assert.ok(Math.abs(mid.style.opacity - 0.93) < 1e-9);
  assert.equal(mid.style.alignment, 0.5);
  assert.deepEqual(L.interpolateChatPanelLayout(a, b, -2), a);
  assert.deepEqual(L.interpolateChatPanelLayout(a, b, 2), b);
});

test('B9 split lanes interpolate into one merged panel at t=0/0.5/1', () => {
  const style = { radius: 20, opacity: 0.96, alignment: 1 };
  const agent = { left: 14, top: 60, right: 230, bottom: 280, width: 216, height: 220, neckY: 0, hidden: false, style, presence: 1 };
  const user = { left: 410, top: 64, right: 626, bottom: 270, width: 216, height: 206, neckY: 0, hidden: false,
    style: { ...style, alignment: -1 }, presence: 1 };
  const merged = { left: 14, top: 180, right: 336, bottom: 288, width: 322, height: 108, neckY: 170, hidden: false,
    style: { radius: 14, opacity: 0.9, alignment: 0 } };
  const start = L.interpolateSplitChatLayout({ split: { agent, user }, merged, progress: 0 });
  assert.deepEqual(start.agent, agent);
  assert.deepEqual(start.user, user);
  assert.equal(start.merged.presence, 0);
  const mid = L.interpolateSplitChatLayout({ split: { agent, user }, merged, progress: 0.5 });
  assert.equal(mid.agent.left, 14);
  assert.equal(mid.agent.top, 120);
  assert.equal(mid.user.left, 212);
  assert.equal(mid.agent.presence, 0.5);
  assert.equal(mid.merged.presence, 0.5);
  const end = L.interpolateSplitChatLayout({ split: { agent, user }, merged, progress: 1 });
  assert.equal(end.agent.presence, 0);
  assert.equal(end.user.presence, 0);
  assert.equal(end.merged.presence, 1);
  assert.deepEqual([end.agent.left, end.agent.top, end.agent.width], [merged.left, merged.top, merged.width]);
});

test('B9 orientation remap preserves normalized rectangle before interpolation', () => {
  const layout = { left: 36, top: 128, right: 324, bottom: 548, width: 288, height: 420, neckY: 120,
    hidden: false, style: { radius: 20, opacity: 0.96, alignment: 0 } };
  const mapped = L.remapChatPanelLayout(layout, { width: 360, height: 640 }, { width: 640, height: 360 });
  assert.equal(mapped.left, 64);
  assert.equal(mapped.top, 72);
  assert.equal(mapped.width, 512);
  assert.equal(mapped.height, 236.25);
  assert.deepEqual(mapped.style, layout.style);
});

test('isNearBottom pins only when the reader has not scrolled up', () => {
  assert.equal(L.isNearBottom({ scrollTop: 500, clientHeight: 300, scrollHeight: 810 }), true);
  assert.equal(L.isNearBottom({ scrollTop: 200, clientHeight: 300, scrollHeight: 810 }), false);
});
