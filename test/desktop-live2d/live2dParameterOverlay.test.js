'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLive2dParameterOverlay } = require('../../apps/desktop-live2d/renderer/live2dParameterOverlay');

test('TC-AWB-031 desktop RPC parameters have one beforeModelUpdate writer and release smoothly', () => {
  const overlay = createLive2dParameterOverlay({ attack: 0.5, release: 0.5, epsilon: 0.1 });
  const values = { ParamBodyAngleX: 0 };
  const core = {
    getParameterValueById: (name) => values[name],
    setParameterValueById: (name, value) => { values[name] = value; }
  };

  overlay.set('ParamBodyAngleX', 10, 'rpc');
  assert.equal(values.ParamBodyAngleX, 0, 'RPC does not write outside beforeModelUpdate');
  assert.equal(overlay.apply(core), 1);
  assert.equal(values.ParamBodyAngleX, 5);
  overlay.release();
  values.ParamBodyAngleX = 2;
  assert.equal(overlay.apply(core), 1);
  assert.equal(values.ParamBodyAngleX, 4);
  for (let i = 0; i < 5; i += 1) overlay.apply(core);
  assert.equal(overlay.snapshot().length, 0);
});

