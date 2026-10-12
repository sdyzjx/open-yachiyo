/*
 * Yachiyo Plugin SDK v1 (contract C3.4).
 *
 *   <script src="/sdk/yachiyo-plugin-sdk.js"></script>
 *   const y = await Yachiyo.ready();
 *
 * Plugins run in a sandboxed iframe and talk to the host through postMessage:
 *   { __yachiyo: 1, kind: 'req'|'res'|'event', id, op, payload }
 * Host -> plugin responses carry payload { ok:true, result } or { error:{code,message} }.
 */
(function (global) {
  'use strict';
  if (global.Yachiyo && global.Yachiyo.VERSION) return;

  const REQUEST_TIMEOUT_MS = 12000;
  const pending = new Map();
  const subs = new Map();           // sub_id -> handler
  const methods = new Map();        // short name -> handler
  const resizeHandlers = new Set();
  const themeHandlers = new Set();
  let seq = 0;
  let readyPromise = null;

  function send(msg) { global.parent.postMessage({ __yachiyo: 1, ...msg }, '*'); }

  function request(op, payload) {
    return new Promise((resolve, reject) => {
      const id = `p${Date.now().toString(36)}${++seq}`;
      const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error(`${op} timed out`), { code: -32003 })); }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      send({ kind: 'req', id, op, payload: payload || {} });
    });
  }

  global.addEventListener('message', (e) => {
    if (e.source !== global.parent) return;
    const m = e.data;
    if (!m || m.__yachiyo !== 1) return;
    if (m.kind === 'res') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      const pl = m.payload || {};
      if (pl.error) p.reject(Object.assign(new Error(pl.error.message || 'error'), { code: pl.error.code }));
      else p.resolve(pl.result);
    } else if (m.kind === 'event') {
      const pl = m.payload || {};
      if (m.op === 'bus.event') { const h = subs.get(pl.sub_id); if (h) { try { h(pl.data, { topic: pl.topic, from: pl.from }); } catch (err) { console.error(err); } } }
      else if (m.op === 'widget.resize') resizeHandlers.forEach((h) => { try { h(pl); } catch (err) { console.error(err); } });
      else if (m.op === 'theme.changed') themeHandlers.forEach((h) => { try { h(pl); } catch (err) { console.error(err); } });
    } else if (m.kind === 'req' && m.op === 'rpc.invoke') {
      const pl = m.payload || {};
      const handler = methods.get(pl.name);
      if (!handler) { send({ kind: 'res', id: m.id, op: m.op, payload: { error: { code: -32601, message: `method not registered: ${pl.name}` } } }); return; }
      Promise.resolve().then(() => handler(pl.params || {})).then(
        (result) => send({ kind: 'res', id: m.id, op: m.op, payload: { ok: true, result: result === undefined ? { ok: true } : result } }),
        (err) => send({ kind: 'res', id: m.id, op: m.op, payload: { error: { code: (err && err.code) || -32000, message: (err && err.message) || 'error' } } })
      );
    }
  });

  function build(info) {
    let subSeq = 0;
    const y = {
      pluginId: info.pluginId, type: info.type, theme: info.theme, locale: info.locale,
      bus: {
        // ".tick" is shorthand for plugin.<id>.tick
        publish: (topic, data) => request('bus.publish', { topic, data }),
        subscribe(pattern, handler) {
          const subId = `s${++subSeq}`;
          subs.set(subId, handler);
          const ready = request('bus.subscribe', { pattern, sub_id: subId }).catch((err) => { subs.delete(subId); console.warn(`[yachiyo] subscribe ${pattern}: ${err.message}`); throw err; });
          ready.catch(() => {});
          const off = () => { subs.delete(subId); request('bus.unsubscribe', { sub_id: subId }).catch(() => {}); };
          off.ready = ready;
          return off;
        }
      },
      rpc: {
        call: (method, params, opts) => request('rpc.call', { method, params, target: (opts && opts.target) || '' }),
        register(name, handler, opts = {}) {
          methods.set(name, handler);
          return request('rpc.register', { name, description: opts.description || '', paramsSchema: opts.paramsSchema, exposeAsTool: !!opts.exposeAsTool });
        }
      },
      storage: { get: (key) => request('storage.get', { key }), set: (key, value) => request('storage.set', { key, value }) },
      avatar: { act: (action, opts = {}) => request('avatar.act', { action, duration_sec: opts.durationSec, queue_policy: opts.queuePolicy }) },
      ui: { close: () => request('ui.close'), setTitle: (title) => request('ui.setTitle', { title }), onThemeChange: (h) => { themeHandlers.add(h); return () => themeHandlers.delete(h); } }
    };
    if (info.type === 'widget') {
      y.widget = { size: info.widget, onResize: (h) => { resizeHandlers.add(h); if (info.widget) h(info.widget); return () => resizeHandlers.delete(h); } };
    }
    return y;
  }

  global.Yachiyo = {
    VERSION: 1,
    ready() {
      if (!readyPromise) readyPromise = request('ready').then(build);
      return readyPromise;
    }
  };
})(window);
