/* Widget grid layout (4 columns). Pure. UMD global YachiyoPluginGrid. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YachiyoPluginGrid = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLS = 4;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function sizeFor(manifest, entry) {
    const w = (manifest.widget) || {};
    const minW = w.min_w || 1; const minH = w.min_h || 1;
    const maxW = Math.min(w.max_w || COLS, COLS); const maxH = w.max_h || 4;
    const rw = entry && entry.w ? entry.w : (w.w || 2);
    const rh = entry && entry.h ? entry.h : (w.h || 1);
    return { w: clamp(rw, minW, maxW), h: clamp(rh, minH, maxH) };
  }

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  function autoPlace(placed, w, h, cols = COLS) {
    for (let y = 0; y < 200; y += 1) {
      for (let x = 0; x + w <= cols; x += 1) {
        const rect = { x, y, w, h };
        if (!placed.some((p) => overlaps(p, rect))) return rect;
      }
    }
    return { x: 0, y: 0, w, h };
  }

  // widgets: manifests; layout: saved [{id,x,y,w,h}]. Returns a collision-free layout covering exactly `widgets`.
  function normalizeLayout(layout, widgets, cols = COLS) {
    const saved = new Map((layout || []).map((e) => [e.id, e]));
    const ordered = widgets.slice().sort((a, b) => {
      const ea = saved.get(a.id); const eb = saved.get(b.id);
      if (ea && eb) return ea.y - eb.y || ea.x - eb.x;
      return ea ? -1 : (eb ? 1 : 0);
    });
    const placed = [];
    for (const m of ordered) {
      const e = saved.get(m.id);
      const { w, h } = sizeFor(m, e);
      let rect = null;
      if (e && Number.isInteger(e.x) && Number.isInteger(e.y) && e.x >= 0 && e.y >= 0 && e.x + w <= cols) {
        const cand = { x: e.x, y: e.y, w, h };
        if (!placed.some((p) => overlaps(p, cand))) rect = cand;
      }
      placed.push({ id: m.id, ...(rect || autoPlace(placed, w, h, cols)) });
    }
    return placed;
  }

  // Move one widget; others that collide are pushed down (reflowed top-to-bottom).
  function moveItem(layout, id, x, y, cols = COLS) {
    const target = layout.find((e) => e.id === id);
    if (!target) return layout;
    const moved = { ...target, x: clamp(x, 0, cols - target.w), y: Math.max(0, y) };
    const rest = layout.filter((e) => e.id !== id).sort((a, b) => a.y - b.y || a.x - b.x);
    const placed = [moved];
    for (const item of rest) {
      const next = { ...item };
      while (placed.some((p) => overlaps(p, next))) next.y += 1;
      placed.push(next);
    }
    return layout.map((e) => placed.find((p) => p.id === e.id));
  }

  function rowsUsed(layout) { return layout.reduce((m, e) => Math.max(m, e.y + e.h), 0); }

  return { COLS, sizeFor, overlaps, autoPlace, normalizeLayout, moveItem, rowsUsed };
});
