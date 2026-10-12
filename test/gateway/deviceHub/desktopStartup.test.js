const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

test('Desktop suite starts and stops with Hub client after window setup', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.resolve(__dirname, '../../../apps/desktop-live2d/main/desktopSuite.js');
  const localRequire = createRequire(filename);
  const ipcMain = new EventEmitter(); ipcMain.handle = () => {}; ipcMain.removeHandler = () => {};
  const clients = []; const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.destroyed = false; this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.webContents.isDestroyed = () => false;
      windows.push(this);
      return new Proxy(this, { get(target, key) { if (key in target) return target[key]; return () => {}; } });
    }
    getBounds() { return this.bounds; }
    getContentBounds() { return this.bounds; }
    getSize() { return [this.bounds.width, this.bounds.height]; }
    getPosition() { return [0, 0]; }
    isDestroyed() { return Boolean(this.destroyed); }
    isVisible() { return true; }
    destroy() { this.destroyed = true; }
    async loadFile(file) { if (file.endsWith('index.html')) ipcMain.emit('live2d:renderer:ready', { sender: this.webContents }, {}); }
  }
  class HubClient { constructor() { clients.push(this); } start() { this.started = true; } stop() { this.stopped = true; } transfer(to) { return to; } }
  const config = { assetRoot: path.resolve(__dirname, '../../..'), uiConfig: {}, modelDir: directory, modelJsonName: 'model.json', runtimeSummaryPath: path.join(directory, 'summary.json'), rendererTimeoutMs: 100, gatewayUrl: 'http://127.0.0.1:1' };
  const mocks = {
    './config': { ...localRequire('./config'), resolveDesktopLive2dConfig: () => config },
    './modelAssets': { validateModelAssetDirectory: () => ({ modelJsonPath: 'mock-model.json' }) },
    './gatewaySupervisor': { GatewaySupervisor: class { async start() {} async stop() {} } },
    './rpcServer': { Live2dRpcServer: class { async start() { return { url: 'ws://mock' }; } async stop() {} notify() {} } },
    './ipcBridge': { IpcRpcBridge: class { async invoke() {} dispose() {} } },
    './gatewayRuntimeClient': { GatewayRuntimeClient: class { async ensureSession() {} emitDebug() {} setSessionId() {} startNotificationStream() {} stopNotificationStream() {} getSessionId() { return 'desktop'; } }, createDesktopSessionId: () => 'desktop' },
    './desktopCaptureStore': { createDesktopCaptureStore: () => ({}) },
    './desktopCaptureService': { createDesktopCaptureService: () => ({}) },
    './voice/qwenTtsClient': { QwenTtsClient: class {} },
    './voice/qwenTtsRealtimeClient': { QwenTtsRealtimeClient: class {} },
    './deviceHubClient': { DeviceHubClient: HubClient }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: (id) => mocks[id] || localRequire(id), __dirname: path.dirname(filename), process, console, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval }, { filename });
  const suite = await module.exports.startDesktopSuite({ app: {}, BrowserWindow: Window, ipcMain, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1200, height: 800 }, workArea: { x: 0, y: 0, width: 1200, height: 800 } }) }, logger: {} });
  assert.equal(clients.length, 1); assert.equal(clients[0].started, true);
  assert.equal(suite.transferAvatar('phone'), 'phone');
  assert.equal(windows.length, 3);
  await suite.stop(); assert.equal(clients[0].stopped, true);
  assert.ok(windows.every((window) => window.destroyed));
});
