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

  /* ---------- chat panel (B6 / B9) ---------- */

  // Screen-space box of the face: the top `faceRatio` of the drawn character. pose = { scale, x, y } as in placeModel.
  function faceRegion({ content, scale, x, y, faceRatio = 0.3 }) {
    const h = content.y1 - content.y0;
    return { left: x + content.x0 * scale, right: x + content.x1 * scale, top: y + content.y0 * scale, bottom: y + (content.y0 + h * faceRatio) * scale };
  }

  // Portrait chat panel: sits above the input bar and never rises into the face region.
  // bottomOffset = distance from the screen bottom to the panel's bottom edge (already includes IME height).
  function chatPanelBounds({ viewH, faceBottom, bottomOffset, gap = 10, maxRatio = 0.42, minHeight = 56 }) {
    const room = viewH - bottomOffset - (faceBottom + gap);
    const maxHeight = Math.max(0, Math.min(viewH * maxRatio, room));
    return { maxHeight: Math.floor(maxHeight), hidden: maxHeight < minHeight };
  }

  function modelScreenBounds({ content, scale, x, y }) {
    return {
      left: x + content.x0 * scale,
      top: y + content.y0 * scale,
      right: x + content.x1 * scale,
      bottom: y + content.y1 * scale
    };
  }

  function rectWidth(r) { return Math.max(0, r.right - r.left); }
  function rectHeight(r) { return Math.max(0, r.bottom - r.top); }
  function overlapsX(a, b, gap = 0) { return a.left < b.right + gap && a.right > b.left - gap; }

  // Calculates one snapped chat state. panelState: 0=center, -1=right drawer, +1=left drawer.
  // `hud` accepts input/transfer/settings/pluginPanel rectangles; `sidePanel` is the fully-open drawer.
  function computeChatPanelLayout({
    viewport, modelBounds, panelState = 0, panelWidth = 0, hud = {}, sidePanel = null,
    neckRatio = 0.24, margin = 14, gap = 10, minHeight = 56, preferredSide = 'left'
  }) {
    const viewW = Math.max(0, viewport.width);
    const viewH = Math.max(0, viewport.height);
    const landscape = viewW > viewH;
    const modelH = rectHeight(modelBounds);
    const neckY = clamp(modelBounds.top + modelH * neckRatio, margin, viewH - margin);
    const inputTop = hud.input ? hud.input.top : viewH - margin;
    let bottom = clamp(inputTop - gap, margin, viewH - margin);
    let left = margin;
    let right = viewW - margin;

    if (landscape && panelState === 0) {
      const leftSpace = Math.max(0, modelBounds.left - gap - margin);
      const rightSpace = Math.max(0, viewW - margin - modelBounds.right - gap);
      const useLeft = leftSpace === rightSpace ? preferredSide !== 'right' : leftSpace > rightSpace;
      if (useLeft) right = Math.max(left, modelBounds.left - gap);
      else left = Math.min(right, modelBounds.right + gap);
    } else if (landscape && panelState !== 0) {
      const drawer = sidePanel || (panelState < 0
        ? { left: viewW - panelWidth, right: viewW }
        : { left: 0, right: panelWidth });
      if (panelState < 0) right = Math.min(right, drawer.left - gap);
      else left = Math.max(left, drawer.right + gap);
    }

    // A plugin sheet is also a hard horizontal exclusion zone.
    if (hud.pluginPanel) {
      if (hud.pluginPanel.left >= viewW / 2) right = Math.min(right, hud.pluginPanel.left - gap);
      else left = Math.max(left, hud.pluginPanel.right + gap);
    }

    let top = neckY + gap;
    const horizontal = { left, right };
    for (const obstacle of [hud.transfer, hud.settings]) {
      if (obstacle && overlapsX(horizontal, obstacle, gap) && obstacle.bottom > top) top = obstacle.bottom + gap;
    }
    top = clamp(top, margin, bottom);

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const centerX = (left + right) / 2;
    const modelCenterX = (modelBounds.left + modelBounds.right) / 2;
    const alignment = landscape && panelState === 0 ? (centerX < modelCenterX ? 1 : -1) : 0;
    return {
      left, top, right, bottom, width, height, neckY,
      hidden: width < 120 || height < minHeight,
      style: {
        radius: landscape && panelState !== 0 ? 14 : 20,
        opacity: landscape && panelState !== 0 ? 0.9 : 0.96,
        alignment
      }
    };
  }

  // Landscape center: agent messages occupy the left lane, user messages the right lane.
  function computeChatSplitLayout({
    viewport, modelBounds, hud = {}, margin = 14, gap = 16,
    maxWidth = 420, minWidth = 96, minHeight = 72
  }) {
    const viewW = Math.max(0, viewport.width);
    const viewH = Math.max(0, viewport.height);
    const bottomLimit = hud.input ? hud.input.top - gap : viewH - margin;
    const topObstacles = [hud.status, hud.transfer, hud.settings].filter(Boolean);
    const bottomObstacles = [hud.input, hud.mic, hud.chat, hud.send].filter(Boolean);

    function lane(left, right, alignment) {
      let top = margin;
      let bottom = Math.min(viewH - margin, bottomLimit);
      const horizontal = { left, right };
      for (const obstacle of topObstacles) {
        if (overlapsX(horizontal, obstacle, gap)) top = Math.max(top, obstacle.bottom + gap);
      }
      for (const obstacle of bottomObstacles) {
        if (overlapsX(horizontal, obstacle, gap)) bottom = Math.min(bottom, obstacle.top - gap);
      }
      top = clamp(top, margin, viewH - margin);
      bottom = clamp(bottom, top, viewH - margin);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      return {
        left, top, right, bottom, width, height,
        hidden: width < minWidth || height < minHeight,
        style: { radius: 20, opacity: 0.96, alignment }, presence: 1
      };
    }

    const agentRight = clamp(modelBounds.left - gap, margin, viewW - margin);
    const userLeft = clamp(modelBounds.right + gap, margin, viewW - margin);
    const agent = lane(Math.max(margin, agentRight - maxWidth), agentRight, 1);
    const user = lane(userLeft, Math.min(viewW - margin, userLeft + maxWidth), -1);
    return { agent, user, hidden: agent.hidden && user.hidden };
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  // Pure state interpolation used both while following the finger and during spring snap.
  function interpolateChatPanelLayout(a, b, progress) {
    const t = clamp(progress, 0, 1);
    const out = {};
    for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height', 'neckY']) out[key] = lerp(a[key], b[key], t);
    out.hidden = (t === 0 ? a.hidden : (t === 1 ? b.hidden : out.width < 120 || out.height < 56));
    out.style = {
      radius: lerp(a.style.radius, b.style.radius, t),
      opacity: lerp(a.style.opacity, b.style.opacity, t),
      alignment: lerp(a.style.alignment, b.style.alignment, t)
    };
    return out;
  }

  function withPresence(layout, presence) {
    return { ...layout, style: { ...layout.style }, presence };
  }

  // Morphs two independent center lanes into one chronological drawer panel.
  function interpolateSplitChatLayout({ split, merged, progress }) {
    const t = clamp(progress, 0, 1);
    const agent = interpolateChatPanelLayout(split.agent, merged, t);
    const user = interpolateChatPanelLayout(split.user, merged, t);
    return {
      agent: withPresence(agent, 1 - t),
      user: withPresence(user, 1 - t),
      merged: withPresence(merged, t)
    };
  }

  function singleChatPresentation(merged) {
    return {
      agent: withPresence(merged, 0), user: withPresence(merged, 0), merged: withPresence(merged, 1)
    };
  }

  function interpolateChatPresentation(a, b, progress) {
    const t = clamp(progress, 0, 1);
    const out = {};
    for (const key of ['agent', 'user', 'merged']) {
      out[key] = interpolateChatPanelLayout(a[key], b[key], t);
      out[key].presence = lerp(a[key].presence, b[key].presence, t);
    }
    return out;
  }

  function remapChatPanelLayout(layout, fromViewport, toViewport) {
    if (!layout || !fromViewport.width || !fromViewport.height) return layout;
    const sx = toViewport.width / fromViewport.width;
    const sy = toViewport.height / fromViewport.height;
    const mapped = { ...layout, style: { ...layout.style } };
    for (const key of ['left', 'right', 'width']) mapped[key] *= sx;
    for (const key of ['top', 'bottom', 'height', 'neckY']) mapped[key] *= sy;
    return mapped;
  }

  function remapChatPresentation(presentation, fromViewport, toViewport) {
    if (!presentation) return presentation;
    const out = {};
    for (const key of ['agent', 'user', 'merged']) {
      out[key] = remapChatPanelLayout(presentation[key], fromViewport, toViewport);
      out[key].presence = presentation[key].presence;
    }
    return out;
  }

  // True when the scroll container is within `threshold` px of its end (so new text should keep it pinned).
  function isNearBottom({ scrollTop, clientHeight, scrollHeight }, threshold = 24) {
    return scrollHeight - scrollTop - clientHeight <= threshold;
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
      widgetsOpacity: clamp(p * 1.4, 0, 1),
      // The settings button stays immediately outside the right-side plugin panel.
      settingsX: p < 0 ? -geom.panelW * clamp(-p, 0, 1) : 0
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

  function isLandscape(w, h) { return w > h; }

  // Which camera focus applies to the current orientation and config.
  function resolveFocus({ landscape, config = {} }) {
    if (landscape) return config.landscape_focus === 'full_body' ? 'full' : 'upper';
    return config.portrait_full_body === false ? 'upper' : 'full';
  }

  return {
    clamp, stepSpring, createSpring, computeFrame, placeModel, faceRegion, chatPanelBounds, modelScreenBounds,
    computeChatPanelLayout, computeChatSplitLayout, interpolateChatPanelLayout, interpolateSplitChatLayout,
    singleChatPresentation, interpolateChatPresentation, remapChatPanelLayout, remapChatPresentation,
    isNearBottom, panelGeometry, panelTransforms,
    rubberband, SNAP, resolvePanelSnap, resolveDrawerSnap, createGestureTracker, resolveQuality, isLandscape, resolveFocus
  };
});
