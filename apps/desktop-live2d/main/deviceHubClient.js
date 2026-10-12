const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { WebSocket } = require('ws');

// Longer than the Hub's own prepare(8s) + exit(4s) + enter(4s) budget.
const TRANSFER_WATCHDOG_MS = 25000;

class DeviceHubClient {
  constructor({ gatewayUrl, token = process.env.DEVICE_HUB_TOKEN, invokeRenderer, onAction = () => {}, onStateChange = () => {}, fetchImpl = fetch, deviceId = `desktop-${os.hostname().replace(/[^\w-]/g, '-')}`, transferWatchdogMs = TRANSFER_WATCHDOG_MS }) {
    Object.assign(this, { gatewayUrl, token, invokeRenderer, onAction, onStateChange, fetchImpl, deviceId, transferWatchdogMs });
    this.host = null;
    this.devices = [];
    this.pending = new Map();
    this.backoff = 1000;
    this.stopped = true;
    this.exiting = false;
    this.connected = false;
    // Hub-side transfer currently in flight ({ id, to }), whoever started it.
    this.activeTransfer = null;
    // Transfers abandoned locally or cancelled by the Hub: their acks must never be published.
    this.abandoned = new Set();
  }
  get isHost() { return this.connected && !this.exiting && (this.host === 'desktop' || this.host === this.deviceId); }
  get transferTarget() { return this.activeTransfer ? this.activeTransfer.to : ''; }
  emitState() {
    try { this.onStateChange(); } catch { /* UI state listeners cannot affect the Hub connection. */ }
  }
  beginTransfer(id, to) {
    clearTimeout(this.transferTimer);
    this.activeTransfer = { id: id || null, to: to || 'pending' };
    // Safety net: a lost terminal event must not leave the UI stuck in "pending" forever.
    this.transferTimer = setTimeout(() => this.endTransfer(), this.transferWatchdogMs);
    this.transferTimer.unref?.();
    this.emitState();
  }
  endTransfer(id) {
    if (id && this.activeTransfer?.id && this.activeTransfer.id !== id) return;
    clearTimeout(this.transferTimer);
    if (!this.activeTransfer) return;
    this.activeTransfer = null;
    this.emitState();
  }
  abandon(id) {
    if (!id) return;
    this.abandoned.add(id);
    if (this.abandoned.size > 32) this.abandoned.delete(this.abandoned.values().next().value);
  }
  send(type, data, extra = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ v: 1, type, data, ts: Date.now(), ...extra }));
  }
  async start() {
    this.stopped = false;
    try {
      if (!this.token) {
        const response = await this.fetchImpl(new URL('/api/device/pairing', this.gatewayUrl), { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Pairing unavailable');
        this.token = (await response.json()).token;
      }
      if (this.stopped) return;
      const url = new URL('/ws/device', this.gatewayUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('token', this.token);
      const ws = this.ws = new WebSocket(url, { handshakeTimeout: 5000 });
      ws.on('open', () => this.send('hello', { device_id: this.deviceId, device_type: 'desktop', name: os.hostname(), mode: 'normal', capabilities: ['live2d', 'audio.play'], app_version: '0.1.1' }));
      ws.on('message', (raw) => {
        this.lastMessage = Date.now();
        try { void this.receive(JSON.parse(raw)).catch(() => {}); } catch { /* Malformed frames are ignored. */ }
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        this.connected = false;
        this.exiting = false;
        clearInterval(this.heartbeat);
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Hub disconnected')); }
        this.pending.clear();
        this.activeTransfer = null; clearTimeout(this.transferTimer);
        this.emitState();
        void this.invokeRenderer('avatar.hub.event', { topic: 'avatar.connection.lost', data: {} }).catch(() => {});
        this.retry();
      });
    } catch { this.retry(); }
  }
  retry() {
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => { void this.start(); }, this.backoff);
    this.backoff = Math.min(30000, this.backoff * 2);
  }
  async receive(msg) {
    if (msg.type === 'welcome') {
      this.connected = true; this.backoff = 1000; this.exiting = false;
      this.host = msg.data.avatar_host; this.devices = msg.data.devices;
      this.send('sub', { topics: ['avatar.**', 'sys.device.*', 'ui.live2d.action'] });
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage >= msg.data.heartbeat_ms * 2) this.ws.terminate();
        else this.send('ping', {});
      }, msg.data.heartbeat_ms);
      this.emitState();
      await this.invokeRenderer('avatar.hub.event', { topic: 'avatar.welcome', data: { host: this.host, device_id: this.deviceId } });
    } else if (msg.type === 'rpc.req') {
      try { this.send('rpc.res', { result: await this.invokeRenderer(msg.data.method, msg.data.params) }, { id: msg.id }); }
      catch (err) { this.send('rpc.res', { error: { code: err.code || -32600, message: err.message } }, { id: msg.id }); }
    } else if (msg.type === 'rpc.res') {
      const item = this.pending.get(msg.id);
      if (!item) return;
      clearTimeout(item.timer); this.pending.delete(msg.id);
      if (msg.id === this.localTransferId) { this.localTransferId = null; this.endTransfer(); }
      if (msg.data.error) item.reject(Object.assign(new Error(msg.data.error.message), msg.data.error)); else item.resolve(msg.data.result);
    } else if (msg.type === 'event') {
      const { topic, data = {} } = msg;
      const transferId = data.transfer_id;
      if (topic === 'sys.device.online') this.devices = [...this.devices.filter((d) => d.device_id !== data.device_id), data];
      if (topic === 'sys.device.offline') this.devices = this.devices.filter((d) => d.device_id !== data.device_id);
      if (topic === 'avatar.host.changed') { this.host = data.host; this.exiting = false; }
      if (topic === 'avatar.transfer.prepare' || topic === 'avatar.transfer.exit') this.beginTransfer(transferId, data.to);
      if (topic === 'avatar.transfer.exit') this.exiting = true;
      if (topic === 'avatar.transfer.cancel' || topic === 'avatar.transfer.failed') { this.abandon(transferId); this.exiting = false; this.endTransfer(transferId); }
      if (topic === 'avatar.transfer.completed') { this.exiting = false; this.endTransfer(transferId); }
      if (topic.startsWith('avatar.')) {
        const ack = { 'avatar.transfer.prepare': 'ready', 'avatar.transfer.exit': 'exited', 'avatar.transfer.enter': 'entered' }[topic];
        try {
          await this.invokeRenderer('avatar.hub.event', { topic, data });
        } catch (err) {
          // The animation could not run: never claim progress for this transfer, and do not stay "pending".
          if (ack) { this.abandon(transferId); this.exiting = false; this.endTransfer(transferId); }
          this.emitState();
          throw err;
        }
        // A cancel that arrived while the animation was running must not be answered with a stale ack.
        if (ack && !this.abandoned.has(transferId)) this.send('pub', { transfer_id: transferId }, { topic: `avatar.transfer.${ack}` });
      }
      if (topic === 'ui.live2d.action' && this.isHost) await this.onAction(data);
      if (topic.startsWith('avatar.') || topic.startsWith('sys.device.')) this.emitState();
    }
  }
  transfer(to) {
    if (!this.connected) return Promise.reject(new Error('Device Hub is disconnected'));
    if (this.activeTransfer || this.localTransferId) return Promise.reject(new Error('Avatar transfer is already in progress'));
    if (to === 'desktop' && (this.host === 'desktop' || this.host === this.deviceId)) return Promise.reject(new Error('Avatar is already on this device'));
    const id = randomUUID();
    this.localTransferId = id;
    this.beginTransfer(null, to);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (this.localTransferId === id) { this.localTransferId = null; this.endTransfer(); }
        reject(new Error('Transfer timed out'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.send('rpc.req', { method: 'avatar.transfer', params: { to } }, { id });
    });
  }
  stop() {
    this.stopped = true; this.connected = false;
    clearTimeout(this.transferTimer); this.activeTransfer = null; this.localTransferId = null;
    clearTimeout(this.retryTimer); clearInterval(this.heartbeat);
    this.ws?.close();
  }
}
module.exports = { DeviceHubClient };
