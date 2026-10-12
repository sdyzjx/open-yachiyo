/* Plugin postMessage protocol + permission checks (contract C3). UMD global YachiyoPluginProtocol. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./topics.js'));
  else root.YachiyoPluginProtocol = factory(root.YachiyoTopics);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Topics) {
  'use strict';

  const ID_RE = /^[a-z0-9._-]{3,64}$/;
  const KINDS = new Set(['req', 'res', 'event']);
  const PLUGIN_OPS = new Set([
    'ready', 'bus.publish', 'bus.subscribe', 'bus.unsubscribe', 'rpc.call', 'rpc.register', 'rpc.unregister',
    'storage.get', 'storage.set', 'avatar.act', 'ui.close', 'ui.setTitle'
  ]);
  const ERR = { INVALID: -32600, PARAMS: -32602, DENIED: -32006 };

  function isEnvelope(msg) {
    return !!msg && typeof msg === 'object' && msg.__yachiyo === 1 && KINDS.has(msg.kind) && typeof msg.op === 'string';
  }

  function validateManifest(m) {
    const errors = [];
    if (!m || typeof m !== 'object') return ['manifest must be an object'];
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push('id must match [a-z0-9._-]{3,64}');
    if (!m.name || typeof m.name !== 'string') errors.push('name is required');
    if (!m.version || typeof m.version !== 'string') errors.push('version is required');
    if (m.type !== 'app' && m.type !== 'widget') errors.push('type must be app or widget');
    const entry = m.entry === undefined ? 'index.html' : m.entry;
    if (typeof entry !== 'string' || !entry || entry.startsWith('/') || entry.split('/').includes('..')) errors.push('entry must be a relative path');
    if (m.sdk !== undefined && m.sdk !== 1) errors.push('unsupported sdk version');
    if (m.permissions !== undefined && !Array.isArray(m.permissions)) errors.push('permissions must be an array');
    if (m.type === 'widget' && m.widget !== undefined) {
      for (const k of ['w', 'h', 'min_w', 'min_h', 'max_w', 'max_h']) {
        if (m.widget[k] !== undefined && !(Number.isInteger(m.widget[k]) && m.widget[k] >= 1)) errors.push(`widget.${k} must be a positive integer`);
      }
    }
    return errors;
  }

  function parsePermissions(manifest) {
    const out = { publish: [], subscribe: [], call: [], register: false, agentTool: false };
    for (const raw of (manifest && manifest.permissions) || []) {
      if (typeof raw !== 'string') continue;
      const idx = raw.indexOf(':');
      const key = idx < 0 ? raw : raw.slice(0, idx);
      const arg = idx < 0 ? '' : raw.slice(idx + 1);
      if (key === 'bus.publish' && arg) out.publish.push(arg);
      else if (key === 'bus.subscribe' && arg) out.subscribe.push(arg);
      else if (key === 'rpc.call' && arg) out.call.push(arg);
      else if (key === 'rpc.register') out.register = true;
      else if (key === 'agent.tool') out.agentTool = true;
    }
    return out;
  }

  const ns = (id) => `plugin.${id}.**`;
  const methodName = (id, name) => `plugin.${id}.${name}`;

  // ".tick" -> "plugin.<id>.tick"
  function expandTopic(id, topic) {
    return typeof topic === 'string' && topic.startsWith('.') ? `plugin.${id}${topic}` : topic;
  }

  function covered(list, ownPattern, requested) {
    if (Topics.patternCovers(ownPattern, requested)) return true;
    return list.some((allowed) => Topics.patternCovers(allowed, requested));
  }

  const deny = (message) => ({ ok: false, code: ERR.DENIED, message });
  const bad = (message) => ({ ok: false, code: ERR.PARAMS, message });

  function canPublish(manifest, topic) { return covered(parsePermissions(manifest).publish, ns(manifest.id), topic); }
  function canSubscribe(manifest, pattern) { return covered(parsePermissions(manifest).subscribe, ns(manifest.id), pattern); }
  function canCall(manifest, method) { return covered(parsePermissions(manifest).call, ns(manifest.id), method); }

  // Returns { ok:true, payload } (payload normalised, topics expanded) or { ok:false, code, message }.
  function checkOp(manifest, op, payload, ctx = {}) {
    if (ctx.lockscreen) return deny('plugins are disabled in lockscreen mode');
    if (!PLUGIN_OPS.has(op)) return { ok: false, code: ERR.INVALID, message: `unknown op: ${op}` };
    const p = payload && typeof payload === 'object' ? payload : {};
    const perms = parsePermissions(manifest);
    switch (op) {
      case 'bus.publish': {
        const topic = expandTopic(manifest.id, p.topic);
        if (typeof topic !== 'string' || !topic) return bad('topic required');
        if (topic.includes('*')) return bad('cannot publish to a wildcard');
        if (!canPublish(manifest, topic)) return deny(`bus.publish not permitted: ${topic}`);
        return { ok: true, payload: { topic, data: p.data } };
      }
      case 'bus.subscribe': {
        const pattern = expandTopic(manifest.id, p.pattern);
        if (typeof pattern !== 'string' || !pattern) return bad('pattern required');
        if (!canSubscribe(manifest, pattern)) return deny(`bus.subscribe not permitted: ${pattern}`);
        return { ok: true, payload: { pattern, sub_id: p.sub_id } };
      }
      case 'rpc.call': {
        if (typeof p.method !== 'string' || !p.method) return bad('method required');
        if (!canCall(manifest, p.method)) return deny(`rpc.call not permitted: ${p.method}`);
        return { ok: true, payload: { method: p.method, params: p.params === undefined ? {} : p.params, target: p.target || '' } };
      }
      case 'rpc.register': {
        if (!perms.register) return deny('rpc.register not permitted');
        if (typeof p.name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(p.name)) return bad('invalid method name');
        if (p.exposeAsTool && !perms.agentTool) return deny('agent.tool permission required for exposeAsTool');
        return {
          ok: true,
          payload: {
            name: p.name,
            full_name: methodName(manifest.id, p.name),
            description: String(p.description || ''),
            params_schema: p.paramsSchema && typeof p.paramsSchema === 'object' ? p.paramsSchema : { type: 'object' },
            expose_as_tool: !!p.exposeAsTool
          }
        };
      }
      case 'rpc.unregister':
        if (typeof p.name !== 'string' || !p.name) return bad('name required');
        return { ok: true, payload: { name: p.name, full_name: methodName(manifest.id, p.name) } };
      case 'storage.get':
        if (typeof p.key !== 'string' || !p.key) return bad('key required');
        return { ok: true, payload: { key: p.key } };
      case 'storage.set':
        if (typeof p.key !== 'string' || !p.key) return bad('key required');
        return { ok: true, payload: { key: p.key, value: p.value === undefined ? null : p.value } };
      case 'avatar.act':
        if (!canCall(manifest, 'live2d.action.enqueue')) return deny('avatar.act requires rpc.call:live2d.** (or live2d.action.enqueue)');
        if (!p.action || typeof p.action !== 'object') return bad('action required');
        return { ok: true, payload: { action: p.action, duration_sec: p.duration_sec, queue_policy: p.queue_policy } };
      case 'ui.setTitle':
        return { ok: true, payload: { title: String(p.title || '').slice(0, 80) } };
      default:
        return { ok: true, payload: p };
    }
  }

  return { ID_RE, PLUGIN_OPS, ERR, isEnvelope, validateManifest, parsePermissions, expandTopic, methodName, canPublish, canSubscribe, canCall, checkOp };
});
