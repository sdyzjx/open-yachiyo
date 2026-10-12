'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../apps/android/app/src/main/assets/web/js/pluginGrid.js');

const mk = (id, w = 2, h = 1, extra = {}) => ({ id, type: 'widget', widget: { w, h, ...extra } });

test('autoPlace fills rows left-to-right then wraps', () => {
  const layout = G.normalizeLayout([], [mk('a'), mk('b'), mk('c')]);
  assert.deepEqual(layout.map((e) => [e.x, e.y]), [[0, 0], [2, 0], [0, 1]]);
});

test('saved layout is honoured, collisions are re-placed, sizes clamped to manifest limits', () => {
  const saved = [{ id: 'a', x: 0, y: 0, w: 9, h: 9 }, { id: 'b', x: 1, y: 0, w: 2, h: 1 }];
  const layout = G.normalizeLayout(saved, [mk('a', 2, 1, { max_w: 3, max_h: 2 }), mk('b')]);
  const a = layout.find((e) => e.id === 'a');
  const b = layout.find((e) => e.id === 'b');
  assert.deepEqual([a.w, a.h], [3, 2]);
  assert.equal(G.overlaps(a, b), false);
});

test('moveItem pushes colliding widgets down and clamps to grid', () => {
  const layout = G.normalizeLayout([], [mk('a'), mk('b')]);
  const moved = G.moveItem(layout, 'b', 0, 0);
  const a = moved.find((e) => e.id === 'a');
  const b = moved.find((e) => e.id === 'b');
  assert.deepEqual([b.x, b.y], [0, 0]);
  assert.equal(G.overlaps(a, b), false);
  const clamped = G.moveItem(layout, 'a', 9, 0);
  assert.equal(clamped.find((e) => e.id === 'a').x, 2);
});

test('removed plugins drop out of the layout', () => {
  const layout = G.normalizeLayout([{ id: 'gone', x: 0, y: 0, w: 2, h: 1 }], [mk('a')]);
  assert.deepEqual(layout.map((e) => e.id), ['a']);
});
