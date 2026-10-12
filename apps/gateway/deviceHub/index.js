const { EventEmitter } = require('node:events');
const { isAuthorized } = require('./accessControl');

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

  async requestAvatarTransfer() {
    return { transfer_id: require('node:crypto').randomUUID(), host: 'desktop', status: 'failed', reason: 'Device Hub disabled' };
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
  if (options.llmManager) require('./modelControl').attachModelControl({ hub, llmManager: options.llmManager });
  const upgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    const target = pathname === '/ws/device' ? hub.wss : pathname === '/ws' ? wss : null;
    if (!target) { socket.destroy(); return; }
    if (pathname === '/ws' && !isAuthorized(req, settings.pairing_token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  };
  if (settings.home || options.plugins) hub.pluginStore = new (require('./pluginStore').PluginStore)({ hub, directory: settings.home && require('node:path').join(settings.home, 'data/device-plugins'), ...options.plugins });
  server.on('upgrade', upgrade);
  attachHttpRoutes({ app, server, hub, ...options });
  if (options.bus) require('./runtimeBridge').attachRuntimeBridge({ hub, ...options });
  if (options.bus && (settings.home || options.voice)) require('./voiceRelay').attachVoiceRelay({ hub, bus: options.bus, directory: settings.home && require('node:path').join(settings.home, 'data/device-media'), ...options.voice });
  if (options.bus && (settings.home || options.audio)) {
    const { createAsrService } = require('./asrService');
    const omniAudio = options.llmManager
      ? require('./omniAudio').createOmniAudioService({
        hub,
        llmManager: options.llmManager,
        executor: options.executor,
        bus: options.bus,
        sessionStore: options.sessionStore,
        resolvePersonaContext: options.resolvePersonaContext,
        resolveSkillsContext: options.resolveSkillsContext
      })
      : null;
    require('./audioInput').attachAudioInput({
      hub,
      directory: settings.home && require('node:path').join(settings.home, 'data/device-audio'),
      transcribe: createAsrService({ fallback: options.executor ? async (args, device) => {
        const settings = await options.sessionStore?.getSessionSettings(`device-${device.device_id}`);
        const result = await options.executor.execute({ name: 'voice.asr_aliyun', args }, { permission_level: settings?.permission_level || 'low', meta: { session_id: `device-${device.device_id}` }, bus: options.bus });
        if (!result.ok) throw new Error('ASR tool failed');
        return result.result;
      } : undefined }),
      omniAudio,
      ...options.audio
    });
  }
  server.once('close', () => {
    hub.close();
    server.off('upgrade', upgrade);
    if (getDeviceHub() === hub) setDeviceHub(null);
  });
  return hub;
}

module.exports = { getDeviceHub, setDeviceHub, NullDeviceHub, attachDeviceHub };
