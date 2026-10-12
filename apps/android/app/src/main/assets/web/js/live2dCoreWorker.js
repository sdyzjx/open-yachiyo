/* Cubism Core evaluator for Android WebView. Runs only in a dedicated Worker. */
'use strict';

let coreModel = null;
let coreMoc = null;
let vertexValueCount = 0;
let updateQueued = false;

function postError(err) {
  self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
}

function waitForCore(timeoutMs = 10000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const core = self.Live2DCubismCore;
        // `_isStarted` belongs to CubismFramework and is never set in this Core-only worker.
        // The Core version call succeeds once its asynchronous runtime is ready.
        if (core && core.Version && core.Version.csmGetVersion() > 0) { resolve(); return; }
      } catch { /* Core runtime is still starting; poll again. */ }
      if (performance.now() - started >= timeoutMs) { reject(new Error('Cubism Core startup timed out')); return; }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function fetchMoc(modelUrl) {
  const absoluteModelUrl = new URL(modelUrl, self.location.href);
  const settingsResponse = await fetch(absoluteModelUrl);
  if (!settingsResponse.ok) throw new Error(`model settings fetch failed: HTTP ${settingsResponse.status}`);
  const settings = await settingsResponse.json();
  const mocFile = settings && settings.FileReferences && settings.FileReferences.Moc;
  if (!mocFile) throw new Error('model settings missing FileReferences.Moc');
  const mocResponse = await fetch(new URL(mocFile, absoluteModelUrl));
  if (!mocResponse.ok) throw new Error(`model moc fetch failed: HTTP ${mocResponse.status}`);
  return mocResponse.arrayBuffer();
}

async function init({ coreUrl, modelUrl }) {
  importScripts(coreUrl);
  await waitForCore();
  // The 7 MiB production moc and its working model exceed Core's 16 MiB default heap.
  // Reserve once before reviving the moc; the worker owns this heap exclusively.
  self.Live2DCubismCore.Memory.initializeAmountOfMemory(64 * 1024 * 1024);
  coreMoc = self.Live2DCubismCore.Moc.fromArrayBuffer(await fetchMoc(modelUrl));
  if (!coreMoc) throw new Error('Cubism Core rejected model moc');
  coreModel = self.Live2DCubismCore.Model.fromMoc(coreMoc);
  if (!coreModel) throw new Error('Cubism Core model initialization failed');
  vertexValueCount = coreModel.drawables.vertexPositions.reduce((sum, values) => sum + values.length, 0);
  self.postMessage({ type: 'ready', drawables: coreModel.drawables.count, vertexValues: vertexValueCount });
}

function update({ parameters, parts, recycle }) {
  if (!coreModel || updateQueued) return;
  updateQueued = true;
  try {
    const started = performance.now();
    coreModel.parameters.values.set(parameters);
    coreModel.parts.opacities.set(parts);
    // Clear the previous change bits before evaluation, then preserve this evaluation's flags for the renderer.
    coreModel.drawables.resetDynamicFlags();
    coreModel.update();

    const vertices = recycle && recycle.vertices && recycle.vertices.length === vertexValueCount
      ? recycle.vertices : new Float32Array(vertexValueCount);
    let offset = 0;
    for (const values of coreModel.drawables.vertexPositions) {
      vertices.set(values, offset);
      offset += values.length;
    }
    const drawableCount = coreModel.drawables.count;
    const opacities = recycle && recycle.opacities && recycle.opacities.length === drawableCount
      ? recycle.opacities : new Float32Array(drawableCount);
    const renderOrders = recycle && recycle.renderOrders && recycle.renderOrders.length === drawableCount
      ? recycle.renderOrders : new Int32Array(drawableCount);
    const dynamicFlags = recycle && recycle.dynamicFlags && recycle.dynamicFlags.length === drawableCount
      ? recycle.dynamicFlags : new Uint8Array(drawableCount);
    opacities.set(coreModel.drawables.opacities);
    renderOrders.set(coreModel.drawables.renderOrders);
    dynamicFlags.set(coreModel.drawables.dynamicFlags);
    self.postMessage({
      type: 'frame', vertices, opacities, renderOrders, dynamicFlags,
      parameterBuffer: parameters, partsBuffer: parts,
      workerMs: performance.now() - started
    }, [vertices.buffer, opacities.buffer, renderOrders.buffer, dynamicFlags.buffer, parameters.buffer, parts.buffer]);
  } finally {
    updateQueued = false;
  }
}

self.onmessage = (event) => {
  const data = event && event.data || {};
  if (data.type === 'init') { init(data).catch(postError); return; }
  if (data.type === 'update') { try { update(data); } catch (err) { postError(err); } return; }
  if (data.type === 'destroy') {
    if (coreModel && typeof coreModel.release === 'function') coreModel.release();
    if (coreMoc && typeof coreMoc._release === 'function') coreMoc._release();
    coreModel = null;
    coreMoc = null;
    self.postMessage({ type: 'destroyed' });
    close();
  }
};
