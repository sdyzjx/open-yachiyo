/*
 * Live2D stage: Pixi application + model + camera pose + parameter overlays.
 * Driven by an external frame loop (app.js) - Pixi's own tickers are disabled so that springs, DOM transforms
 * and rendering happen in one deterministic step per frame.
 */
(function (global) {
  'use strict';

  const Layout = global.YachiyoLayout;
  const MAX_MODEL_UPDATE_MS = 50;
  const TRACE_PARAMS = [
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBodyUpper', 'ParamBreath',
    'ParamBodyInput_BodyX', 'ParamBodyInput_BodyY', 'ParamBodyInput_BodyZ',
    'ParamPhysicsRAM_BodyX', 'ParamPhysicsRAM_BodyY', 'ParamPhysicsRAM_BodyZ',
    'ParamOutput_BodyX', 'ParamOutput_BodyY', 'ParamOutput_BodyZ',
    'ParamAngle_BodyX', 'ParamAngle_BodyY', 'ParamAngle_BodyZ',
    'ParamEyeBallX', 'ParamEyeBallY'
  ];

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
      global.__yachiyoStage = this;  // debug handle (CDP): __yachiyoStage.startTrace()/stopTrace()
      this.trace = null;             // debug-only per-frame trace (off by default, see startTrace)
    }

    // Debug-only: per-frame trace of the values actually fed to the model (EXP-20261013-live2d-body-twitch).
    // Off unless ?trace=1 is in the page URL or startTrace() is called (e.g. over CDP). Costs nothing when off.
    startTrace(params) {
      const core = this.model && this.model.internalModel.coreModel;
      if (!core) return false;
      const ids = this.parameterIds(core);
      const requested = Array.isArray(params) && params.length ? params : TRACE_PARAMS;
      const selected = ids.length ? requested.filter((name) => ids.includes(name)) : requested;
      this.trace = {
        version: 2,
        params: selected,
        rows: [],
        events: [],
        t0: performance.now(),
        pending: null,
        motionKey: null
      };
      return true;
    }

    stopTrace() {
      const t = this.trace;
      this.trace = null;
      return t ? { version: t.version, params: t.params, rows: t.rows, events: t.events } : null;
    }

    traceEvent(type, detail) {
      if (this.trace) this.trace.events.push({ t: performance.now() - this.trace.t0, type, ...detail });
    }

    parameterIds(core) {
      try {
        if (typeof core.getParameterIds === 'function') return Array.from(core.getParameterIds());
        if (Array.isArray(core._parameterIds)) return core._parameterIds.slice();
        const ids = core.getModel && core.getModel().parameters && core.getModel().parameters.ids;
        return ids ? Array.from(ids) : [];
      } catch { return []; }
    }

    traceValues() {
      const tr = this.trace;
      const core = this.model && this.model.internalModel.coreModel;
      if (!tr || !core) return null;
      return tr.params.map((name) => {
        try { return Math.round(core.getParameterValueById(name) * 1e4) / 1e4; } catch { return null; }
      });
    }

    tracePhase(name) {
      if (this.trace && this.trace.pending) this.trace.pending[name] = this.traceValues();
    }

    traceFrame() {
      const tr = this.trace;
      const im = this.model && this.model.internalModel;
      if (!tr || !im) return;
      const core = im.coreModel;
      const st = im.motionManager && im.motionManager.state;
      const motion = st ? {
        group: st.currentGroup || null,
        index: st.currentIndex === undefined ? null : st.currentIndex,
        priority: st.currentPriority === undefined ? null : st.currentPriority,
        reservedGroup: st.reservedGroup || st.reservedIdleGroup || null
      } : null;
      const motionKey = motion ? `${motion.group}:${motion.index}:${motion.priority}:${motion.reservedGroup}` : '';
      if (motionKey !== tr.motionKey) {
        tr.motionKey = motionKey;
        this.traceEvent('motionState', { motion });
      }
      const row = {
        t: performance.now() - tr.t0,
        dt: tr.pending ? tr.pending.dt : 0,
        raw: tr.pending ? tr.pending.raw : 0,
        skipped: tr.pending ? tr.pending.skipped : 0,
        clamped: !!(tr.pending && tr.pending.clamped),
        physicsDt: tr.pending ? tr.pending.physicsDt : 0,
        motion,
        grp: st ? `${st.currentGroup || ''}:${st.currentIndex === undefined ? '' : st.currentIndex}:${st.currentPriority}` : '',
        ov: this.overlays.size,
        overlays: Array.from(this.overlays, ([name, o]) => ({ name, target: o.target, weight: o.weight, goal: o.goal, source: o.source })),
        beforeMotion: tr.pending && tr.pending.beforeMotion,
        afterMotion: tr.pending && tr.pending.afterMotion,
        v: this.traceValues()
      };
      tr.rows.push(row);
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
      try { if (/[?&]trace=1\b/.test(global.location && global.location.search)) this.startTrace(); } catch { /* ignore */ }
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
        const raw = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const accumulated = raw + this.skipped;
        // Cached-model frames intentionally freeze motion/physics. Resuming must advance only by the current
        // page-frame dt (already capped at 50 ms), never catch skipped time up in one visible frame.
        const applied = Math.min(MAX_MODEL_UPDATE_MS, raw);
        if (this.trace) this.trace.pending = {
          dt: applied,
          raw,
          skipped: this.skipped,
          clamped: accumulated > applied,
          physicsDt: applied
        };
        orig(applied, now);
        this.skipped = 0;
      };
    }

    bindHook() {
      const im = this.model.internalModel;
      const beforeMotion = () => this.tracePhase('beforeMotion');
      const afterMotion = () => this.tracePhase('afterMotion');
      const handler = () => { this.applyOverrides(); if (this.trace) this.traceFrame(); };
      im.on('beforeMotionUpdate', beforeMotion);
      im.on('afterMotionUpdate', afterMotion);
      im.on('beforeModelUpdate', handler);
      this.hookDetach = () => {
        if (!im.off) return;
        im.off('beforeMotionUpdate', beforeMotion);
        im.off('afterMotionUpdate', afterMotion);
        im.off('beforeModelUpdate', handler);
      };
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

    setParam(name, value, source = 'rpc') {
      this.traceEvent('setParam', { name, value, source });
      const o = this.overlays.get(name);
      if (o) { o.target = value; o.goal = 1; o.source = source; } else this.overlays.set(name, { target: value, weight: 0, goal: 1, source });
    }

    releaseParams(names) {
      this.traceEvent('releaseParams', { names: names || 'all' });
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
      if (this.model && this.visible) {
        this.traceEvent('focus', { x: px, y: py });
        this.model.focus(px, py);
      }
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
