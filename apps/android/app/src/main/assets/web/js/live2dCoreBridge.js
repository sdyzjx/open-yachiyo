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

  function create({
    model, workerUrl, coreUrl, modelUrl, WorkerClass, log = () => {}, now = () => performance.now(),
    visibilityTarget = typeof document !== 'undefined' ? document : null,
    initTimeoutMs = 12000, updateTimeoutMs = 3000
  }) {
    if (!model || typeof model.getModel !== 'function' || typeof WorkerClass !== 'function') return null;
    const raw = model.getModel();
    const originalUpdate = model.update.bind(model);
    let worker;
    try { worker = new WorkerClass(workerUrl); } catch (err) {
      log('warn', `Cubism worker unavailable: ${err.message}`);
      return null;
    }
    const state = {
      ready: false, warmed: false, active: false, pending: false, failed: false, destroyed: false,
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
    let targetRenderOrders = null;
    let parameterPool = null;
    let partPool = null;
    let previousPayload = null;
    let recyclePayload = null;
    let initTimer = null;
    let updateTimer = null;

    const pageVisible = () => !visibilityTarget || visibilityTarget.visibilityState !== 'hidden';
    const clearTimer = (name) => {
      if (name === 'init' && initTimer !== null) { clearTimeout(initTimer); initTimer = null; }
      if (name === 'update' && updateTimer !== null) { clearTimeout(updateTimer); updateTimer = null; }
    };

    function armTimeout(name) {
      clearTimer(name);
      if (!pageVisible() || state.failed || state.destroyed) return;
      const delay = name === 'init' ? initTimeoutMs : updateTimeoutMs;
      const callback = () => {
        if (!pageVisible()) return;
        if (name === 'init' && !state.ready) fail('startup timed out');
        if (name === 'update' && state.pending) fail('frame timed out');
      };
      if (name === 'init') initTimer = setTimeout(callback, delay);
      else updateTimer = setTimeout(callback, delay);
    }

    function onVisibilityChange() {
      if (!pageVisible()) {
        clearTimer('init');
        clearTimer('update');
        return;
      }
      // Background time does not count against the Worker. A visible resume starts fresh deadlines.
      if (!state.ready) armTimeout('init');
      if (state.pending) armTimeout('update');
    }

    function fail(reason) {
      if (state.failed || state.destroyed) return;
      state.failed = true;
      state.ready = false;
      state.active = false;
      state.pending = false;
      clearTimer('init');
      clearTimer('update');
      if (visibilityTarget && typeof visibilityTarget.removeEventListener === 'function') {
        visibilityTarget.removeEventListener('visibilitychange', onVisibilityChange);
      }
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
      const priorReceivedAt = previousReceivedAt;
      const currentVertices = flattenVertices();
      if (!data.vertices || data.vertices.length !== currentVertices.length) throw new Error('vertex payload shape changed');
      if (!data.opacities || data.opacities.length !== drawables.opacities.length) throw new Error('opacity shape changed');
      if (!data.dynamicFlags || data.dynamicFlags.length !== drawables.dynamicFlags.length) throw new Error('dynamic flags shape changed');
      if (!data.renderOrders || data.renderOrders.length !== drawables.renderOrders.length) throw new Error('render order shape changed');
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
      if (!state.warmed) {
        // Discard the stale startup result. The synchronous Core remains authoritative while the
        // second job evaluates the latest parameters, avoiding an immediate backwards mesh jump.
        state.warmed = true;
      } else {
        fromVertices = currentVertices;
        targetVertices = data.vertices;
        fromOpacities = Float32Array.from(drawables.opacities);
        targetOpacities = data.opacities;
        fromDynamicFlags = Uint8Array.from(drawables.dynamicFlags);
        targetDynamicFlags = data.dynamicFlags;
        targetRenderOrders = data.renderOrders;
        interpolationMs = Math.min(100, Math.max(33, receivedAt - priorReceivedAt || 60));
        targetReceivedAt = receivedAt;
        state.interpolationProgress = 0;
        state.active = true;
      }
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
      if (progress >= 1) copyTyped(raw.drawables.renderOrders, targetRenderOrders, 'render order');
    }

    worker.onmessage = (event) => {
      const data = event && event.data || {};
      if (state.destroyed) {
        if (data.type === 'destroyed') { try { worker.terminate(); } catch { /* ignore */ } }
        return;
      }
      if (data.type === 'ready') {
        clearTimer('init');
        state.ready = true;
        log('info', `Cubism worker ready (${data.drawables} drawables, ${data.vertexValues} vertex values)`);
        return;
      }
      if (data.type === 'frame') {
        clearTimer('update');
        state.pending = false;
        try { applyFrame(data); } catch (err) { fail(err.message); }
        return;
      }
      if (data.type === 'destroyed') { try { worker.terminate(); } catch { /* ignore */ } return; }
      if (data.type === 'error') fail(data.message || 'unknown worker error');
    };
    worker.onerror = (event) => { if (!state.destroyed) fail((event && event.message) || 'worker error'); };
    if (visibilityTarget && typeof visibilityTarget.addEventListener === 'function') {
      visibilityTarget.addEventListener('visibilitychange', onVisibilityChange);
    }
    try {
      worker.postMessage({ type: 'init', coreUrl, modelUrl });
      armTimeout('init');
    } catch (err) { fail(err.message); }

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
        try {
          worker.postMessage({ type: 'update', parameters, parts, recycle }, transfer);
          armTimeout('update');
        } catch (err) { fail(err.message); return originalUpdate(); }
      }
      // Keep the synchronous path only until the first complete worker frame exists.
      if (!state.active) return originalUpdate();
      try { interpolate(); } catch (err) { fail(err.message); return originalUpdate(); }
      return undefined;
    }

    function destroy() {
      state.destroyed = true;
      clearTimer('init');
      clearTimer('update');
      if (visibilityTarget && typeof visibilityTarget.removeEventListener === 'function') {
        visibilityTarget.removeEventListener('visibilitychange', onVisibilityChange);
      }
      try { worker.postMessage({ type: 'destroy' }); } catch { /* ignore */ }
      setTimeout(() => { try { worker.terminate(); } catch { /* ignore */ } }, 250);
    }

    return { update, destroy, state, originalUpdate };
  }

  return { create };
});
