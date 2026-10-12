const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readArchive } = require('./pluginArchive');
const { fault } = require('./hub');

class PluginStore {
  constructor({ directory, hub }) {
    Object.assign(this, { directory, hub });
    this.items = new Map(); this.receipts = new Map();
    fs.mkdirSync(directory, { recursive: true });
    for (const name of fs.readdirSync(directory)) {
      if (/^[a-f0-9]{64}\.yplug$/.test(name)) {
        try { this.put(fs.readFileSync(path.join(directory, name))); } catch { /* Invalid old files are not served. */ }
      }
    }
    const receipt = ({ topic, data, device }) => {
      if (topic === 'plugin.installed' || topic === 'plugin.install_failed') {
        this.receipts.set(`${device.device_id}:${data.plugin_id}`, { topic, ...data, device_id: device.device_id, updated_at: Date.now() });
        if (this.receipts.size > 512) this.receipts.delete(this.receipts.keys().next().value);
      }
    };
    hub.on('publication', receipt); hub.once('shutdown', () => hub.off('publication', receipt));
  }
  put(buffer) {
    const { manifest } = readArchive(buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const file = path.join(this.directory, `${sha256}.yplug`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer, { mode: 0o600 });
    this.items.set(sha256, { sha256, manifest, size: buffer.length, file });
    return { sha256, manifest };
  }
  get(sha256) { return this.items.get(sha256); }
  list() { return [...this.items.values()].map(({ file, ...item }) => item); }
  push(sha256, target) {
    const item = this.get(sha256); if (!item) throw fault(-32602, 'Plugin not found');
    const devices = target ? [this.hub.resolveDevice(target)] : [...this.hub.devices.values()].filter((d) => d.device_type === 'android' && d.mode !== 'lockscreen');
    if (target && !devices[0]) throw fault(-32010, 'Target device offline');
    if (devices.some((d) => d.mode === 'lockscreen')) throw fault(-32006, 'Plugins unavailable while locked');
    for (const device of devices) {
      const url = new URL(`/api/device/plugins/${sha256}/blob`, device.ws.baseUrl); url.searchParams.set('token', this.hub.token);
      this.hub.publish('plugin.install', { plugin_id: item.manifest.id, version: item.manifest.version, url: url.toString(), sha256, size: item.size }, { target: device.device_id, direct: true });
    }
    return { targets: devices.map((d) => d.device_id) };
  }
}
module.exports = { PluginStore };
