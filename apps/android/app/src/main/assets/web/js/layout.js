/* Pure layout / gesture / spring logic for the Android stage (no DOM). UMD: browser global YachiyoLayout, Node require. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YachiyoLayout = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- springs ---------- */

  // Semi-implicit Euler in fixed substeps: stable for stiff springs at 16-50 ms frames.
  function stepSpring(s, dt) {
    const sub = 1 / 240;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-9) {
      const h = Math.min(sub, remaining);
      const force = -s.stiffness * (s.value - s.target) - s.damping * s.velocity;
      s.velocity += force * h;
      s.value += s.velocity * h;
      remaining -= h;
    }
    return s;
  }

  function createSpring({ value = 0, stiffness = 170, damping = 26, precision = 0.0005 } = {}) {
    const s = { value, target: value, velocity: 0, stiffness, damping, precision };
    s.step = (dt) => { stepSpring(s, dt); if (s.settled()) { s.value = s.target; s.velocity = 0; } return s.value; };
    s.settled = () => Math.abs(s.value - s.target) < s.precision && Math.abs(s.velocity) < s.precision * 20;
    s.snap = (v) => { s.value = v; s.target = v; s.velocity = 0; };
    s.to = (target, velocity) => { s.target = target; if (velocity !== undefined) s.velocity = velocity; };
    return s;
  }

  /* ---------- camera framing ---------- */

  // content: model-local pixel box of the drawn character at scale 1.
  function computeFrame({ viewW, viewH, content, focus = 'full', upperRatio = 0.55, marginTop = 0.04, marginBottom = 0.025, marginX = 0.04 }) {
    const full = { x0: content.x0, y0: content.y0, x1: content.x1, y1: content.y1 };
    const box = { ...full };
    if (focus === 'upper') box.y1 = full.y0 + (full.y1 - full.y0) * upperRatio;
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const topPx = viewH * marginTop;
    const bottomPx = focus === 'upper' ? 0 : viewH * marginBottom;
    const scale = Math.min((viewW * (1 - 2 * marginX)) / bw, (viewH - topPx - bottomPx) / bh);
    return {
      scale,
      anchorX: viewW / 2,
      anchorBottom: viewH - bottomPx,
      boxCx: (box.x0 + box.x1) / 2,
      boxY1: box.y1,
      boxHeightPx: bh * scale
    };
  }

  // Resolve model position from a frame plus panel shift / scale multiplier.
  function placeModel(frame, { dx = 0, dy = 0, scaleMul = 1 } = {}) {
    const scale = frame.scale * scaleMul;
    return { scale, x: frame.anchorX + dx - frame.boxCx * scale, y: frame.anchorBottom + dy - frame.boxY1 * scale };
  }

  /* ---------- panels ---------- */

  function panelGeometry({ viewW, viewH }) {
    const panelW = clamp(viewW * 0.46, 260, 560);
    return { panelW, shiftPx: panelW / 2, viewW, viewH };
  }

  // p in [-1, 1]. p<0: character left, apps panel (right). p>0: character right, widgets panel (left).
  function panelTransforms(p, geom) {
    return {
      modelDx: p * geom.shiftPx,
      modelScaleMul: 1 - 0.05 * Math.min(1, Math.abs(p)),
      appsX: p < 0 ? geom.panelW * (1 + p) : geom.panelW,       // translateX of right panel (px)
      widgetsX: (p > 0 ? -geom.panelW * (1 - p) : -geom.panelW) + 0,  // translateX of left panel (px)
      appsOpacity: clamp(-p * 1.4, 0, 1),
      widgetsOpacity: clamp(p * 1.4, 0, 1)
    };
  }

  function rubberband(p, limit = 1, resistance = 0.35) {
    if (p > limit) return limit + (p - limit) * resistance;
    if (p < -limit) return -limit + (p + limit) * resistance;
    return p;
  }

  const SNAP = { flickVelocity: 1.1, changeThreshold: 0.3, projectionSec: 0.12 };

  // velocity in progress-units per second. returns -1 | 0 | 1.
  function resolvePanelSnap({ progress, velocity, from }) {
    const projected = progress + velocity * SNAP.projectionSec;
    const delta = projected - from;
    let target = from;
    if (Math.abs(velocity) >= SNAP.flickVelocity || Math.abs(delta) >= SNAP.changeThreshold) {
      target = from + (delta > 0 ? 1 : -1);
    }
    return clamp(target, -1, 1);
  }

  function resolveDrawerSnap({ progress, velocity }) {
    const projected = progress + velocity * 0.12;
    if (velocity > 1.2) return 1;
    if (velocity < -1.2) return 0;
    return projected > 0.5 ? 1 : 0;
  }

  /* ---------- gesture tracker (axis lock + velocity) ---------- */

  function createGestureTracker({ slop = 10, lockRatio = 1.15, velocityWindowMs = 90 } = {}) {
    let start = null;
    let samples = [];
    let axis = null;
    function velocity() {
      if (samples.length < 2) return { vx: 0, vy: 0 };
      const last = samples[samples.length - 1];
      let first = samples[0];
      for (const s of samples) { if (last.t - s.t <= velocityWindowMs) { first = s; break; } }
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return { vx: 0, vy: 0 };
      return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
    }
    return {
      down(x, y, t) { start = { x, y, t }; samples = [{ x, y, t }]; axis = null; },
      move(x, y, t) {
        if (!start) return null;
        samples.push({ x, y, t });
        if (samples.length > 24) samples.shift();
        const dx = x - start.x;
        const dy = y - start.y;
        if (!axis) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          if (Math.max(ax, ay) >= slop) axis = ax > ay * lockRatio ? 'x' : (ay > ax * lockRatio ? 'y' : null);
        }
        return { axis, dx, dy, ...velocity() };
      },
      up() { const v = velocity(); const out = { axis, ...v }; start = null; samples = []; axis = null; return out; },
      get axis() { return axis; },
      get active() { return !!start; }
    };
  }

  /* ---------- misc ---------- */

  function resolveQuality({ configured = 'auto', lowRam = false, totalMemMb = 0 }) {
    if (configured === '4096' || configured === '2048') return Number(configured);
    return lowRam || (totalMemMb > 0 && totalMemMb < 3000) ? 2048 : 4096;
  }

  // Rendering profile for Android WebView. Texture size controls memory and Cubism Core runs in a worker.
  function resolvePerformanceProfile({ configured = 'auto', lowRam = false, totalMemMb = 0, dpr = 1 } = {}) {
    const constrained = lowRam || (totalMemMb > 0 && totalMemMb <= 6144);
    const quality = configured === '4096' || configured === '2048'
      ? Number(configured)
      : (constrained ? 2048 : 4096);
    return {
      quality,
      resolution: Math.min(Math.max(Number(dpr) || 1, 1), constrained ? 1.25 : 1.5),
      constrained
    };
  }

  function isLandscape(w, h) { return w > h; }

  // Which camera focus applies to the current orientation and config.
  function resolveFocus({ landscape, config = {} }) {
    if (landscape) return config.landscape_focus === 'full_body' ? 'full' : 'upper';
    return config.portrait_full_body === false ? 'upper' : 'full';
  }

  return {
    clamp, stepSpring, createSpring, computeFrame, placeModel, panelGeometry, panelTransforms,
    rubberband, SNAP, resolvePanelSnap, resolveDrawerSnap, createGestureTracker, resolveQuality,
    resolvePerformanceProfile, isLandscape, resolveFocus
  };
});
