const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { matches, validPattern } = require('./topics');
const { tokenMatches } = require('./config');

const LIVE2D_METHODS = new Set(['state.get', 'model.motion.play', 'model.expression.set', 'model.param.batchSet', 'model.param.set', 'live2d.action.enqueue']);
const fault = (code, message) => Object.assign(new Error(message), { code });
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

class DeviceHub extends EventEmitter {
  constructor({ pairing_token, heartbeat_ms = 15000, rpcTimeoutMs = 8000 } = {}) {
    super();
    this.enabled = true;
    this.token = pairing_token;
    this.heartbeatMs = heartbeat_ms;
    this.rpcTimeoutMs = rpcTimeoutMs;
    this.devices = new Map();
    this.pending = new Map();
    this.methods = new Map();
    this.avatarHost = 'desktop';
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.wss.on('connection', (ws, req) => this.connect(ws, req));
    this.timer = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (Date.now() - ws.lastPing >= this.heartbeatMs * 2) ws.terminate();
      }
    }, heartbeat_ms);
    this.timer.unref();
  }

  getAvatarHost() { return this.avatarHost; }
  resolveDevice(id) {
    return id === 'desktop' ? [...this.devices.values()].find((d) => d.device_type === 'desktop') : this.devices.get(id);
  }
  isHost(device) { return device === this.resolveDevice(this.avatarHost); }
  listDevices() {
    return [...this.devices.values()].map(({ ws, subscriptions, methods, ...info }) => info);
  }
  send(ws, type, data, extra = {}) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ v: 1, type, data, ts: Date.now(), ...extra }));
  }
  connect(ws, req) {
    ws.lastPing = Date.now();
    ws.baseUrl = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    if (!tokenMatches(new URL(req.url, 'http://localhost').searchParams.get('token'), this.token)) {
      ws.close(1008, 'Invalid pairing token');
      return;
    }
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      Promise.resolve().then(() => {
        if (binary) throw fault(-32600, 'JSON text frames required');
        return this.receive(ws, JSON.parse(raw.toString()));
      }).catch((err) => this.send(ws, 'error', { code: err.code || -32600, message: err.message }));
    });
    ws.on('close', () => {
      const device = ws.device;
      if (!device || this.devices.get(device.device_id) !== device) return;
      this.devices.delete(device.device_id);
      for (const [id, pending] of this.pending) {
        if (pending.device === device) this.settle(id, fault(-32010, 'Device disconnected'));
      }
      this.emit('tools.changed');
      this.emit('offline', device);
      this.emit('devices.changed');
      this.publish('sys.device.offline', this.deviceInfo(device));
    });
  }
  deviceInfo(d) { return { device_id: d.device_id, device_type: d.device_type, name: d.name }; }
  async receive(ws, msg) {
    if (!object(msg) || msg.v !== 1 || typeof msg.type !== 'string' || !object(msg.data)) throw fault(-32600, 'Invalid envelope');
    const data = msg.data;
    if (!ws.device) {
      if (msg.type !== 'hello' || !/^[\w-]{1,128}$/.test(data.device_id || '') || !['android', 'desktop', 'web'].includes(data.device_type) || (data.mode && !['normal', 'lockscreen'].includes(data.mode))) throw fault(-32600, 'Valid hello required');
      if (this.devices.has(data.device_id)) { ws.close(1008, 'Device already connected'); return; }
      const device = { device_id: data.device_id, device_type: data.device_type, name: String(data.name || data.device_id).slice(0, 128), mode: data.mode || 'normal', alias: String(data.alias || data.name || data.device_id).slice(0, 128), capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter((v) => typeof v === 'string') : [], ws, subscriptions: new Set(), methods: new Map() };
      ws.device = device;
      this.devices.set(device.device_id, device);
      this.send(ws, 'welcome', { device_id: device.device_id, server_version: '0.1.1', heartbeat_ms: this.heartbeatMs, avatar_host: this.avatarHost, devices: this.listDevices(), session_id: `device-${device.device_id}` });
      this.publish('sys.device.online', this.deviceInfo(device));
      this.emit('online', device);
      this.emit('devices.changed');
      return;
    }
    const device = ws.device;
    switch (msg.type) {
      case 'ping': ws.lastPing = Date.now(); this.send(ws, 'pong', data); return;
      case 'pong': ws.lastPing = Date.now(); return;
      case 'sub':
      case 'unsub': {
        if (!Array.isArray(data.topics) || data.topics.length > 128 || !data.topics.every(validPattern)) throw fault(-32602, 'Invalid topics');
        if (device.mode === 'lockscreen' && data.topics.some((p) => p.startsWith('plugin.'))) throw fault(-32006, 'Plugins unavailable while locked');
        for (const topic of data.topics) {
          if (msg.type === 'sub') device.subscriptions.add(topic);
          else device.subscriptions.delete(topic);
        }
        return;
      }
      case 'pub': {
        if (msg.topic === 'plugin.install') throw fault(-32006, 'Topic is server-owned');
        if (!validPattern(msg.topic) || msg.topic.includes('*')) throw fault(-32602, 'Invalid topic');
        if (device.mode === 'lockscreen' && msg.topic.startsWith('plugin.')) throw fault(-32006, 'Plugins unavailable while locked');
        if (msg.topic === 'sys.device.mode') {
          if (!['normal', 'lockscreen'].includes(data.mode)) throw fault(-32602, 'Invalid mode');
          device.mode = data.mode;
          if (device.mode === 'lockscreen') {
            for (const [id, pending] of this.pending) {
              if (pending.device === device && pending.method.startsWith('plugin.')) this.settle(id, fault(-32006, 'Plugins unavailable while locked'));
            }
          }
          this.emit('devices.changed');
          this.emit('tools.changed');
        }
        // Device publications cannot impersonate gateway/runtime control events.
        if (!/^(plugin\.|device\.|avatar\.transfer\.(ready|exited|entered)$|audio\.input\.(start|chunk|end)$|chat\.input$|sys\.device\.mode$|voice\.playback\.(started|ended)$)/.test(msg.topic)) throw fault(-32006, 'Topic is server-owned');
        this.publish(msg.topic, data, { from: device.device_id, target: data.__target });
        this.emit('publication', { topic: msg.topic, data, device });
        return;
      }
      case 'rpc.register': {
        if (!Array.isArray(data.methods) || data.methods.length > 128 || !data.methods.every((m) => object(m) && /^(device\.[\w.-]+|plugin\.[\w.-]+\.[\w-]+)$/.test(m.name) && (!m.params_schema || object(m.params_schema)))) throw fault(-32602, 'Invalid methods');
        if (device.mode === 'lockscreen' && data.methods.some((m) => m.name.startsWith('plugin.'))) throw fault(-32006, 'Plugins unavailable while locked');
        for (const method of data.methods) device.methods.set(method.name, method);
        this.emit('tools.changed'); return;
      }
      case 'rpc.unregister':
        if (!Array.isArray(data.methods) || !data.methods.every((m) => typeof m === 'string')) throw fault(-32602, 'Invalid methods');
        for (const name of data.methods) device.methods.delete(name);
        this.emit('tools.changed'); return;
      case 'rpc.res': {
        const pending = this.pending.get(msg.id);
        if (pending?.device === device) this.settle(msg.id, data.error ? fault(data.error.code, data.error.message) : null, data.result);
        return;
      }
      case 'rpc.req': {
        if (typeof msg.id !== 'string' || !msg.id || typeof data.method !== 'string') throw fault(-32600, 'RPC id/method required');
        try {
          if (device.mode === 'lockscreen' && data.method.startsWith('plugin.')) throw fault(-32006, 'Plugins unavailable while locked');
          const local = this.methods.get(data.method);
          const result = local ? await local(data.params || {}, device) : await this.invoke(data.target || (LIVE2D_METHODS.has(data.method) ? this.avatarHost : ''), data.method, data.params || {});
          this.send(ws, 'rpc.res', { result }, { id: msg.id });
        } catch (err) {
          this.send(ws, 'rpc.res', { error: { code: err.code || -32600, message: err.message } }, { id: msg.id });
        }
        return;
      }
      default: throw fault(-32600, 'Unknown message type');
    }
  }
  publish(topic, data, { from = 'gateway', target, direct = false } = {}) {
    for (const device of this.devices.values()) {
      if (target && device !== this.resolveDevice(target)) continue;
      if ((topic === 'ui.live2d.action' || topic.startsWith('voice.')) && !this.isHost(device)) continue;
      if (device.mode === 'lockscreen' && topic.startsWith('plugin.')) continue;
      if (!direct && ![...device.subscriptions].some((pattern) => matches(pattern, topic))) continue;
      this.send(device.ws, 'event', data, { topic, from });
    }
  }
  listToolMethods() {
    const result = [];
    for (const device of this.devices.values()) {
      const alias = device.alias.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24) || 'device';
      const suffix = createHash('sha256').update(device.device_id).digest('hex').slice(0, 8);
      for (const method of device.methods.values()) {
        if (!method.expose_as_tool || (device.mode === 'lockscreen' && method.name.startsWith('plugin.'))) continue;
        result.push({ tool_name: `${alias}__${method.name.replace(/\./g, '_')}`, device_id: device.device_id, method: method.name, description: method.description || '', params_schema: method.params_schema || { type: 'object' }, _suffix: suffix });
      }
    }
    // Same aliases may be reported by different phones; keep tool names unique.
    const counts = new Map();
    for (const item of result) counts.set(item.tool_name, (counts.get(item.tool_name) || 0) + 1);
    return result.map(({ _suffix, ...item }) => ({ ...item, tool_name: counts.get(item.tool_name) > 1 ? `${item.tool_name}_${_suffix}` : item.tool_name }));
  }
  async invoke(deviceId, method, params = {}, { timeoutMs = this.rpcTimeoutMs } = {}) {
    if (deviceId === 'avatar-host') {
      deviceId = this.getAvatarHost();
      if (deviceId === 'desktop') throw fault(-32010, 'Desktop host uses local RPC');
    }
    const device = this.resolveDevice(deviceId);
    if (!device) throw fault(-32010, 'Target device offline');
    if (device.mode === 'lockscreen' && method.startsWith('plugin.')) throw fault(-32006, 'Plugins unavailable while locked');
    if (!device.methods.has(method) && !LIVE2D_METHODS.has(method)) throw fault(-32601, 'Method not registered');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, fault(-32003, 'RPC timeout')), timeoutMs);
      this.pending.set(id, { device, method, resolve, reject, timer });
      this.send(device.ws, 'rpc.req', { method, params }, { id });
    });
  }
  settle(id, error, result) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (error) pending.reject(error); else pending.resolve(result);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    for (const id of this.pending.keys()) this.settle(id, fault(-32010, 'Hub stopped'));
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.emit('shutdown');
  }
}

module.exports = { DeviceHub, LIVE2D_METHODS, fault };
