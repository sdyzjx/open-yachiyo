'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('TC-AWB-030 stage discards a model whose async load outlives its generation', async () => {
  const loading = deferred();
  const sandbox = {
    Map, Promise, setTimeout, clearTimeout,
    performance: { now: () => 0 },
    PIXI: { live2d: { Live2DModel: { from: () => loading.promise } } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '../../apps/android/app/src/main/assets/web/js/stage.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });

  let added = 0;
  let modelDestroyed = 0;
  const app = {
    stage: { addChild() { added += 1; } },
    destroy() {}
  };
  const stage = new sandbox.YachiyoStage({
    container: { getBoundingClientRect: () => ({ width: 1, height: 1 }) }
  });
  stage.app = app;
  const pending = stage.load({ url: '/model.json', quality: 2048, name: 'test' });
  stage.destroy();
  loading.resolve({ destroy() { modelDestroyed += 1; } });

  await assert.rejects(pending, (err) => err && err.code === 'STALE_STAGE_LOAD');
  assert.equal(added, 0, 'stale model is never attached to a replacement app');
  assert.equal(modelDestroyed, 1, 'stale model resources are released');
  assert.equal(stage.model, null);
});
