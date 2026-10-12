/*
 * Live2D stage: Pixi application + model + camera pose + parameter overlays.
 * Driven by an external frame loop (app.js) - Pixi's own tickers are disabled so that springs, DOM transforms
 * and rendering happen in one deterministic step per frame.
 */
(function (global) {
  'use strict';

  class Stage {
    constructor({ container, log = () => {}, onContextLost = () => {}, performanceProfile = {} }) {
      this.container = container;
      this.log = log;
      this.onContextLost = onContextLost;
      this.app = null;
      this.model = null;
      this.canvas = null;
      this.content = null;           // model-local content box
      this.modelName = '';
      this.quality = 0;
      this.visible = true;
      this.pose = { x: 0, y: 0, scale: 1 };
      this.overlays = new Map();     // param -> { target, weight, goal }
      this.mouth = { active: false, open: 0, form: 0 };
      this.contextLost = false;
      this.hookDetach = null;
      this.performanceProfile = performanceProfile;
      this.coreBridge = null;
      this.rendererOptimization = null;
      this.metrics = { rafFrames: 0, drawFrames: 0, frameIntervals: [], drawSamples: [], lastFrameAt: 0, workerFrameBase: 0 };
      this.generation = 0;
    }

    async init() {
      const PIXI = global.PIXI;
      const canvas = document.createElement('canvas');
      canvas.className = 'stage-canvas';
      this.container.appendChild(canvas);
      this.canvas = canvas;
      const { width, height } = this.size();
      this.resolution = this.performanceProfile.resolution || Math.min(global.devicePixelRatio || 1, 1.5);
      this.app = new PIXI.Application({
        view: canvas, width, height, backgroundAlpha: 0, antialias: true, autoDensity: true,
        resolution: this.resolution, autoStart: false, powerPreference: 'high-performance', preserveDrawingBuffer: false
      });
      this.app.ticker.stop();
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.contextLost = true;
        this.log('warn', 'webglcontextlost');
        this.onContextLost();
      });
    }

    size() {
      const r = this.container.getBoundingClientRect();
      return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    }

    resize() {
      if (!this.app) return;
      const { width, height } = this.size();
      this.app.renderer.resize(width, height);
    }

    async load({ url, quality, name }) {
      const Live2DModel = global.PIXI.live2d.Live2DModel;
      const t0 = performance.now();
      const generation = this.generation;
      const app = this.app;
      const model = await Live2DModel.from(url, { autoInteract: false, autoUpdate: false });
      if (!app || this.app !== app || this.generation !== generation) {
        try { model.destroy({ children: true, texture: true, baseTexture: true }); } catch { /* ignore */ }
        const error = new Error('model load superseded');
        error.code = 'STALE_STAGE_LOAD';
        throw error;
      }
      model.visible = false;
      app.stage.addChild(model);
      this.model = model;
      this.quality = quality;
      this.modelName = name || '';
      this.content = this.measureContent();
      this.bindHook();
      this.optimizeRenderer();
      this.startCoreWorker(url);
      this.log('info', `model loaded in ${Math.round(performance.now() - t0)} ms @${quality}, content ${JSON.stringify(this.content)}`);
      return { loadMs: performance.now() - t0, content: this.content };
    }

    // Union of visible drawable bounds in model-local px: the real drawn extent, not the canvas padding.
    measureContent() {
      const m = this.model;
      const im = m.internalModel;
      const core = im.coreModel;
      const count = core.getDrawableCount ? core.getDrawableCount() : 0;
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (let i = 0; i < count; i += 1) {
        const op = core.getDrawableOpacity ? core.getDrawableOpacity(i) : 1;
        if (op <= 0.01) continue;
        const b = im.getDrawableBounds(i);
        if (!b || !isFinite(b.x)) continue;
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      }
      if (!isFinite(x0) || x1 - x0 < 10) return { x0: 0, y0: 0, x1: m.internalModel.originalWidth || m.width, y1: m.internalModel.originalHeight || m.height };
      return { x0, y0, x1, y1 };
    }

    // Upload textures with the model parked off-screen so the first visible frame does not stall (EXP-20261012).
    preloadGpu() {
      if (!this.model) return;
      this.model.visible = true;
      this.model.position.set(-10000, 0);
      this.model.scale.set(0.01);
      this.app.renderer.render(this.app.stage);
      this.model.update(16);
      this.app.renderer.render(this.app.stage);
      this.model.visible = this.visible;
    }

    startCoreWorker(modelUrl) {
      const factory = global.YachiyoLive2DCoreBridge;
      if (!factory || typeof global.Worker !== 'function') return;
      const coreModel = this.model.internalModel.coreModel;
      const bridge = factory.create({
        model: coreModel,
        WorkerClass: global.Worker,
        workerUrl: '/web/js/live2dCoreWorker.js',
        coreUrl: '/generated/lib/live2dcubismcore.min.js',
        modelUrl,
        log: this.log
      });
      if (!bridge) return;
      this.coreBridge = bridge;
      coreModel.update = bridge.update;
    }

    optimizeRenderer() {
      const optimizer = global.YachiyoLive2DRendererOptimizer;
      if (!optimizer) return;
      this.rendererOptimization = optimizer.install(this.model.internalModel.renderer, this.model.internalModel.coreModel);
    }

    bindHook() {
      const im = this.model.internalModel;
      const handler = () => this.applyOverrides();
      im.on('beforeModelUpdate', handler);
      this.hookDetach = () => { if (im.off) im.off('beforeModelUpdate', handler); };
    }

    // Parameters pinned by RPC / actions (blended over the running motion) and the lipsync mouth.
    applyOverrides() {
      const core = this.model && this.model.internalModel.coreModel;
      if (!core) return;
      for (const [name, o] of this.overlays) {
        o.weight += (o.goal - o.weight) * 0.22;
        if (o.goal === 0 && o.weight < 0.01) { this.overlays.delete(name); continue; }
        const cur = core.getParameterValueById(name);
        core.setParameterValueById(name, cur + (o.target - cur) * o.weight);
      }
      if (this.mouth.active) {
        core.setParameterValueById('ParamMouthOpenY', this.mouth.open);
        core.setParameterValueById('ParamMouthForm', this.mouth.form);
      }
    }

    setParam(name, value) {
      const o = this.overlays.get(name);
      if (o) { o.target = value; o.goal = 1; } else this.overlays.set(name, { target: value, weight: 0, goal: 1 });
    }

    releaseParams(names) {
      for (const [name, o] of this.overlays) { if (!names || names.includes(name)) o.goal = 0; }
    }

    hasParam(name) {
      const ids = this.model && this.model.internalModel.coreModel.getParameterIds && this.model.internalModel.coreModel.getParameterIds();
      return Array.isArray(ids) && ids.includes(name);
    }

    setVisible(v) {
      this.visible = v;
      if (this.model) this.model.visible = v;
      if (this.canvas) this.canvas.style.visibility = v ? 'visible' : 'hidden';
    }

    // pose: { x, y, scale } in CSS px; one frame step.
    render(dtMs, pose) {
      if (!this.app || !this.model || this.contextLost) return;
      if (pose) this.pose = pose;
      const frameAt = performance.now();
      this.metrics.rafFrames += 1;
      if (this.metrics.lastFrameAt) this.recordMetric(this.metrics.frameIntervals, frameAt - this.metrics.lastFrameAt);
      this.metrics.lastFrameAt = frameAt;
      if (this.visible) this.model.update(dtMs);

      this.model.position.set(this.pose.x, this.pose.y);
      this.model.scale.set(this.pose.scale);
      const drawAt = performance.now();
      this.app.renderer.render(this.app.stage);
      this.recordMetric(this.metrics.drawSamples, performance.now() - drawAt);
      this.metrics.drawFrames += 1;
    }

    recordMetric(samples, value) {
      samples.push(value);
      if (samples.length > 600) samples.shift();
    }

    beginPerformanceSample() {
      this.metrics.rafFrames = 0;
      this.metrics.drawFrames = 0;
      this.metrics.frameIntervals.length = 0;
      this.metrics.drawSamples.length = 0;
      this.metrics.lastFrameAt = 0;
      this.metrics.workerFrameBase = this.coreBridge ? this.coreBridge.state.frames : 0;
      if (this.coreBridge) this.coreBridge.state.workerSamples.length = 0;
      if (this.rendererOptimization) this.rendererOptimization.resetStats();
    }

    performanceSnapshot() {
      const worker = this.coreBridge && this.coreBridge.state;
      return {
        rafFrames: this.metrics.rafFrames,
        drawFrames: this.metrics.drawFrames,
        frameIntervals: this.metrics.frameIntervals.slice(),
        drawSamples: this.metrics.drawSamples.slice(),
        workerFrames: worker ? worker.frames - this.metrics.workerFrameBase : 0,
        workerSamples: worker ? worker.workerSamples.slice() : [],
        workerReady: !!(worker && worker.ready),
        workerActive: !!(worker && worker.active),
        workerFailed: !!(worker && worker.failed),
        gl: this.rendererOptimization ? { ...this.rendererOptimization.stats } : null
      };
    }

    // Model bounds in viewport CSS px (for hit testing / transfer sizing).
    screenBox() {
      if (!this.content) return null;
      const { x, y, scale } = this.pose;
      return { x0: x + this.content.x0 * scale, y0: y + this.content.y0 * scale, x1: x + this.content.x1 * scale, y1: y + this.content.y1 * scale };
    }

    // 'head' | 'body' | null for a viewport point.
    hitTest(px, py) {
      const b = this.screenBox();
      if (!b || !this.visible) return null;
      if (px < b.x0 || px > b.x1 || py < b.y0 || py > b.y1) return null;
      const rel = (py - b.y0) / (b.y1 - b.y0);
      return rel < 0.27 ? 'head' : 'body';
    }

    lookAt(px, py) {
      if (this.model && this.visible) this.model.focus(px, py);
    }

    loseContext() {
      const gl = this.app && this.app.renderer.gl;
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }

    destroy() {
      this.generation += 1;
      try { if (this.hookDetach) this.hookDetach(); } catch { /* ignore */ }
      try { if (this.coreBridge) this.coreBridge.destroy(); } catch { /* ignore */ }
      try { if (this.rendererOptimization) this.rendererOptimization.detach(); } catch { /* ignore */ }
      try { if (this.app) this.app.destroy(false, { children: true, texture: true, baseTexture: true }); } catch (err) { this.log('warn', `destroy: ${err && err.message}`); }
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this.app = null; this.model = null; this.canvas = null; this.contextLost = false;
      this.coreBridge = null; this.rendererOptimization = null;
      this.overlays.clear();
    }
  }

  global.YachiyoStage = Stage;
})(window);
