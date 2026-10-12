'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStage() {
  const sandbox = {
    Map, Promise, setTimeout, clearTimeout,
    performance: { now: () => 1000 },
    location: { search: '' },
    PIXI: { live2d: { Live2DModel: {} } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '../../apps/android/app/src/main/assets/web/js/stage.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.YachiyoStage;
}

test('TC-AWB-029 skipped frames never enter Cubism physics as one oversized update', () => {
  const Stage = loadStage();
  const applied = [];
  const internalModel = { update: (dt) => applied.push(dt) };
  const stage = new Stage({ container: {} });
  stage.model = { internalModel };
  stage.wrapUpdate();

  stage.skipUpdate = true;
  internalModel.update(50, 0);
  internalModel.update(50, 0);
  stage.skipUpdate = false;
  internalModel.update(33, 0);

  assert.deepEqual(applied, [33]);
  assert.equal(stage.skipped, 0);
});

test('TC-AWB-030 trace is disabled by default and records model/physics dt, motion and overlay source when enabled', () => {
  const Stage = loadStage();
  const values = { ParamAngleX: 1, ParamOutput_BodyX: 2 };
  const coreModel = {
    _parameterIds: Object.keys(values),
    getParameterValueById: (name) => values[name]
  };
  const state = { currentGroup: 'Idle', currentIndex: 0, currentPriority: 1 };
  const internalModel = { coreModel, motionManager: { state }, update() {} };
  const stage = new Stage({ container: {} });
  stage.model = { internalModel };

  assert.equal(stage.trace, null);
  assert.equal(stage.startTrace(), true);
  stage.trace.pending = { dt: 50, raw: 33, skipped: 67, clamped: true, physicsDt: 50 };
  stage.setParam('ParamAngleX', 3, 'rpc');
  stage.traceFrame();
  const trace = stage.stopTrace();

  assert.deepEqual(Array.from(trace.params), ['ParamAngleX', 'ParamOutput_BodyX']);
  assert.equal(trace.rows[0].physicsDt, 50);
  assert.equal(trace.rows[0].clamped, true);
  assert.equal(trace.rows[0].motion.group, 'Idle');
  assert.equal(trace.rows[0].overlays[0].source, 'rpc');
  assert.deepEqual(Array.from(trace.events, (event) => event.type), ['setParam', 'motionState']);
});

