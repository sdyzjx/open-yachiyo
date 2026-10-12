'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Bridge = require('../../apps/android/app/src/main/assets/web/js/live2dCoreBridge.js');

class FakeWorker {
  constructor(url) { this.url = url; this.sent = []; this.terminated = false; }
  postMessage(data, transfer = []) { this.sent.push({ data, transfer }); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage({ data }); }
}

class FakeVisibility {
  constructor() { this.visibilityState = 'visible'; this.listeners = new Set(); }
  addEventListener(name, listener) { if (name === 'visibilitychange') this.listeners.add(listener); }
  removeEventListener(name, listener) { if (name === 'visibilitychange') this.listeners.delete(listener); }
  set(state) { this.visibilityState = state; for (const listener of this.listeners) listener(); }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('TC-AWB-027 bridge falls back until a worker frame then applies drawable state asynchronously', () => {
  let instance;
  class Worker extends FakeWorker { constructor(url) { super(url); instance = this; } }
  let synchronousUpdates = 0;
  let resets = 0;
  let time = 0;
  const raw = {
    parameters: { values: new Float32Array([1, 2]) },
    parts: { opacities: new Float32Array([0.5]) },
    drawables: {
      vertexPositions: [new Float32Array([0, 0]), new Float32Array([1, 1, 2, 2])],
      opacities: new Float32Array([1, 1]),
      renderOrders: new Int32Array([0, 1]),
      dynamicFlags: new Uint8Array([1, 1]),
      resetDynamicFlags() { resets += 1; }
    }
  };
  const bridge = Bridge.create({
    model: { getModel: () => raw, update: () => { synchronousUpdates += 1; } },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.model3.json', WorkerClass: Worker,
    now: () => time
  });
  assert.deepEqual(instance.sent[0].data, { type: 'init', coreUrl: '/core.js', modelUrl: '/model.model3.json' });
  instance.emit({ type: 'ready', drawables: 2, vertexValues: 6 });
  bridge.update();
  assert.equal(synchronousUpdates, 1);
  assert.equal(instance.sent[1].data.type, 'update');
  assert.deepEqual(Array.from(instance.sent[1].data.parameters), [1, 2]);

  instance.emit({
    type: 'frame', vertices: new Float32Array([3, 4, 5, 6, 7, 8]),
    opacities: new Float32Array([0.8, 0.9]), renderOrders: new Int32Array([1, 0]),
    dynamicFlags: new Uint8Array([2, 3]), workerMs: 12.5
  });
  assert.deepEqual(Array.from(raw.drawables.vertexPositions[0]), [0, 0], 'warm-up frame does not replace the current mesh');
  assert.equal(bridge.state.warmed, true);
  assert.equal(bridge.state.active, false);
  raw.drawables.vertexPositions[0].set([4, 5]);
  raw.drawables.vertexPositions[1].set([6, 7, 8, 9]);
  raw.drawables.opacities.set([0.9, 1]);
  bridge.update();
  assert.equal(synchronousUpdates, 2, 'synchronous Core remains active through the warm-up result');
  assert.equal(resets, 0);
  assert.equal(bridge.state.lastWorkerMs, 12.5);

  time = 60;
  instance.emit({
    type: 'frame', vertices: new Float32Array([13, 14, 15, 16, 17, 18]),
    opacities: new Float32Array([0.7, 0.8]), renderOrders: new Int32Array([1, 0]),
    dynamicFlags: new Uint8Array([2, 3]), workerMs: 11
  });
  assert.deepEqual(Array.from(raw.drawables.vertexPositions[0]), [4, 5], 'worker handoff does not jump the mesh');
  assert.deepEqual(Array.from(raw.drawables.renderOrders), [0, 1], 'discrete draw order waits for an interpolation boundary');
  assert.equal(bridge.state.active, true);
  time = 90;
  bridge.update();
  assert.deepEqual(Array.from(raw.drawables.vertexPositions[0]), [8.5, 9.5], 'display frame interpolates a new mesh');
  assert.ok(Math.abs(raw.drawables.opacities[0] - 0.8) < 1e-6, 'opacity follows the vertex interpolation');
  assert.equal(raw.drawables.dynamicFlags[0] & 32, 32, 'interpolated vertices keep clipping masks dirty');
  assert.equal(bridge.state.interpolationProgress, 0.5);
  assert.deepEqual(Array.from(raw.drawables.renderOrders), [1, 0], 'draw order switches at the target midpoint');
  assert.equal(instance.sent.at(-1).transfer.length, 6, 'previous drawable payload is returned to the worker pool');
  time = 120;
  bridge.update();
  assert.deepEqual(Array.from(raw.drawables.renderOrders), [1, 0], 'draw order remains stable after its bounded switch');
  bridge.destroy();
  assert.equal(instance.sent.at(-1).data.type, 'destroy');
  const finalVertices = Array.from(raw.drawables.vertexPositions[0]);
  instance.emit({
    type: 'frame', vertices: new Float32Array([99, 99, 99, 99, 99, 99]),
    opacities: new Float32Array([0, 0]), renderOrders: new Int32Array([0, 1]),
    dynamicFlags: new Uint8Array([0, 0]), workerMs: 1
  });
  assert.deepEqual(Array.from(raw.drawables.vertexPositions[0]), finalVertices, 'late frame cannot mutate a destroyed model');
  instance.emit({ type: 'destroyed' });
  assert.equal(instance.terminated, true);
});

test('TC-AWB-028 worker evaluates Cubism and returns transferable drawable arrays', async () => {
  const messages = [];
  const requests = [];
  let clock = 0;
  let reservedMemory = 0;
  let modelReleased = 0;
  let mocReleased = 0;
  const evaluationOrder = [];
  const raw = {
    parameters: { values: new Float32Array([0, 0]) },
    parts: { opacities: new Float32Array([1]) },
    drawables: {
      count: 2,
      vertexPositions: [new Float32Array([0, 1]), new Float32Array([2, 3, 4, 5])],
      opacities: new Float32Array([1, 0.5]), renderOrders: new Int32Array([0, 1]),
      dynamicFlags: new Uint8Array([1, 2]),
      resetDynamicFlags() { evaluationOrder.push('reset'); this.dynamicFlags.fill(0); }
    },
    update() {
      evaluationOrder.push('update');
      this.drawables.vertexPositions[0][0] = this.parameters.values[0] + 10;
      this.drawables.dynamicFlags[0] = 7;
    },
    release() { modelReleased += 1; }
  };
  const context = {
    Float32Array, Int32Array, Uint8Array, Promise, setTimeout, clearTimeout,
    performance: { now: () => { clock += 1; return clock; } },
    URL,
    location: { href: 'https://appassets.androidplatform.net/web/js/live2dCoreWorker.js' },
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('.json')) return { ok: true, json: async () => ({ FileReferences: { Moc: 'model.moc3' } }) };
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    close() {},
    postMessage(data, transfer) { messages.push({ data, transfer }); },
    importScripts() {
      context.Live2DCubismCore = {
        Version: { csmGetVersion: () => 1 },
        Memory: { initializeAmountOfMemory: (bytes) => { reservedMemory = bytes; } },
        Moc: { fromArrayBuffer: () => ({ _release: () => { mocReleased += 1; } }) },
        Model: { fromMoc: () => raw }
      };
    }
  };
  context.self = context;
  vm.createContext(context);
  const file = path.join(__dirname, '../../apps/android/app/src/main/assets/web/js/live2dCoreWorker.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  context.onmessage({ data: { type: 'init', coreUrl: '/core.js', modelUrl: '/generated/model/2048/model.model3.json' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages[0].data.type, 'ready');
  assert.equal(messages[0].data.vertexValues, 6);
  assert.equal(reservedMemory, 64 * 1024 * 1024);
  assert.deepEqual(requests, [
    'https://appassets.androidplatform.net/generated/model/2048/model.model3.json',
    'https://appassets.androidplatform.net/generated/model/2048/model.moc3'
  ]);

  context.onmessage({ data: { type: 'update', parameters: new Float32Array([7, 8]), parts: new Float32Array([0.7]) } });
  const frame = messages[1];
  assert.equal(frame.data.type, 'frame');
  assert.deepEqual(Array.from(frame.data.vertices), [17, 1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(frame.data.opacities), [1, 0.5]);
  assert.deepEqual(Array.from(frame.data.dynamicFlags), [7, 0]);
  assert.deepEqual(evaluationOrder, ['reset', 'update']);
  assert.equal(frame.transfer.length, 6);
  assert.equal(frame.data.parameterBuffer[0], 7);
  const recycledVertices = frame.data.vertices;
  context.onmessage({
    data: {
      type: 'update', parameters: new Float32Array([9, 8]), parts: new Float32Array([0.6]),
      recycle: {
        vertices: frame.data.vertices,
        opacities: frame.data.opacities,
        renderOrders: frame.data.renderOrders,
        dynamicFlags: frame.data.dynamicFlags
      }
    }
  });
  assert.equal(messages[2].data.vertices, recycledVertices);
  context.onmessage({ data: { type: 'destroy' } });
  assert.equal(modelReleased, 1);
  assert.equal(mocReleased, 1);
});

test('TC-AWB-027 bridge falls back when Worker startup or a frame stalls', async () => {
  let instance;
  class Worker extends FakeWorker { constructor(url) { super(url); instance = this; } }
  const raw = {
    parameters: { values: new Float32Array(0) }, parts: { opacities: new Float32Array(0) },
    drawables: {
      vertexPositions: [], opacities: new Float32Array(0), renderOrders: new Int32Array(0),
      dynamicFlags: new Uint8Array(0)
    }
  };
  let syncUpdates = 0;
  assert.equal(Bridge.create({
    model: { getModel: () => raw, update() {} }, workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json',
    WorkerClass: class { constructor() { throw new Error('constructor failed'); } }
  }), null, 'Worker constructor failures preserve the synchronous path');

  class InitThrowWorker extends FakeWorker { postMessage() { throw new Error('init send failed'); } }
  const initSend = Bridge.create({
    model: { getModel: () => raw, update: () => { syncUpdates += 1; } },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json', WorkerClass: InitThrowWorker
  });
  assert.equal(initSend.state.failed, true);
  initSend.update();
  assert.equal(syncUpdates, 1, 'init send failure restores synchronous Core updates');

  const startup = Bridge.create({
    model: { getModel: () => raw, update: () => { syncUpdates += 1; } },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json', WorkerClass: Worker,
    initTimeoutMs: 15
  });
  await wait(30);
  assert.equal(startup.state.failed, true);
  assert.equal(instance.terminated, true);
  startup.update();
  assert.equal(syncUpdates, 2, 'startup timeout restores synchronous Core updates');

  const stalled = Bridge.create({
    model: { getModel: () => raw, update: () => { syncUpdates += 1; } },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json', WorkerClass: Worker,
    initTimeoutMs: 100, updateTimeoutMs: 15
  });
  instance.emit({ type: 'ready', drawables: 0, vertexValues: 0 });
  stalled.update();
  await wait(30);
  assert.equal(stalled.state.failed, true);
  assert.equal(instance.terminated, true);
  const stalledFrames = stalled.state.frames;
  instance.emit({
    type: 'frame', vertices: new Float32Array(0), opacities: new Float32Array(0),
    renderOrders: new Int32Array(0), dynamicFlags: new Uint8Array(0), workerMs: 1
  });
  assert.equal(stalled.state.frames, stalledFrames, 'late frame after fallback is ignored');

  class UpdateThrowWorker extends FakeWorker {
    postMessage(data, transfer) {
      if (data.type === 'update') throw new Error('update send failed');
      super.postMessage(data, transfer);
    }
  }
  const updateSend = Bridge.create({
    model: { getModel: () => raw, update: () => { syncUpdates += 1; } },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json', WorkerClass: UpdateThrowWorker
  });
  updateSend.state.ready = true;
  assert.doesNotThrow(() => updateSend.update());
  assert.equal(updateSend.state.failed, true);
});

test('TC-AWB-027 rapid Worker frames cannot indefinitely postpone render order', () => {
  let instance;
  class Worker extends FakeWorker { constructor(url) { super(url); instance = this; } }
  let time = 0;
  const raw = {
    parameters: { values: new Float32Array(0) }, parts: { opacities: new Float32Array(0) },
    drawables: {
      vertexPositions: [new Float32Array([0, 0])], opacities: new Float32Array([1]),
      renderOrders: new Int32Array([0]), dynamicFlags: new Uint8Array([1])
    }
  };
  const bridge = Bridge.create({
    model: { getModel: () => raw, update() {} },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json', WorkerClass: Worker,
    now: () => time
  });
  instance.emit({ type: 'ready', drawables: 1, vertexValues: 2 });
  bridge.update();
  instance.emit({
    type: 'frame', vertices: new Float32Array([1, 1]), opacities: new Float32Array([1]),
    renderOrders: new Int32Array([0]), dynamicFlags: new Uint8Array([1]), workerMs: 1
  });
  bridge.update();
  time = 60;
  instance.emit({
    type: 'frame', vertices: new Float32Array([2, 2]), opacities: new Float32Array([1]),
    renderOrders: new Int32Array([1]), dynamicFlags: new Uint8Array([1]), workerMs: 1
  });
  time = 70;
  bridge.update();
  assert.equal(raw.drawables.renderOrders[0], 0, 'order waits before the midpoint');
  time = 75;
  instance.emit({
    type: 'frame', vertices: new Float32Array([3, 3]), opacities: new Float32Array([1]),
    renderOrders: new Int32Array([2]), dynamicFlags: new Uint8Array([1]), workerMs: 1
  });
  assert.equal(raw.drawables.renderOrders[0], 1, 'interrupted target order is committed at the next Worker boundary');
  time = 92;
  bridge.update();
  assert.equal(raw.drawables.renderOrders[0], 2, 'latest target order switches at its midpoint');
  bridge.destroy();
});

test('TC-AWB-027 background time resets the pending frame deadline', async () => {
  let instance;
  class Worker extends FakeWorker { constructor(url) { super(url); instance = this; } }
  const visibility = new FakeVisibility();
  const raw = {
    parameters: { values: new Float32Array(0) }, parts: { opacities: new Float32Array(0) },
    drawables: {
      vertexPositions: [], opacities: new Float32Array(0), renderOrders: new Int32Array(0),
      dynamicFlags: new Uint8Array(0)
    }
  };
  const bridge = Bridge.create({
    model: { getModel: () => raw, update() {} },
    workerUrl: '/worker.js', coreUrl: '/core.js', modelUrl: '/model.json', WorkerClass: Worker,
    visibilityTarget: visibility, initTimeoutMs: 100, updateTimeoutMs: 25
  });
  instance.emit({ type: 'ready', drawables: 0, vertexValues: 0 });
  bridge.update();
  visibility.set('hidden');
  await wait(40);
  assert.equal(bridge.state.failed, false, 'hidden time does not expire a Worker job');
  visibility.set('visible');
  await wait(10);
  instance.emit({
    type: 'frame', vertices: new Float32Array(0), opacities: new Float32Array(0),
    renderOrders: new Int32Array(0), dynamicFlags: new Uint8Array(0), workerMs: 1
  });
  assert.equal(bridge.state.failed, false, 'visible resume receives a fresh deadline');
  bridge.destroy();
  assert.equal(visibility.listeners.size, 0);
});
