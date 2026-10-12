/* Off-main-thread Cubism Core bridge. UMD: browser global YachiyoLive2DCoreBridge, Node require. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YachiyoLive2DCoreBridge = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function copyTyped(target, source, label) {
    if (!source || target.length !== source.length) throw new Error(`${label} shape changed`);
    target.set(source);
  }

  function create({ model, workerUrl, coreUrl, modelUrl, WorkerClass, log = () => {}, now = () => performance.now() }) {
    if (!model || typeof model.getModel !== 'function' || typeof WorkerClass !== 'function') return null;
    const raw = model.getModel();
    const originalUpdate = model.update.bind(model);
    const worker = new WorkerClass(workerUrl);
    const state = {
      ready: false, active: false, pending: false, failed: false, destroyed: false,
      jobs: 0, frames: 0, lastWorkerMs: 0, workerSamples: [], interpolationProgress: 1
    };
    let fromVertices = null;
    let targetVertices = null;
    let targetReceivedAt = 0;
    let previousReceivedAt = 0;
    let interpolationMs = 60;
    let fromOpacities = null;
    let targetOpacities = null;
    let fromDynamicFlags = null;
    let targetDynamicFlags = null;
    let parameterPool = null;
    let partPool = null;
    let previousPayload = null;
    let recyclePayload = null;

    function fail(reason) {
      if (state.failed || state.destroyed) return;
      state.failed = true;
      state.ready = false;
      state.active = false;
      state.pending = false;
      log('warn', `Cubism worker fallback: ${reason}`);
      try { worker.terminate(); } catch { /* ignore */ }
    }

    function flattenVertices() {
      const values = new Float32Array(raw.drawables.vertexPositions.reduce((sum, item) => sum + item.length, 0));
      let offset = 0;
      for (const vertices of raw.drawables.vertexPositions) { values.set(vertices, offset); offset += vertices.length; }
      return values;
    }

    function copyVertices(flat, blend = 1) {
      const drawables = raw.drawables;
      let offset = 0;
      for (const vertices of drawables.vertexPositions) {
        const end = offset + vertices.length;
        if (end > flat.length) throw new Error('vertex payload truncated');
        if (blend >= 1 || !fromVertices) vertices.set(flat.subarray(offset, end));
        else for (let i = 0; i < vertices.length; i += 1) vertices[i] = fromVertices[offset + i] + (flat[offset + i] - fromVertices[offset + i]) * blend;
        offset = end;
      }
      if (offset !== flat.length) throw new Error('vertex payload has trailing values');
    }

    function applyFrame(data) {
      const drawables = raw.drawables;
      const receivedAt = now();
      if (!state.active) {
        copyVertices(data.vertices);
        fromVertices = Float32Array.from(data.vertices);
        targetVertices = Float32Array.from(data.vertices);
        copyTyped(drawables.opacities, data.opacities, 'opacity');
        copyTyped(drawables.dynamicFlags, data.dynamicFlags, 'dynamic flags');
        state.interpolationProgress = 1;
      } else {
        fromVertices = flattenVertices();
        if (data.vertices.length !== fromVertices.length) throw new Error('vertex payload shape changed');
        if (data.opacities.length !== drawables.opacities.length) throw new Error('opacity shape changed');
        if (data.dynamicFlags.length !== drawables.dynamicFlags.length) throw new Error('dynamic flags shape changed');
        targetVertices = data.vertices;
        fromOpacities = Float32Array.from(drawables.opacities);
        targetOpacities = data.opacities;
        fromDynamicFlags = Uint8Array.from(drawables.dynamicFlags);
        targetDynamicFlags = data.dynamicFlags;
        if (previousReceivedAt) interpolationMs = Math.min(100, Math.max(33, receivedAt - previousReceivedAt));
        targetReceivedAt = receivedAt;
        state.interpolationProgress = 0;
      }
      previousReceivedAt = receivedAt;
      parameterPool = data.parameterBuffer || null;
      partPool = data.partsBuffer || null;
      recyclePayload = previousPayload;
      previousPayload = {
        vertices: data.vertices,
        opacities: data.opacities,
        renderOrders: data.renderOrders,
        dynamicFlags: data.dynamicFlags
      };
      copyTyped(drawables.renderOrders, data.renderOrders, 'render order');
      state.active = true;
      state.frames += 1;
      state.lastWorkerMs = Number(data.workerMs) || 0;
      state.workerSamples.push(state.lastWorkerMs);
      if (state.workerSamples.length > 600) state.workerSamples.shift();
    }

    function interpolate() {
      if (!state.active || !targetVertices || state.interpolationProgress >= 1) return;
      const progress = Math.min(1, (now() - targetReceivedAt) / interpolationMs);
      copyVertices(targetVertices, progress);
      for (let i = 0; i < raw.drawables.opacities.length; i += 1) {
        raw.drawables.opacities[i] = fromOpacities[i] + (targetOpacities[i] - fromOpacities[i]) * progress;
        // Bit 5 tells Cubism's clipping pass that interpolated mask vertices need a refresh.
        let flags = targetDynamicFlags[i] | 32;
        if (progress < 1 && ((fromDynamicFlags[i] | targetDynamicFlags[i]) & 1)) flags |= 1;
        raw.drawables.dynamicFlags[i] = flags;
      }
      state.interpolationProgress = progress;
    }

    worker.onmessage = (event) => {
      const data = event && event.data || {};
      if (data.type === 'ready') {
        state.ready = true;
        log('info', `Cubism worker ready (${data.drawables} drawables, ${data.vertexValues} vertex values)`);
        return;
      }
      if (data.type === 'frame') {
        state.pending = false;
        try { applyFrame(data); } catch (err) { fail(err.message); }
        return;
      }
      if (data.type === 'destroyed') { try { worker.terminate(); } catch { /* ignore */ } return; }
      if (data.type === 'error') fail(data.message || 'unknown worker error');
    };
    worker.onerror = (event) => fail((event && event.message) || 'worker error');
    worker.postMessage({ type: 'init', coreUrl, modelUrl });

    function update() {
      if (state.destroyed || state.failed || !state.ready) return originalUpdate();
      if (!state.pending) {
        const parameters = parameterPool && parameterPool.length === raw.parameters.values.length
          ? parameterPool : new Float32Array(raw.parameters.values.length);
        const parts = partPool && partPool.length === raw.parts.opacities.length
          ? partPool : new Float32Array(raw.parts.opacities.length);
        parameters.set(raw.parameters.values);
        parts.set(raw.parts.opacities);
        parameterPool = null;
        partPool = null;
        const recycle = recyclePayload;
        recyclePayload = null;
        state.pending = true;
        state.jobs += 1;
        const transfer = [parameters.buffer, parts.buffer];
        if (recycle) transfer.push(recycle.vertices.buffer, recycle.opacities.buffer, recycle.renderOrders.buffer, recycle.dynamicFlags.buffer);
        worker.postMessage({ type: 'update', parameters, parts, recycle }, transfer);
      }
      // Keep the synchronous path only until the first complete worker frame exists.
      if (!state.active) return originalUpdate();
      try { interpolate(); } catch (err) { fail(err.message); return originalUpdate(); }
      return undefined;
    }

    function destroy() {
      state.destroyed = true;
      try { worker.postMessage({ type: 'destroy' }); } catch { /* ignore */ }
      setTimeout(() => { try { worker.terminate(); } catch { /* ignore */ } }, 250);
    }

    return { update, destroy, state, originalUpdate };
  }

  return { create };
});
