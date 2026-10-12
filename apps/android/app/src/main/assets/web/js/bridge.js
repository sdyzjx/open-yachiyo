/* Promise/event wrapper over window.YachiyoNative (contract C2). Must load before any other app script. */
(function (global) {
  'use strict';

  const listeners = new Map();
  const queue = [];
  let ready = false;

  function emit(type, data) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(data); } catch (err) { log('error', `listener ${type}: ${err && err.message}`); }
    }
  }

  function dispatch(msg) {
    let m = msg;
    if (typeof msg === 'string') { try { m = JSON.parse(msg); } catch { return; } }
    if (!m || typeof m.type !== 'string') return;
    if (!ready) { queue.push(m); return; }
    emit(m.type, m.data);
  }

  // C2.2: must exist as early as possible so native can deliver (and queue) messages.
  global.__yachiyoNative = { dispatch };

  function native() { return global.YachiyoNative || null; }

  function log(level, msg) {
    try { const n = native(); if (n && n.log) n.log(level, String(msg)); } catch { /* ignore */ }
    const fn = console[level] || console.log;
    fn.call(console, `[yachiyo] ${msg}`);
  }

  function call(name, ...args) {
    const n = native();
    if (!n || typeof n[name] !== 'function') return '';
    try { return n[name](...args); } catch (err) { log('warn', `native.${name} failed: ${err && err.message}`); return ''; }
  }

  function json(name, fallback, ...args) {
    const raw = call(name, ...args);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  }

  /* ---- hub helpers ---- */
  const Topics = global.YachiyoTopics;
  const subs = new Map();      // id -> { pattern, handler }
  const patternRefs = new Map(); // pattern -> count
  let subSeq = 0;
  let callSeq = 0;
  const pendingCalls = new Map();
  const rpcHandlers = [];      // { method, handler }
  const registered = new Map(); // name -> method spec (re-registered after reconnect)

  function subscribe(patterns, handler) {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    const ids = [];
    const fresh = [];
    for (const pattern of list) {
      const id = ++subSeq;
      subs.set(id, { pattern, handler });
      ids.push(id);
      const n = (patternRefs.get(pattern) || 0) + 1;
      patternRefs.set(pattern, n);
      if (n === 1) fresh.push(pattern);
    }
    if (fresh.length) call('hubSubscribe', JSON.stringify(fresh));
    return () => {
      const gone = [];
      for (const id of ids) {
        const s = subs.get(id);
        if (!s) continue;
        subs.delete(id);
        const n = (patternRefs.get(s.pattern) || 1) - 1;
        if (n <= 0) { patternRefs.delete(s.pattern); gone.push(s.pattern); } else patternRefs.set(s.pattern, n);
      }
      if (gone.length) call('hubUnsubscribe', JSON.stringify(gone));
    };
  }

  on('hub.event', (ev) => {
    if (!ev || !ev.topic) return;
    for (const s of Array.from(subs.values())) {
      if (Topics.matchTopic(s.pattern, ev.topic)) {
        try { s.handler(ev.data, ev); } catch (err) { log('error', `sub ${s.pattern}: ${err && err.message}`); }
      }
    }
  });

  function publish(topic, data) { call('hubPublish', topic, JSON.stringify(data === undefined ? {} : data)); }

  function rpc(method, params, target, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const callId = `w${Date.now().toString(36)}${++callSeq}`;
      const timer = setTimeout(() => {
        pendingCalls.delete(callId);
        reject(Object.assign(new Error(`rpc timeout: ${method}`), { code: -32003 }));
      }, timeoutMs);
      pendingCalls.set(callId, { resolve, reject, timer });
      call('hubRpc', callId, method, JSON.stringify(params === undefined ? {} : params), target || '');
    });
  }

  on('hub.rpc.result', (res) => {
    const p = res && pendingCalls.get(res.call_id);
    if (!p) return;
    pendingCalls.delete(res.call_id);
    clearTimeout(p.timer);
    if (res.error) p.reject(Object.assign(new Error(res.error.message || 'rpc error'), { code: res.error.code, data: res.error.data }));
    else p.resolve(res.result);
  });

  // handler(params, req) -> result | Promise. `method` may be an exact name or a topic-style pattern.
  function handleRpc(method, handler) {
    const entry = { method, handler };
    rpcHandlers.push(entry);
    return () => { const i = rpcHandlers.indexOf(entry); if (i >= 0) rpcHandlers.splice(i, 1); };
  }

  on('hub.rpc.request', async (req) => {
    if (!req || !req.id) return;
    const entry = rpcHandlers.find((h) => h.method === req.method) || rpcHandlers.find((h) => h.method.includes('*') && Topics.matchTopic(h.method, req.method));
    if (!entry) {
      call('hubRpcRespond', req.id, '', JSON.stringify({ code: -32601, message: `method not found: ${req.method}` }));
      return;
    }
    try {
      const result = await entry.handler(req.params || {}, req);
      call('hubRpcRespond', req.id, JSON.stringify(result === undefined ? { ok: true } : result), '');
    } catch (err) {
      call('hubRpcRespond', req.id, '', JSON.stringify({ code: err && err.code ? err.code : -32000, message: (err && err.message) || 'error' }));
    }
  });

  function register(methods) {
    for (const m of methods) registered.set(m.name, m);
    call('hubRegister', JSON.stringify(methods));
  }
  function unregister(names) {
    for (const n of names) registered.delete(n);
    call('hubUnregister', JSON.stringify(names));
  }
  // Native may or may not replay registrations after reconnect; replaying is idempotent.
  on('hub.state', (st) => {
    if (st && st.state === 'connected' && registered.size) call('hubRegister', JSON.stringify(Array.from(registered.values())));
  });

  function start() {
    ready = true;
    while (queue.length) { const m = queue.shift(); emit(m.type, m.data); }
  }

  global.YachiyoBridge = {
    on, call, json, log, subscribe, publish, rpc, handleRpc, register, unregister, start,
    get hasNative() { return !!native(); },
    getConfig: () => json('getConfig', {}),
    setConfig: (patch) => call('setConfig', JSON.stringify(patch)),
    deviceInfo: () => json('getDeviceInfo', {}),
    hubState: () => json('hubState', { state: 'disconnected', avatar_host: '', devices: [] }),
    emitLocal: emit
  };
})(window);
