/*
 * Live2D actions and device RPC (task 3): wires the desktop shared modules (Live2DActionMessage / Mutex /
 * QueuePlayer / Executor) to the mobile stage, and answers hub.rpc.request for the avatar methods.
 */
(function (global) {
  'use strict';

  function rpcError(code, message) {
    return Object.assign(new Error(message), { code });
  }

  function createActions({ stage, bridge, presets, getHostInfo, log = () => {} }) {
    const Msg = global.Live2DActionMessage;
    const Mutex = global.Live2DActionMutex;
    const Queue = global.Live2DActionQueuePlayer;
    const Exec = global.Live2DActionExecutor;
    if (!Msg || !Mutex || !Queue || !Exec) throw new Error('desktop live2d action modules are missing (run npm run android:sync-assets)');

    const mutex = Mutex.createLive2dActionMutex();

    function requireModel() {
      if (!stage.model) throw rpcError(-32004, 'model not loaded');
      return stage.model;
    }

    function setExpressionRaw({ name }) {
      const model = requireModel();
      const n = String(name || '').trim();
      if (!n) throw rpcError(-32602, 'model.expression.set requires non-empty name');
      stage.traceEvent('expression', { name: n });
      model.expression(n);
      return { ok: true, name: n };
    }

    function resetExpressionRaw() {
      const mgr = stage.model && stage.model.internalModel.motionManager.expressionManager;
      stage.traceEvent('resetExpression', {});
      if (mgr && mgr.resetExpression) mgr.resetExpression();
    }

    function playMotionRaw(params) {
      const model = requireModel();
      const group = String((params && params.group) || '').trim();
      if (!group) throw rpcError(-32602, 'model.motion.play requires non-empty group');
      const hasIndex = params && Object.prototype.hasOwnProperty.call(params, 'index') && params.index !== undefined;
      if (hasIndex && !Number.isInteger(Number(params.index))) throw rpcError(-32602, 'model.motion.play index must be integer');
      stage.traceEvent('motion', { group, index: hasIndex ? Number(params.index) : null });
      if (hasIndex) model.motion(group, Number(params.index)); else model.motion(group);
      return { ok: true, group, index: hasIndex ? Number(params.index) : null };
    }

    function setParam(params, source = 'rpc') {
      requireModel();
      const name = String((params && params.name) || '').trim();
      const value = Number(params && params.value);
      if (!name || !Number.isFinite(value)) throw rpcError(-32602, 'param.set requires { name, value:number }');
      stage.setParam(name, value, source);
      return { ok: true };
    }

    function setParamBatch(params, source = 'rpc') {
      const updates = Array.isArray(params && params.updates) ? params.updates : [];
      if (!updates.length) throw rpcError(-32602, 'model.param.batchSet requires non-empty updates array');
      updates.forEach((update) => setParam(update, source));
      return { ok: true, applied: updates.length };
    }

    const executeAction = Exec.createLive2dActionExecutor({
      setExpression: setExpressionRaw,
      playMotion: playMotionRaw,
      setParamBatch: (params) => setParamBatch(params, 'action'),
      presetConfig: presets || {},
      createError: rpcError
    });

    const idleAction = { type: 'motion', name: 'Idle', args: { group: 'Idle', index: 0 } };
    const player = new Queue.Live2dActionQueuePlayer({
      executeAction: async (action) => { await executeAction(action); },
      afterIdleAction: async () => { resetExpressionRaw(); stage.releaseParams(); },
      maxQueueSize: 120,
      idleAction,
      mutex,
      logger: { info() {}, warn: (...a) => log('warn', a.join(' ')), error: (...a) => log('error', a.join(' ')) }
    });

    function enqueue(payload) {
      const normalized = Msg.normalizeLive2dActionMessage(payload);
      if (!normalized.ok) throw rpcError(-32602, normalized.error);
      return player.enqueue(normalized.value);
    }

    // Convenience for the UI (greet, tap reactions): same path as agent actions.
    function act(action, durationSec = 2) {
      try { return enqueue({ action, duration_sec: durationSec, queue_policy: 'replace' }); } catch (err) { log('warn', `act failed: ${err.message}`); return null; }
    }

    function state() {
      const info = getHostInfo ? getHostInfo() : {};
      return {
        modelLoaded: !!stage.model, modelName: stage.modelName, quality: stage.quality, visible: stage.visible,
        queue: player.snapshot(), contextLost: stage.contextLost, ...info
      };
    }

    const offs = [];
    offs.push(bridge.handleRpc('state.get', () => state()));
    offs.push(bridge.handleRpc('model.motion.play', (p) => mutex.runExclusive(() => playMotionRaw(p))));
    offs.push(bridge.handleRpc('model.expression.set', (p) => mutex.runExclusive(() => setExpressionRaw(p))));
    offs.push(bridge.handleRpc('model.param.set', (p) => setParam(p, 'rpc')));
    offs.push(bridge.handleRpc('model.param.batchSet', (p) => setParamBatch(p, 'rpc')));
    offs.push(bridge.handleRpc(Msg.ACTION_ENQUEUE_METHOD, (p) => enqueue(p)));
    offs.push(bridge.subscribe(Msg.ACTION_EVENT_NAME, (payload) => {
      try { enqueue(payload); } catch (err) { log('warn', `ui.live2d.action rejected: ${err.message}`); }
    }));

    return { enqueue, act, state, player, setExpressionRaw, playMotionRaw, setParam, resetExpressionRaw, dispose() { offs.forEach((f) => f()); player.stop(); } };
  }

  global.YachiyoActions = { createActions };
})(window);
