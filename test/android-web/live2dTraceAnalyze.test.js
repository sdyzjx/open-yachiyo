'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../../scripts/dev/live2d-trace-analyze');

test('TC-AWB-030 trace analysis separates raw, applied and physics dt and reports writes', () => {
  const report = analyze({
    version: 2,
    params: ['ParamBodyAngleX'],
    rows: [
      { t: 0, dt: 16, raw: 16, physicsDt: 16, clamped: false, grp: 'Idle:0:1', v: [0] },
      { t: 20, dt: 50, raw: 20, physicsDt: 50, clamped: true, grp: 'Idle:0:1', v: [1.5] }
    ],
    events: [
      { t: 0, type: 'motionState', motion: { group: 'Idle', index: 0, priority: 1 } },
      { t: 10, type: 'setParam', name: 'ParamBodyAngleX', value: 2, source: 'rpc' }
    ]
  });

  assert.equal(report.dtMs.max, 50);
  assert.equal(report.rawDtMs.max, 20);
  assert.equal(report.physicsDtMs.max, 50);
  assert.equal(report.clampedFrames, 1);
  assert.equal(report.motionTransitions.length, 1);
  assert.equal(report.parameterWrites[0].source, 'rpc');
  assert.equal(report.perParam.ParamBodyAngleX.maxDelta, 1.5);
});

