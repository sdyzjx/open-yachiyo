const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fault } = require('./hub');

function attachAvatarHost({ hub, statePath, prepareTimeoutMs = 8000, stepTimeoutMs = 4000 }) {
  if (statePath && fs.existsSync(statePath)) {
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (typeof saved.avatar_host === 'string') hub.avatarHost = saved.avatar_host;
  }
  const persist = (host) => {
    if (statePath) {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ avatar_host: host }), { mode: 0o600 });
      fs.renameSync(`${statePath}.tmp`, statePath);
    }
    hub.avatarHost = host;
  };
  let active = null;
  const waitAck = (topic, device, transferId, timeoutMs, required) => {
    let cancel;
    const promise = new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); hub.off('publication', receive); hub.off('offline', offline); hub.off('shutdown', shutdown); };
      const finish = (err) => { cleanup(); if (err) reject(err); else resolve(); };
      const receive = (event) => {
        if (event.topic === topic && event.device === device && event.data.transfer_id === transferId) finish();
      };
      const offline = (d) => { if (d === device) finish(required ? fault(-32010, 'Target device offline') : null); };
      const shutdown = () => finish(fault(-32010, 'Hub stopped'));
      const timer = setTimeout(() => finish(required ? fault(-32003, 'Prepare timeout') : null), timeoutMs);
      cancel = () => finish();
      hub.on('publication', receive); hub.on('offline', offline); hub.on('shutdown', shutdown);
    });
    return { promise, cancel };
  };
  hub.transferAvatar = async ({ to } = {}) => {
    if (typeof to !== 'string' || !to) throw fault(-32602, 'Transfer destination required');
    if (active) throw fault(-32600, 'Transfer already in progress');
    const transferId = randomUUID();
    const prev = hub.getAvatarHost();
    if (to === prev) return { transfer_id: transferId, host: prev };
    active = transferId;
    const source = hub.resolveDevice(prev);
    const target = hub.resolveDevice(to);
    let waiter;
    const signal = (topic, data, destination) => {
      const payload = { transfer_id: transferId, ...data };
      hub.publish(topic, payload, { target: destination, direct: true });
      if (topic === 'avatar.host.changed') hub.emit(topic, payload);
    };
    try {
      if (!target) throw fault(-32010, 'Target device offline');
      waiter = waitAck('avatar.transfer.ready', target, transferId, prepareTimeoutMs, true);
      signal('avatar.transfer.prepare', { from: prev, to }, to);
      await waiter.promise;
      if (source) {
        waiter = waitAck('avatar.transfer.exited', source, transferId, stepTimeoutMs, false);
        signal('avatar.transfer.exit', { to }, prev);
        await waiter.promise;
      }
      if (hub.resolveDevice(to) !== target) throw fault(-32010, 'Target device offline');
      persist(to);
      signal('avatar.host.changed', { host: to, prev });
      waiter = waitAck('avatar.transfer.entered', target, transferId, stepTimeoutMs, false);
      signal('avatar.transfer.enter', { from: prev }, to);
      await waiter.promise;
      if (hub.resolveDevice(to) !== target) throw fault(-32010, 'Target device offline');
      signal('avatar.transfer.completed', { host: to });
      return { transfer_id: transferId, host: to };
    } catch (err) {
      if (hub.getAvatarHost() !== prev) {
        persist(prev);
        signal('avatar.host.changed', { host: prev, prev: to });
      }
      err.transfer_id = transferId;
      signal('avatar.transfer.failed', { reason: err.message });
      if (source) signal('avatar.transfer.cancel', {}, prev);
      throw err;
    } finally {
      waiter?.cancel();
      active = null;
    }
  };
  hub.requestAvatarTransfer = async (to, { reason } = {}) => {
    try { return { ...await hub.transferAvatar({ to }), status: 'completed' }; }
    catch (err) { return { transfer_id: err.transfer_id || randomUUID(), host: hub.getAvatarHost(), status: 'failed', reason: err.message }; }
  };
  hub.methods.set('avatar.transfer', hub.transferAvatar);
  hub.methods.set('avatar.status', () => ({ host: hub.getAvatarHost(), devices: hub.listDevices() }));
  return { get active() { return active; } };
}
module.exports = { attachAvatarHost };
