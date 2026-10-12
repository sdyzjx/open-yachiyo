const { EventEmitter } = require('node:events');

class NullDeviceHub extends EventEmitter {
  get enabled() {
    return false;
  }

  getAvatarHost() {
    return 'desktop';
  }

  listDevices() {
    return [];
  }

  // -> [{ tool_name, device_id, method, description, params_schema }]
  listToolMethods() {
    return [];
  }

  async invoke(deviceId, method) {
    const err = new Error(`device ${deviceId} is offline (method ${method})`);
    err.code = -32010;
    throw err;
  }

  publish() {}
}

let activeHub = new NullDeviceHub();

function getDeviceHub() {
  return activeHub;
}

function setDeviceHub(hub) {
  activeHub = hub || new NullDeviceHub();
  return activeHub;
}

function attachDeviceHub({ server, app, wss, config, ...options }) {
  const { loadConfig } = require('./config');
  const { DeviceHub } = require('./hub');
  const { attachHttpRoutes } = require('./httpRoutes');
  const settings = config || loadConfig();
  const hub = setDeviceHub(new DeviceHub(settings));
  require('./avatarHost').attachAvatarHost({ hub, statePath: settings.home ? require('node:path').join(settings.home, 'data/device-hub/state.json') : null, ...options.avatar });
  const upgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    const target = pathname === '/ws/device' ? hub.wss : pathname === '/ws' ? wss : null;
    if (!target) { socket.destroy(); return; }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  };
  server.on('upgrade', upgrade);
  attachHttpRoutes({ app, server, hub, ...options });
  if (options.bus) require('./runtimeBridge').attachRuntimeBridge({ hub, ...options });
  server.once('close', () => {
    hub.close();
    server.off('upgrade', upgrade);
    if (getDeviceHub() === hub) setDeviceHub(null);
  });
  return hub;
}

module.exports = { getDeviceHub, setDeviceHub, NullDeviceHub, attachDeviceHub };
