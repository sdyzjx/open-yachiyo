'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('TC-AWB-028 inactive mouth stays neutral across motion updates while overlays and speech retain priority', () => {
  const sandbox = {
    Map, Promise, setTimeout, clearTimeout,
    performance: { now: () => 0 },
    PIXI: { live2d: { Live2DModel: {} } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '../../apps/android/app/src/main/assets/web/js/stage.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const values = { 91: 0, 90: 1 };
  const indices = { ParamMouthOpenY: 91, ParamMouthForm: 90 };
  const defaults = { 91: 0, 90: 0 };
  const stage = new sandbox.YachiyoStage({ container: { getBoundingClientRect: () => ({ width: 1, height: 1 }) } });
  stage.model = { internalModel: { coreModel: {
    getParameterIndex: (name) => indices[name],
    getParameterDefaultValue: (index) => defaults[index],
    getParameterValueById: (name) => values[indices[name]],
    setParameterValueByIndex: (index, value) => { values[index] = value; },
    setParameterValueById: (name, value) => { values[indices[name]] = value; }
  } } };

  for (let i = 0; i < 3; i += 1) {
    values[91] = 0; values[90] = 1;
    stage.applyOverrides();
    assert.deepEqual(values, { 91: 0, 90: 0 }, `inactive frame ${i + 1} restores model defaults`);
  }

  stage.overlays.set('ParamMouthForm', { target: -0.5, weight: 1, goal: 1 });
  values[90] = 1;
  stage.applyOverrides();
  assert.equal(values[90], -0.5, 'an explicit parameter overlay takes precedence over idle neutral');

  stage.mouth.active = true;
  stage.mouth.open = 0.6;
  stage.mouth.form = -0.4;
  stage.applyOverrides();
  assert.equal(values[91], 0.6);
  assert.equal(values[90], -0.4, 'active speech takes precedence over the parameter overlay');
});
