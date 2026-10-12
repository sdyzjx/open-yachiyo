/* Avatar transfer animation timeline (contract C1.5). Pure; UMD global YachiyoTransfer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YachiyoTransfer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
    const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return function ease(x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i += 1) {
        const err = sx(t) - x;
        if (Math.abs(err) < 1e-6) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      let lo = 0; let hi = 1; t = x;
      for (let i = 0; i < 24; i += 1) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }

  const SQUAT_MS = 120;
  const EXIT_MS = 480;
  const ENTER_MS = 520;
  const SQUAT_FRACTION = 0.02;
  const exitEase = cubicBezier(0.55, 0, 0.75, 0.2);
  const enterEase = cubicBezier(0.2, 0.8, 0.2, 1.1);
  const squatEase = (u) => 1 - (1 - u) * (1 - u);

  const exitDuration = () => SQUAT_MS + EXIT_MS;
  const enterDuration = () => ENTER_MS;
  const offscreenOffset = ({ viewH, modelH }) => viewH + modelH;

  // y offset in px (positive = down) applied on top of the resting position.
  function exitOffset(tMs, { viewH, modelH }) {
    const squat = viewH * SQUAT_FRACTION;
    if (tMs <= 0) return 0;
    if (tMs < SQUAT_MS) return squat * squatEase(tMs / SQUAT_MS);
    const u = Math.min(1, (tMs - SQUAT_MS) / EXIT_MS);
    return squat + (offscreenOffset({ viewH, modelH }) - squat) * exitEase(u);
  }

  function enterOffset(tMs, { viewH, modelH }) {
    const off = offscreenOffset({ viewH, modelH });
    if (tMs <= 0) return off;
    return off * (1 - enterEase(Math.min(1, tMs / ENTER_MS)));
  }

  return { cubicBezier, exitOffset, enterOffset, exitDuration, enterDuration, offscreenOffset, SQUAT_MS, EXIT_MS, ENTER_MS };
});
