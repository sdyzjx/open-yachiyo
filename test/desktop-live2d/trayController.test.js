const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TRAY_ICON_RELATIVE_PATH,
  resolveTrayIconPath,
  createTrayImage,
  createTrayController
} = require('../../apps/desktop-live2d/main/trayController');
const { computeShellState } = require('../../apps/desktop-live2d/main/shellModel');

const ROOT = path.resolve(__dirname, '..', '..');
const hub = { connected: true, host: 'desktop', pending_target: '', devices: [{ device_id: 'mi6', device_type: 'android', name: 'mi6' }] };

function fakeElectron({ imageEmpty = false } = {}) {
  const log = { trays: [], menus: [], images: [], buffers: [] };
  class FakeTray {
    constructor(icon) { this.icon = icon; this.handlers = new Map(); log.trays.push(this); }
    setToolTip(text) { this.tooltip = text; }
    setContextMenu(menu) { this.menu = menu; }
    popUpContextMenu(menu) { this.popped = menu; }
    on(name, handler) { this.handlers.set(name, handler); }
    destroy() { this.destroyed = true; }
  }
  const makeImage = (empty) => ({ empty, template: false, isEmpty() { return empty; }, setTemplateImage(v) { this.template = v; }, resize() { return { resized: true, isEmpty: () => false }; } });
  const nativeImage = {
    createFromPath(p) { const image = makeImage(imageEmpty); image.path = p; log.images.push(image); return image; },
    createFromBuffer(buffer, options) { const image = makeImage(false); image.buffer = buffer; image.options = options; log.buffers.push(image); return image; },
    createEmpty() { return makeImage(true); }
  };
  const Menu = { buildFromTemplate(template) { const menu = { template }; log.menus.push(menu); return menu; } };
  return { FakeTray, nativeImage, Menu, log };
}

test('TC-DSK-002 template icon assets exist as black-on-transparent 16px and @2x PNGs', () => {
  const base = path.join(ROOT, TRAY_ICON_RELATIVE_PATH);
  assert.match(path.basename(base), /Template\.png$/);
  for (const [file, size] of [[base, 16], [base.replace('.png', '@2x.png'), 32]]) {
    const png = fs.readFileSync(file);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.equal(resolveTrayIconPath({ projectRoot: ROOT, platform: 'darwin' }), base);
});

test('TC-DSK-002 macOS tray image is a template and is never resized', () => {
  const { nativeImage, log } = fakeElectron();
  const image = createTrayImage({ nativeImage, iconPath: '/x/yachiyoTemplate.png', platform: 'darwin' });
  assert.equal(image.template, true);
  assert.equal(image.resized, undefined);
  assert.equal(log.buffers.length, 0);
});

test('TC-DSK-002 an empty icon file falls back to the embedded template icon', () => {
  const { nativeImage, log } = fakeElectron({ imageEmpty: true });
  const image = createTrayImage({ nativeImage, iconPath: '/missing.png', platform: 'darwin' });
  assert.equal(log.buffers.length, 1);
  assert.equal(log.buffers[0].options.scaleFactor, 2);
  assert.equal(image.template, true);
  assert.equal(log.buffers[0].buffer.subarray(1, 4).toString(), 'PNG');
});

test('TC-DSK-002 non-macOS platforms resize a regular icon and never mark it as template', () => {
  const { nativeImage } = fakeElectron();
  const image = createTrayImage({ nativeImage, iconPath: '/x/icon.ico', platform: 'win32', size: 20 });
  assert.equal(image.resized, true);
});

test('TC-DSK-001 tray controller builds the shell menu and rebuilds it on refresh', () => {
  const { FakeTray, nativeImage, Menu, log } = fakeElectron();
  let current = computeShellState({ hub, avatarVisible: true });
  const opened = [];
  const controller = createTrayController({
    Tray: FakeTray, Menu, nativeImage, projectRoot: ROOT, platform: 'darwin',
    getShellState: () => current, actions: { openChat: () => opened.push('chat') }
  });
  assert.equal(log.trays.length, 1);
  assert.equal(log.trays[0].icon.template, true);
  assert.equal(log.trays[0].tooltip, 'Yachiyo 八千代');
  assert.equal(controller.menu.template[0].label, '八千代在电脑上');
  controller.menu.template.find((item) => item.label === '和八千代聊天').click();
  assert.deepEqual(opened, ['chat']);

  current = computeShellState({ hub: { ...hub, host: 'mi6' }, avatarVisible: true });
  controller.refresh();
  assert.equal(log.trays[0].menu.template[0].label, '八千代在 mi6 上');
  assert.ok(controller.menu.template.some((item) => item.label === '叫八千代回电脑'));
  assert.equal(log.trays[0].handlers.has('click'), false, 'macOS opens the menu natively for left and right click');

  controller.destroy();
  assert.equal(log.trays[0].destroyed, true);
});

test('TC-DSK-001 on Windows a left click pops up the same menu', () => {
  const { FakeTray, nativeImage, Menu, log } = fakeElectron();
  createTrayController({ Tray: FakeTray, Menu, nativeImage, projectRoot: ROOT, platform: 'win32', getShellState: () => computeShellState({ hub }) });
  log.trays[0].handlers.get('click')();
  assert.ok(log.trays[0].popped);
});

test('TC-DSK-002 tray refuses to start without any usable icon instead of being invisible', () => {
  const { FakeTray, Menu } = fakeElectron();
  const nativeImage = { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) };
  assert.throws(() => createTrayController({ Tray: FakeTray, Menu, nativeImage, projectRoot: ROOT, platform: 'darwin', getShellState: () => computeShellState({ hub }) }), /icon is unavailable/);
});
