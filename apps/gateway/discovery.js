const os = require('node:os');

const SERVICE_TYPE = 'yachiyo';
const SERVICE_PROTOCOL = 'tcp';
const SERVICE_TXT = Object.freeze({ version: '1', path: '/ws/device' });

function isDiscoveryEnabled(env = process.env) {
  return String(env.YACHIYO_DISCOVERY_ENABLED || '').trim().toLowerCase() !== 'false';
}

function serviceName(env = process.env, hostname = os.hostname()) {
  return String(env.YACHIYO_DISCOVERY_NAME || '').trim() || `Yachiyo on ${hostname}`;
}

function loadBonjour() {
  return require('bonjour-service').Bonjour;
}

function settleCallback(call, timeoutMs = 500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    try {
      call(finish);
    } catch {
      finish();
    }
  });
}

function attachGatewayDiscovery({
  server,
  env = process.env,
  Bonjour = loadBonjour,
  hostname = os.hostname(),
  logger = console
} = {}) {
  if (!server || typeof server.once !== 'function') {
    throw new TypeError('server is required');
  }

  let instance = null;
  let service = null;
  let startResult = null;
  let stopPromise = null;
  let stopped = false;
  const enabled = isDiscoveryEnabled(env);

  const warn = (message, error) => {
    const suffix = error?.message ? `: ${error.message}` : '';
    logger.warn?.(`[gateway-discovery] ${message}${suffix}`);
  };

  const start = () => {
    if (startResult !== null || stopped || !enabled) return startResult;
    const address = server.address?.();
    const port = typeof address === 'object' && address ? Number(address.port) : 0;
    if (!server.listening || !Number.isInteger(port) || port < 1 || port > 65535) return null;

    try {
      const BonjourCtor = typeof Bonjour === 'function' && Bonjour.prototype?.publish
        ? Bonjour
        : Bonjour();
      instance = new BonjourCtor({}, (error) => warn('multicast error', error));
      const definition = {
        name: serviceName(env, hostname),
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
        port,
        txt: { ...SERVICE_TXT }
      };
      service = instance.publish(definition);
      service?.on?.('error', (error) => warn('service error', error));
      startResult = { ...definition, txt: { ...definition.txt } };
      logger.info?.(`[gateway-discovery] advertising ${definition.name} on port ${port}`);
      return startResult;
    } catch (error) {
      warn('advertising unavailable', error);
      try { instance?.destroy?.(); } catch {}
      instance = null;
      service = null;
      startResult = false;
      return false;
    }
  };

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    server.off?.('listening', onListening);
    server.off?.('close', onClose);
    stopPromise = (async () => {
      const activeService = service;
      const activeInstance = instance;
      service = null;
      instance = null;
      if (activeService?.stop) {
        await settleCallback((done) => activeService.stop(done));
      }
      if (activeInstance?.unpublishAll) {
        await settleCallback((done) => activeInstance.unpublishAll(done));
      }
      try { activeInstance?.destroy?.(); } catch (error) { warn('cleanup failed', error); }
    })();
    return stopPromise;
  };

  function onListening() {
    start();
  }

  function onClose() {
    void stop();
  }

  if (enabled) {
    server.once('close', onClose);
    if (server.listening) start();
    else server.once('listening', onListening);
  }

  return { enabled, start, stop };
}

module.exports = {
  SERVICE_TYPE,
  SERVICE_PROTOCOL,
  SERVICE_TXT,
  isDiscoveryEnabled,
  serviceName,
  attachGatewayDiscovery
};
