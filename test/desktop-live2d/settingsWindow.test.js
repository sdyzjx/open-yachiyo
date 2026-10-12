const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { SETTINGS_WINDOW, buildSettingsUrl, createSettingsWindowController } = require('../../apps/desktop-live2d/main/settingsWindow');

test('TC-DSK-007 settings opens config-v2 in a standard 1100x760 window', () => {
  assert.equal(buildSettingsUrl('http://127.0.0.1:3110'), 'http://127.0.0.1:3110/config-v2.html');
  assert.deepEqual(SETTINGS_WINDOW, { width: 1100, height: 760, minWidth: 900, minHeight: 620 });
  let options;
  class Window extends EventEmitter {
    constructor(input) { super(); options = input; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; }
    isDestroyed() { return false; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    show() {}
    focus() {}
  }
  const controller = createSettingsWindowController({ BrowserWindow: Window, getGatewayUrl: () => 'http://127.0.0.1:3110' });
  const win = controller.open();
  assert.equal(win.url, 'http://127.0.0.1:3110/config-v2.html');
  assert.equal(options.width, 1100);
  assert.equal(options.height, 760);
});

test('TC-DSK-008 settings routes gateway load failures to the retry page', async () => {
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.fileLoads = []; }
    isDestroyed() { return false; }
    loadURL() { return Promise.resolve(); }
    loadFile(file, options) { this.fileLoads.push({ file, options }); return Promise.resolve(); }
    show() {}
    focus() {}
  }
  const controller = createSettingsWindowController({ BrowserWindow: Window, getGatewayUrl: () => 'http://127.0.0.1:3110' });
  const win = controller.open();
  win.webContents.emit('did-fail-load', {}, -102, 'CONNECTION_REFUSED', 'http://127.0.0.1:3110/config-v2.html', true);
  await Promise.resolve();
  assert.equal(win.fileLoads.length, 1);
  assert.match(win.fileLoads[0].file, /settingsError\.html$/);
  assert.equal(win.fileLoads[0].options.query.target, 'http://127.0.0.1:3110/config-v2.html');
});
