// Device Hub entry — contracts C1 and C5 in docs/plans/PLAN-android-companion-contracts.md.
// Placeholder until WS3 lands: getDeviceHub() returns a hub with no devices so that
// consumers (agent core, live2d adapter) can code against the final interface.
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

  async requestAvatarTransfer(to) {
    return { transfer_id: null, host: 'desktop', status: 'failed', reason: `device hub disabled (to=${to})` };
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

module.exports = { getDeviceHub, setDeviceHub, NullDeviceHub };
