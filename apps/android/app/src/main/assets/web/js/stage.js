/*
 * Live2D stage: Pixi application + model + camera pose + parameter overlays.
 * Driven by an external frame loop (app.js) - Pixi's own tickers are disabled so that springs, DOM transforms
 * and rendering happen in one deterministic step per frame.
 */
(function (global) {
  'use strict';

  const Layout = global.YachiyoLayout;

  class Stage {
    constructor({ container, log = () => {}, onContextLost = () => {} }) {
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
      this.mouth = { active: false, open: 0, form: 0, defaults: null };
      this.contextLost = false;
      this.hookDetach = null;
    }

    async init() {
      const PIXI = global.PIXI;
      const canvas = document.createElement('canvas');
      canvas.className = 'stage-canvas';
      this.container.appendChild(canvas);
      this.canvas = canvas;
      const { width, height } = this.size();
      this.resolution = Math.min(global.devicePixelRatio || 1, 2);
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
      const model = await Live2DModel.from(url, { autoInteract: false, autoUpdate: false });
      model.visible = false;
      this.app.stage.addChild(model);
      this.model = model;
      this.mouth.defaults = null;
      this.quality = quality;
      this.modelName = name || '';
      this.content = this.measureContent();
      this.bindHook();
      this.wrapUpdate();
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

    // Cubism Core's mesh update is CPU-heavy on mid-range phones (~21 ms on MI 6). While the UI is animating
    // (drag, camera, transfer) we skip it on most frames and only redraw the cached mesh at the new transform.
    wrapUpdate() {
      const im = this.model.internalModel;
      const orig = im.update.bind(im);
      this.skipped = 0;
      this.skipUpdate = false;
      im.update = (dt, now) => {
        if (this.skipUpdate) { this.skipped += dt; return; }
        orig(dt + this.skipped, now);
        this.skipped = 0;
      };
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
      if (!this.mouth.active) {
        if (!this.mouth.defaults) {
          this.mouth.defaults = ['ParamMouthOpenY', 'ParamMouthForm'].map((name) => {
            const index = core.getParameterIndex(name);
            return { index, value: core.getParameterDefaultValue(index) };
          });
        }
        for (const parameter of this.mouth.defaults) core.setParameterValueByIndex(parameter.index, parameter.value);
      }
      // Explicit action/RPC overlays take precedence over the idle neutral layer.
      for (const [name, o] of this.overlays) {
        o.weight += (o.goal - o.weight) * 0.22;
        if (o.goal === 0 && o.weight < 0.01) { this.overlays.delete(name); continue; }
        const cur = core.getParameterValueById(name);
        core.setParameterValueById(name, cur + (o.target - cur) * o.weight);
      }
      if (this.mouth.active) {
        // Active speech is the final mouth layer and takes precedence over parameter overlays.
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
    render(dtMs, pose, fullUpdate = true) {
      if (!this.app || !this.model || this.contextLost) return;
      this.skipUpdate = !fullUpdate;
      if (pose) this.pose = pose;
      this.model.position.set(this.pose.x, this.pose.y);
      this.model.scale.set(this.pose.scale);
      if (this.visible) this.model.update(dtMs);
      this.app.renderer.render(this.app.stage);
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
      try { if (this.hookDetach) this.hookDetach(); } catch { /* ignore */ }
      try { if (this.app) this.app.destroy(false, { children: true, texture: true, baseTexture: true }); } catch (err) { this.log('warn', `destroy: ${err && err.message}`); }
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this.app = null; this.model = null; this.canvas = null; this.contextLost = false;
      this.overlays.clear();
      this.mouth.defaults = null;
    }
  }

  global.YachiyoStage = Stage;
})(window);
