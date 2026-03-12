const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeLive2dPresetConfig,
  loadLive2dPresetConfig,
  waitForRendererReady,
  writeRuntimeSummary,
  computeWindowBounds,
  computeRightBottomWindowBounds,
  resolveDisplayForBounds,
  clampWindowBoundsToWorkArea,
  resolveWindowMetrics,
  resolveWindowSizeForChatPanel,
  resizeWindowKeepingBottomRight,
  normalizeChatInputPayload,
  normalizeChatMessageImages,
  normalizeChatImagePreviewPayload,
  normalizeWindowDragPayload,
  normalizeWindowControlPayload,
  normalizeChatPanelVisibilityPayload,
  normalizeWindowResizePayload,
  normalizeModelBoundsPayload,
  normalizeBubbleMetricsPayload,
  normalizeActionTelemetryPayload,
  createWindowDragListener,
  createWindowControlListener,
  createChatPanelVisibilityListener,
  buildWindowStatePayload,
  createWindowResizeListener,
  normalizeWindowInteractivityPayload,
  createWindowInteractivityListener,
  normalizePersistedWindowState,
  loadPersistedWindowState,
  writePersistedWindowState,
  createModelBoundsListener,
  createBubbleMetricsListener,
  createActionTelemetryListener,
  createChatInputListener,
  forwardLive2dActionEvent,
  handleDesktopRpcRequest,
  isNewSessionCommand,
  computeChatWindowBounds,
  computeBubbleWindowBounds,
  computeFittedAvatarWindowBounds
} = require('../../apps/desktop-live2d/main/desktopSuite');

class FakeIpcMain extends EventEmitter {}

test('waitForRendererReady resolves when renderer sends ready event', async () => {
  const ipcMain = new FakeIpcMain();
  const promise = waitForRendererReady({ ipcMain, timeoutMs: 200 });

  setTimeout(() => {
    ipcMain.emit('live2d:renderer:ready', null, { ok: true });
  }, 20);

  await promise;
});

test('waitForRendererReady rejects on timeout', async () => {
  const ipcMain = new FakeIpcMain();

  await assert.rejects(
    () => waitForRendererReady({ ipcMain, timeoutMs: 60 }),
    /timeout/i
  );
});

test('writeRuntimeSummary persists JSON payload', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-summary-'));
  const summaryPath = path.join(tmpDir, 'desktop', 'runtime-summary.json');

  writeRuntimeSummary(summaryPath, { ok: true, rpcUrl: 'ws://127.0.0.1:17373' });
  const content = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

  assert.equal(content.ok, true);
  assert.equal(content.rpcUrl, 'ws://127.0.0.1:17373');
});

test('normalizeLive2dPresetConfig keeps emote/gesture/react object shape', () => {
  const normalized = normalizeLive2dPresetConfig({
    version: 2,
    emote: { happy: { medium: { expression: 'smile' } } },
    gesture: ['invalid'],
    react: { waiting: [{ type: 'wait', ms: 120 }] }
  });

  assert.equal(normalized.version, 2);
  assert.equal(typeof normalized.emote, 'object');
  assert.deepEqual(normalized.gesture, {});
  assert.equal(typeof normalized.react, 'object');
});

test('loadLive2dPresetConfig parses yaml file and returns normalized config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-presets-'));
  const projectRoot = path.join(tmpDir, 'project');
  fs.mkdirSync(path.join(projectRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'config', 'live2d-presets.yaml'),
    [
      'version: 1',
      'gesture:',
      '  greet:',
      '    expression: smile'
    ].join('\n'),
    'utf8'
  );

  const loaded = loadLive2dPresetConfig({
    projectRoot,
    env: {},
    logger: { warn: () => {} }
  });

  assert.equal(loaded.version, 1);
  assert.equal(loaded.gesture.greet.expression, 'smile');
});

test('computeRightBottomWindowBounds places window at display corner', () => {
  const bounds = computeRightBottomWindowBounds({
    width: 460,
    height: 620,
    display: {
      workArea: {
        x: 0,
        y: 25,
        width: 1728,
        height: 1080
      }
    },
    marginRight: 18,
    marginBottom: 18
  });

  assert.equal(bounds.x, 1250);
  assert.equal(bounds.y, 467);
});

test('computeWindowBounds supports top-left and center anchors', () => {
  const display = {
    workArea: {
      x: 10,
      y: 20,
      width: 1200,
      height: 800
    }
  };

  const topLeft = computeWindowBounds({
    width: 400,
    height: 600,
    display,
    anchor: 'top-left',
    marginLeft: 25,
    marginTop: 30
  });

  const center = computeWindowBounds({
    width: 400,
    height: 600,
    display,
    anchor: 'center'
  });

  assert.deepEqual(topLeft, { x: 35, y: 50 });
  assert.deepEqual(center, { x: 410, y: 120 });
});

test('computeChatWindowBounds anchors near avatar and clamps into work area', () => {
  const bounds = computeChatWindowBounds({
    avatarBounds: { x: 20, y: 640, width: 300, height: 420 },
    chatWidth: 320,
    chatHeight: 220,
    display: {
      workArea: {
        x: 0,
        y: 0,
        width: 1440,
        height: 900
      }
    }
  });

  assert.equal(bounds.width, 320);
  assert.equal(bounds.height, 220);
  assert.ok(bounds.x >= 16);
  assert.ok(bounds.y >= 16);
});

test('computeBubbleWindowBounds anchors above avatar center', () => {
  const bounds = computeBubbleWindowBounds({
    avatarBounds: { x: 1000, y: 420, width: 300, height: 500 },
    bubbleWidth: 320,
    bubbleHeight: 120,
    display: {
      workArea: {
        x: 0,
        y: 0,
        width: 1728,
        height: 1117
      }
    }
  });

  assert.equal(bounds.width, 320);
  assert.equal(bounds.height, 120);
  assert.equal(bounds.x, 990);
  assert.equal(bounds.y, 290);
});

test('resolveWindowMetrics returns compact profile and chat default visibility', () => {
  const metrics = resolveWindowMetrics({
    window: {
      width: 460,
      height: 620,
      compactWidth: 280,
      compactHeight: 540,
      compactWhenChatHidden: true,
      maxWidth: 880,
      maxHeight: 1180
    },
    chat: {
      panel: {
        enabled: true,
        defaultVisible: false
      }
    }
  });

  assert.equal(metrics.expandedWidth, 460);
  assert.equal(metrics.expandedHeight, 620);
  assert.equal(metrics.compactWidth, 280);
  assert.equal(metrics.compactHeight, 540);
  assert.equal(metrics.maxWidth, 880);
  assert.equal(metrics.maxHeight, 1180);
  assert.equal(metrics.defaultChatPanelVisible, false);
});

test('resolveWindowSizeForChatPanel switches expanded/compact by visibility', () => {
  const metrics = resolveWindowMetrics({
    window: {
      width: 460,
      height: 620,
      compactWidth: 300,
      compactHeight: 560
    },
    chat: {
      panel: {
        enabled: true,
        defaultVisible: false
      }
    }
  });

  assert.deepEqual(resolveWindowSizeForChatPanel({ windowMetrics: metrics, chatPanelVisible: true }), {
    width: 460,
    height: 620
  });
  assert.deepEqual(resolveWindowSizeForChatPanel({ windowMetrics: metrics, chatPanelVisible: false }), {
    width: 300,
    height: 560
  });
});

test('resizeWindowKeepingBottomRight preserves anchor while changing size', () => {
  const calls = [];
  const fakeWindow = {
    getBounds() {
      return { x: 1000, y: 300, width: 460, height: 620 };
    },
    setBounds(bounds) {
      calls.push(bounds);
    }
  };

  resizeWindowKeepingBottomRight({
    window: fakeWindow,
    width: 300,
    height: 560
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { x: 1160, y: 360, width: 300, height: 560 });
});

test('normalizeChatInputPayload sanitizes and validates payload', () => {
  const result = normalizeChatInputPayload({
    role: 'assistant',
    text: ' hello ',
    source: 'chat-panel',
    timestamp: 1234
  });
  assert.equal(result.role, 'assistant');
  assert.equal(result.text, 'hello');
  assert.equal(result.source, 'chat-panel');
  assert.equal(result.timestamp, 1234);

  const fallback = normalizeChatInputPayload({ role: 'bad', text: 'x' });
  assert.equal(fallback.role, 'user');
  assert.equal(typeof fallback.timestamp, 'number');
  assert.deepEqual(fallback.input_images, []);

  const imageOnly = normalizeChatInputPayload({
    text: '  ',
    input_images: [{
      client_id: 'img-1',
      name: 'clipboard.png',
      mime_type: 'image/png',
      size_bytes: 16,
      data_url: 'data:image/png;base64,AAAA'
    }]
  });
  assert.equal(imageOnly.text, '');
  assert.equal(imageOnly.input_images.length, 1);
  assert.equal(imageOnly.input_images[0].mime_type, 'image/png');

  const invalid = normalizeChatInputPayload({ text: '   ' });
  assert.equal(invalid, null);
  assert.equal(normalizeChatInputPayload({ text: 'ok', input_images: {} }), null);
});

test('normalizeChatMessageImages keeps preview and data URL fields', () => {
  const images = normalizeChatMessageImages([
    {
      client_id: 'img-a',
      name: 'capture.png',
      mime_type: 'image/png',
      size_bytes: 12,
      data_url: 'data:image/png;base64,AAAA'
    },
    {
      client_id: 'img-b',
      name: 'from-server.png',
      mime_type: 'image/png',
      size_bytes: 21,
      url: '/api/session-images/s1/from-server.png'
    }
  ]);

  assert.equal(images.length, 2);
  assert.equal(images[0].dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(images[0].previewUrl, 'data:image/png;base64,AAAA');
  assert.equal(images[1].url, '/api/session-images/s1/from-server.png');
  assert.equal(images[1].previewUrl, '/api/session-images/s1/from-server.png');
});

test('normalizeChatImagePreviewPayload resolves data and relative urls', () => {
  const dataUrlPayload = normalizeChatImagePreviewPayload({
    name: 'clip.png',
    mime_type: 'image/png',
    data_url: 'data:image/png;base64,AAAA'
  }, { gatewayUrl: 'http://127.0.0.1:3000' });
  assert.equal(dataUrlPayload.imageUrl, 'data:image/png;base64,AAAA');

  const relativePayload = normalizeChatImagePreviewPayload({
    name: 'remote.png',
    mimeType: 'image/png',
    previewUrl: '/api/session-images/s1/remote.png'
  }, { gatewayUrl: 'http://127.0.0.1:3000' });
  assert.equal(relativePayload.imageUrl, 'http://127.0.0.1:3000/api/session-images/s1/remote.png');
  assert.equal(normalizeChatImagePreviewPayload({ previewUrl: 'javascript:alert(1)' }, { gatewayUrl: 'http://127.0.0.1:3000' }), null);
});

test('normalizeWindowDragPayload validates action and screen coordinates', () => {
  const valid = normalizeWindowDragPayload({ action: ' move ', screenX: 100.4, screenY: 250.9 });
  assert.deepEqual(valid, {
    action: 'move',
    screenX: 100,
    screenY: 251
  });

  assert.equal(normalizeWindowDragPayload({ action: 'drag', screenX: 1, screenY: 2 }), null);
  assert.equal(normalizeWindowDragPayload({ action: 'start', screenX: 'x', screenY: 2 }), null);
});

test('normalizeWindowControlPayload and normalizeChatPanelVisibilityPayload validate payloads', () => {
  assert.deepEqual(normalizeWindowControlPayload({ action: 'hide' }), { action: 'hide' });
  assert.deepEqual(normalizeWindowControlPayload({ action: ' hide_chat ' }), { action: 'hide_chat' });
  assert.deepEqual(normalizeWindowControlPayload({ action: ' close_pet ' }), { action: 'close_pet' });
  assert.deepEqual(normalizeWindowControlPayload({ action: ' open_webui ' }), { action: 'open_webui' });
  assert.deepEqual(normalizeWindowControlPayload({ action: ' close_resize_mode ' }), { action: 'close_resize_mode' });
  assert.deepEqual(normalizeWindowControlPayload({
    action: ' save_layout_overrides ',
    layout: { offsetX: 10.2, offsetY: -11.8, scaleMultiplier: 1.137 }
  }), {
    action: 'save_layout_overrides',
    layout: { offsetX: 10, offsetY: -12, scaleMultiplier: 1.137 }
  });
  assert.deepEqual(normalizeWindowControlPayload({
    action: ' save_drag_zone_overrides ',
    dragZone: { centerXRatio: 0.4567, centerYRatio: 0.5211, widthRatio: 0.3988, heightRatio: 0.2844 }
  }), {
    action: 'save_drag_zone_overrides',
    dragZone: { centerXRatio: 0.457, centerYRatio: 0.521, widthRatio: 0.399, heightRatio: 0.284 }
  });
  assert.deepEqual(normalizeWindowControlPayload({
    action: 'save_drag_zone_overrides',
    dragZone: { centerXRatio: 0.95, centerYRatio: 0.05, widthRatio: 0.8, heightRatio: 0.6 }
  }), {
    action: 'save_drag_zone_overrides',
    dragZone: { centerXRatio: 0.6, centerYRatio: 0.3, widthRatio: 0.8, heightRatio: 0.6 }
  });
  assert.equal(normalizeWindowControlPayload({ action: 'quit' }), null);
  assert.equal(normalizeWindowControlPayload({ action: 'save_layout_overrides', layout: { offsetX: 1 } }), null);
  assert.equal(normalizeWindowControlPayload({ action: 'save_drag_zone_overrides', dragZone: { centerXRatio: 0.5 } }), null);

  assert.deepEqual(normalizeChatPanelVisibilityPayload({ visible: true }), { visible: true });
  assert.equal(normalizeChatPanelVisibilityPayload({ visible: 'true' }), null);
});

test('normalizeWindowResizePayload validates resize actions and dimensions', () => {
  assert.deepEqual(normalizeWindowResizePayload({
    action: ' set ',
    width: 401.7,
    height: 602.2,
    source: 'toolbar'
  }), {
    action: 'set',
    width: 402,
    height: 602,
    source: 'toolbar'
  });

  assert.deepEqual(normalizeWindowResizePayload({ action: 'grow', step: 80 }), {
    action: 'grow',
    step: 80,
    source: 'avatar-window'
  });
  assert.deepEqual(normalizeWindowResizePayload({ action: 'reset', persist: false }), {
    action: 'reset',
    persist: false,
    source: 'avatar-window'
  });
  assert.equal(normalizeWindowResizePayload({ action: 'set', width: 0, height: 10 }), null);
  assert.equal(normalizeWindowResizePayload({ action: 'unknown' }), null);
});

test('normalizeWindowInteractivityPayload validates boolean interactive payload', () => {
  assert.deepEqual(normalizeWindowInteractivityPayload({ interactive: true }), { interactive: true });
  assert.deepEqual(normalizeWindowInteractivityPayload({ interactive: false }), { interactive: false });
  assert.equal(normalizeWindowInteractivityPayload({ interactive: 'true' }), null);
  assert.equal(normalizeWindowInteractivityPayload(null), null);
});

test('normalizeModelBoundsPayload validates numeric bounds payload', () => {
  assert.deepEqual(normalizeModelBoundsPayload({
    x: 12.2,
    y: 18.8,
    width: 205.1,
    height: 390.7,
    stageWidth: 320,
    stageHeight: 500
  }), {
    x: 12,
    y: 19,
    width: 205,
    height: 391,
    stageWidth: 320,
    stageHeight: 500
  });
  assert.equal(normalizeModelBoundsPayload({ x: 1, y: 2, width: 0, height: 10, stageWidth: 10, stageHeight: 10 }), null);
});

test('normalizeBubbleMetricsPayload validates numeric metrics payload', () => {
  assert.deepEqual(normalizeBubbleMetricsPayload({ width: 319.4, height: 156.8 }), { width: 319, height: 157 });
  assert.equal(normalizeBubbleMetricsPayload({ width: 0, height: 10 }), null);
  assert.equal(normalizeBubbleMetricsPayload({ width: 10, height: NaN }), null);
});

test('computeFittedAvatarWindowBounds shrinks to model bounds and keeps screen safety margin', () => {
  const next = computeFittedAvatarWindowBounds({
    windowBounds: { x: 1300, y: 560, width: 320, height: 500 },
    modelBounds: { x: 70, y: 20, width: 180, height: 430 },
    display: {
      workArea: {
        x: 0,
        y: 25,
        width: 1728,
        height: 1080
      }
    }
  });

  assert.ok(next.width <= 320);
  assert.ok(next.height <= 500);
  assert.ok(next.x >= 8);
  assert.ok(next.y >= 33);
});

test('computeFittedAvatarWindowBounds can preserve bottom-right anchor during resize mode', () => {
  const next = computeFittedAvatarWindowBounds({
    windowBounds: { x: 1300, y: 560, width: 320, height: 500 },
    modelBounds: { x: 70, y: 20, width: 180, height: 430 },
    display: {
      workArea: {
        x: 0,
        y: 25,
        width: 1728,
        height: 1080
      }
    },
    anchor: 'bottom-right'
  });

  assert.equal(next.x + next.width, 1620);
  assert.equal(next.y + next.height, 1060);
});

test('createWindowDragListener repositions window across start/move/end', () => {
  const fakeWindow = {
    x: 300,
    y: 420,
    width: 0,
    height: 0,
    getPosition() {
      return [this.x, this.y];
    },
    setPosition(nextX, nextY) {
      this.x = nextX;
      this.y = nextY;
    }
  };

  const BrowserWindow = {
    fromWebContents(sender) {
      return sender?.id === 7 ? fakeWindow : null;
    }
  };

  const listener = createWindowDragListener({ BrowserWindow });
  const sender = { id: 7 };

  listener({ sender }, { action: 'start', screenX: 1100, screenY: 700 });
  listener({ sender }, { action: 'move', screenX: 1142, screenY: 755 });
  assert.deepEqual([fakeWindow.x, fakeWindow.y], [342, 475]);

  listener({ sender }, { action: 'end', screenX: 1142, screenY: 755 });
  listener({ sender }, { action: 'move', screenX: 1160, screenY: 760 });
  assert.deepEqual([fakeWindow.x, fakeWindow.y], [342, 475]);
});

test('resolveDisplayForBounds and clampWindowBoundsToWorkArea keep bounds inside matching display', () => {
  const primaryDisplay = {
    id: 'primary',
    workArea: { x: 0, y: 0, width: 1440, height: 900 }
  };
  const secondaryDisplay = {
    id: 'secondary',
    workArea: { x: 1440, y: 0, width: 1280, height: 900 }
  };
  const screen = {
    getDisplayMatching(bounds) {
      return bounds.x >= 1440 ? secondaryDisplay : primaryDisplay;
    }
  };

  const display = resolveDisplayForBounds({
    screen,
    bounds: { x: 1700, y: 40, width: 460, height: 620 }
  });
  const clamped = clampWindowBoundsToWorkArea({
    bounds: { x: 2500, y: 700, width: 600, height: 500 },
    display,
    minWidth: 200,
    minHeight: 200,
    maxWidth: 700,
    maxHeight: 700
  });

  assert.equal(display.id, 'secondary');
  assert.equal(clamped.width, 600);
  assert.equal(clamped.height, 500);
  assert.ok(clamped.x <= 2112);
  assert.ok(clamped.y <= 392);
});

test('clampWindowBoundsToWorkArea allows avatar window to remain 20% visible', () => {
  const display = {
    id: 'secondary',
    workArea: { x: 1440, y: 0, width: 1280, height: 900 }
  };

  const clamped = clampWindowBoundsToWorkArea({
    bounds: { x: 3200, y: 1000, width: 900, height: 700 },
    display,
    minWidth: 200,
    minHeight: 200,
    maxWidth: 2000,
    maxHeight: 2000,
    maxOffscreenRatio: 0.8
  });

  assert.deepEqual(clamped, { x: 2532, y: 752, width: 900, height: 700 });
});

test('createWindowDragListener clamps moved window into display work area', () => {
  const fakeWindow = {
    x: 300,
    y: 420,
    width: 460,
    height: 620,
    getPosition() {
      return [this.x, this.y];
    },
    getBounds() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    },
    setPosition(nextX, nextY) {
      this.x = nextX;
      this.y = nextY;
    }
  };

  const BrowserWindow = {
    fromWebContents(sender) {
      return sender?.id === 17 ? fakeWindow : null;
    }
  };
  const screen = {
    getDisplayMatching() {
      return {
        workArea: { x: 0, y: 0, width: 1440, height: 900 }
      };
    }
  };

  const listener = createWindowDragListener({ BrowserWindow, screen });
  const sender = { id: 17 };
  listener({ sender }, { action: 'start', screenX: 1100, screenY: 700 });
  listener({ sender }, { action: 'move', screenX: 2100, screenY: 1700 });

  assert.deepEqual([fakeWindow.x, fakeWindow.y], [972, 272]);
});

test('createWindowDragListener allows dragging avatar window mostly off-screen when configured', () => {
  const fakeWindow = {
    x: 300,
    y: 420,
    width: 460,
    height: 620,
    getPosition() {
      return [this.x, this.y];
    },
    getBounds() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    },
    setPosition(nextX, nextY) {
      this.x = nextX;
      this.y = nextY;
    }
  };

  const BrowserWindow = {
    fromWebContents(sender) {
      return sender?.id === 17 ? fakeWindow : null;
    }
  };
  const screen = {
    getDisplayMatching() {
      return {
        workArea: { x: 0, y: 0, width: 1440, height: 900 }
      };
    }
  };

  const listener = createWindowDragListener({
    BrowserWindow,
    screen,
    maxOffscreenRatio: 0.8
  });
  const sender = { id: 17 };
  listener({ sender }, { action: 'start', screenX: 1100, screenY: 700 });
  listener({ sender }, { action: 'move', screenX: 2300, screenY: 1900 });

  assert.deepEqual([fakeWindow.x, fakeWindow.y], [1340, 768]);
});

test('createWindowControlListener handles chat, hide, close, webui, and resize actions for active window sender', () => {
  const webContents = { id: 3 };
  const window = {
    webContents,
    isDestroyed() {
      return false;
    }
  };
  let hideCount = 0;
  let hideChatCount = 0;
  let closeCount = 0;
  let openWebUiCount = 0;
  let closeResizeModeCount = 0;
  const savedLayouts = [];
  const savedDragZones = [];
  const listener = createWindowControlListener({
    window,
    onHide: () => { hideCount += 1; },
    onHideChat: () => { hideChatCount += 1; },
    onClosePet: () => { closeCount += 1; },
    onOpenWebUi: () => { openWebUiCount += 1; },
    onCloseResizeMode: () => { closeResizeModeCount += 1; },
    onSaveLayoutOverrides: (payload) => { savedLayouts.push(payload); },
    onSaveDragZoneOverrides: (payload) => { savedDragZones.push(payload); }
  });

  listener({ sender: webContents }, { action: 'hide' });
  listener({ sender: webContents }, { action: 'hide_chat' });
  listener({ sender: webContents }, { action: 'close_pet' });
  listener({ sender: webContents }, { action: 'open_webui' });
  listener({ sender: webContents }, { action: 'close_resize_mode' });
  listener({ sender: webContents }, {
    action: 'save_layout_overrides',
    layout: { offsetX: 8, offsetY: -12, scaleMultiplier: 1.12 }
  });
  listener({ sender: webContents }, {
    action: 'save_drag_zone_overrides',
    dragZone: { centerXRatio: 0.46, centerYRatio: 0.52, widthRatio: 0.4, heightRatio: 0.28 }
  });
  listener({ sender: { id: 99 } }, { action: 'hide' });

  assert.equal(hideCount, 1);
  assert.equal(hideChatCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(openWebUiCount, 1);
  assert.equal(closeResizeModeCount, 1);
  assert.deepEqual(savedLayouts, [{ offsetX: 8, offsetY: -12, scaleMultiplier: 1.12 }]);
  assert.deepEqual(savedDragZones, [{ centerXRatio: 0.46, centerYRatio: 0.52, widthRatio: 0.4, heightRatio: 0.28 }]);
});

test('createChatPanelVisibilityListener resizes when visibility changes', () => {
  const webContents = { id: 6 };
  const setBoundsCalls = [];
  const state = { x: 1000, y: 300, width: 460, height: 620 };
  const window = {
    webContents,
    isDestroyed() {
      return false;
    },
    getBounds() {
      return { ...state };
    },
    setBounds(bounds) {
      setBoundsCalls.push(bounds);
      state.x = bounds.x;
      state.y = bounds.y;
      state.width = bounds.width;
      state.height = bounds.height;
    }
  };
  const metrics = resolveWindowMetrics({
    window: { width: 460, height: 620, compactWidth: 300, compactHeight: 560 },
    chat: { panel: { enabled: true, defaultVisible: false } }
  });

  const listener = createChatPanelVisibilityListener({ window, windowMetrics: metrics });
  listener({ sender: webContents }, { visible: false });
  listener({ sender: webContents }, { visible: false });
  listener({ sender: webContents }, { visible: true });

  assert.equal(setBoundsCalls.length, 2);
  assert.deepEqual(setBoundsCalls[0], { x: 1160, y: 360, width: 300, height: 560 });
  assert.deepEqual(setBoundsCalls[1], { x: 1000, y: 300, width: 460, height: 620 });
});

test('buildWindowStatePayload returns normalized bounds and defaults', () => {
  const payload = buildWindowStatePayload({
    window: {
      getBounds() {
        return { x: 1000.4, y: 300.2, width: 460.7, height: 620.9 };
      }
    },
    windowMetrics: {
      minWidth: 280,
      minHeight: 360,
      expandedWidth: 460,
      expandedHeight: 620
    }
  });

  assert.deepEqual(payload, {
    width: 461,
    height: 621,
    x: 1000,
    y: 300,
    minWidth: 280,
    minHeight: 360,
    maxWidth: 0,
    maxHeight: 0,
    defaultWidth: 460,
    defaultHeight: 620,
    aspectRatio: 460 / 620,
    resizeModeEnabled: false
  });
});

test('normalizePersistedWindowState clamps saved size into runtime bounds', () => {
  const normalized = normalizePersistedWindowState({
    width: 999,
    height: 200
  }, {
    windowMetrics: {
      minWidth: 280,
      minHeight: 360,
      maxWidth: 540,
      maxHeight: 700,
      expandedWidth: 460,
      expandedHeight: 620
    }
  });

  assert.deepEqual(normalized, {
    width: 519,
    height: 700
  });
});

test('loadPersistedWindowState and writePersistedWindowState round-trip window size', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-window-state-'));
  const statePath = path.join(tmpDir, 'desktop-live2d', 'window-state.json');

  writePersistedWindowState(statePath, { width: 519, height: 700 });
  const loaded = loadPersistedWindowState(statePath, {
    windowMetrics: {
      minWidth: 280,
      minHeight: 360,
      maxWidth: 540,
      maxHeight: 700,
      expandedWidth: 460,
      expandedHeight: 620
    },
    logger: { warn() {} }
  });

  assert.deepEqual(loaded, { width: 519, height: 700 });
});

test('createWindowResizeListener resizes avatar window and publishes updated state', () => {
  const webContents = { id: 16 };
  const setBoundsCalls = [];
  const emittedStates = [];
  const state = { x: 1000, y: 300, width: 460, height: 620 };
  const window = {
    webContents,
    isDestroyed() {
      return false;
    },
    getBounds() {
      return { ...state };
    },
    setBounds(bounds) {
      setBoundsCalls.push(bounds);
      state.x = bounds.x;
      state.y = bounds.y;
      state.width = bounds.width;
      state.height = bounds.height;
    }
  };

  const listener = createWindowResizeListener({
    window,
    windowMetrics: {
      minWidth: 300,
      minHeight: 420,
      maxWidth: 540,
      maxHeight: 700,
      expandedWidth: 460,
      expandedHeight: 620
    },
    screen: {
      getDisplayMatching() {
        return {
          workArea: { x: 0, y: 0, width: 1440, height: 900 }
        };
      }
    },
    onStateChange: (payload) => emittedStates.push(payload)
  });

  listener({ sender: webContents }, { action: 'grow', step: 60 });
  listener({ sender: webContents }, { action: 'grow', step: 80 });
  listener({ sender: webContents }, { action: 'shrink', step: 500 });
  listener({ sender: webContents }, { action: 'reset' });

  assert.equal(setBoundsCalls[0].width, 519);
  assert.equal(setBoundsCalls[0].height, 700);
  assert.ok(setBoundsCalls[0].x >= 8);
  assert.ok(setBoundsCalls[0].y >= 8);
  assert.equal(setBoundsCalls[1].width, 312);
  assert.equal(setBoundsCalls[1].height, 420);
  assert.ok(setBoundsCalls[1].x >= 8);
  assert.ok(setBoundsCalls[1].y >= 8);
  assert.equal(setBoundsCalls[2].width, 460);
  assert.equal(setBoundsCalls[2].height, 620);
  assert.ok(setBoundsCalls[2].x >= 8);
  assert.ok(setBoundsCalls[2].y >= 8);
  assert.equal(emittedStates.length, 4);
  assert.equal(emittedStates[3].width, 460);
  assert.equal(emittedStates[3].height, 620);
});

test('createWindowInteractivityListener toggles ignore mouse events and keeps resize mode interactive', () => {
  const webContents = { id: 23 };
  const calls = [];
  let resizeModeEnabled = false;
  const window = {
    webContents,
    isDestroyed() {
      return false;
    },
    setIgnoreMouseEvents(ignore, options) {
      calls.push({ ignore, options });
    }
  };

  const listener = createWindowInteractivityListener({
    window,
    isResizeModeEnabled: () => resizeModeEnabled
  });

  listener({ sender: webContents }, { interactive: false });
  listener({ sender: webContents }, { interactive: true });
  resizeModeEnabled = true;
  listener({ sender: webContents }, { interactive: false });

  assert.deepEqual(calls, [
    { ignore: true, options: { forward: true } },
    { ignore: false, options: undefined }
  ]);
});


test('createModelBoundsListener forwards normalized bounds for avatar sender only', () => {
  const webContents = { id: 10 };
  const window = {
    webContents,
    isDestroyed() {
      return false;
    }
  };
  const received = [];
  const listener = createModelBoundsListener({
    window,
    onModelBounds: (payload) => received.push(payload)
  });

  listener({ sender: webContents }, { x: 10, y: 20, width: 200, height: 420, stageWidth: 320, stageHeight: 500 });
  listener({ sender: { id: 99 } }, { x: 10, y: 20, width: 200, height: 420, stageWidth: 320, stageHeight: 500 });
  listener({ sender: webContents }, { x: 10, y: 20, width: 0, height: 420, stageWidth: 320, stageHeight: 500 });

  assert.equal(received.length, 1);
  assert.equal(received[0].width, 200);
});

test('createBubbleMetricsListener forwards normalized bubble metrics for bubble sender only', () => {
  const webContents = { id: 12 };
  const window = {
    webContents,
    isDestroyed() {
      return false;
    }
  };
  const received = [];
  const listener = createBubbleMetricsListener({
    window,
    onBubbleMetrics: (payload) => received.push(payload)
  });

  listener({ sender: webContents }, { width: 320.2, height: 167.7 });
  listener({ sender: { id: 99 } }, { width: 320.2, height: 167.7 });
  listener({ sender: webContents }, { width: 0, height: 120 });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { width: 320, height: 168 });
});

test('normalizeActionTelemetryPayload validates telemetry shape', () => {
  const normalized = normalizeActionTelemetryPayload({
    event: ' done ',
    action_id: 'act-1',
    action_type: 'expression',
    queue_size: 3,
    timestamp: 1000
  });

  assert.deepEqual(normalized, {
    event: 'done',
    action_id: 'act-1',
    action_type: 'expression',
    queue_size: 3,
    timestamp: 1000
  });
  assert.equal(normalizeActionTelemetryPayload({ event: 'invalid' }), null);
});

test('createActionTelemetryListener forwards normalized payload for avatar sender only', () => {
  const webContents = { id: 28 };
  const window = {
    webContents,
    isDestroyed() {
      return false;
    }
  };
  const received = [];
  const listener = createActionTelemetryListener({
    window,
    onTelemetry: (payload) => received.push(payload)
  });

  listener({ sender: webContents }, {
    event: 'start',
    action_id: 'act-2',
    action_type: 'motion',
    queue_size: 1
  });
  listener({ sender: { id: 999 } }, { event: 'done', action_id: 'act-2' });
  listener({ sender: webContents }, { event: 'bad' });

  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'start');
  assert.equal(received[0].action_id, 'act-2');
});

test('createChatInputListener forwards normalized payload to callback', () => {
  const logs = [];
  const received = [];
  const listener = createChatInputListener({
    logger: { info: (...args) => logs.push(args) },
    onChatInput: (payload) => received.push(payload)
  });

  listener(null, { role: 'tool', text: ' invoke ', source: 'chat-panel' });
  listener(null, {
    text: ' ',
    input_images: [{
      data_url: 'data:image/png;base64,AAAA',
      mime_type: 'image/png',
      size_bytes: 10
    }]
  });
  listener(null, { text: '   ' });

  assert.equal(logs.length, 2);
  assert.equal(received.length, 2);
  assert.equal(received[0].role, 'tool');
  assert.equal(received[0].text, 'invoke');
  assert.equal(received[1].text, '');
  assert.equal(received[1].input_images.length, 1);
});

test('forwardLive2dActionEvent forwards normalized payload into renderer enqueue method', async () => {
  const calls = [];
  const telemetry = [];
  const result = await forwardLive2dActionEvent({
    eventName: 'ui.live2d.action',
    eventPayload: {
      action_id: 'act-1',
      action: {
        type: 'expression',
        name: 'tear_drop'
      },
      duration_sec: 1.8,
      queue_policy: 'append'
    },
    bridge: {
      invoke: async (payload) => {
        calls.push(payload);
        return { ok: true, queued: 1, queue_size: 1 };
      }
    },
    onTelemetry: (payload) => telemetry.push(payload),
    rendererTimeoutMs: 2222
  });

  assert.equal(result.forwarded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'live2d.action.enqueue');
  assert.equal(calls[0].timeoutMs, 2222);
  assert.equal(calls[0].params.action.type, 'expression');
  assert.equal(calls[0].params.duration_sec, 1.8);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].event, 'ack');
  assert.equal(telemetry[0].action_id, 'act-1');
});

test('forwardLive2dActionEvent skips invalid payload and does not invoke bridge', async () => {
  let called = false;
  const result = await forwardLive2dActionEvent({
    eventName: 'ui.live2d.action',
    eventPayload: {
      action: {
        type: 'expression',
        name: 'smile'
      },
      duration_sec: 0
    },
    bridge: {
      invoke: async () => {
        called = true;
        return { ok: true };
      }
    }
  });

  assert.equal(result.forwarded, false);
  assert.equal(result.reason, 'invalid_payload');
  assert.equal(called, false);
});

test('handleDesktopRpcRequest returns tool list without touching renderer bridge', async () => {
  const result = await handleDesktopRpcRequest({
    request: { method: 'tool.list', params: {} },
    bridge: {
      invoke: async () => {
        throw new Error('should not be called');
      }
    },
    rendererTimeoutMs: 3000
  });

  assert.ok(Array.isArray(result.tools));
  assert.ok(result.tools.some((tool) => tool.name === 'desktop_chat_show'));
});

test('handleDesktopRpcRequest returns display list without touching renderer bridge', async () => {
  const result = await handleDesktopRpcRequest({
    request: { method: 'desktop.perception.displays.list', params: {} },
    perceptionService: {
      listDisplays() {
        return [{ id: 'display:1', primary: true }];
      }
    },
    bridge: {
      invoke: async () => {
        throw new Error('should not be called');
      }
    },
    rendererTimeoutMs: 3000
  });

  assert.deepEqual(result, {
    displays: [{ id: 'display:1', primary: true }]
  });
});

test('handleDesktopRpcRequest returns perception capabilities without touching renderer bridge', async () => {
  const result = await handleDesktopRpcRequest({
    request: { method: 'desktop.perception.capabilities', params: {} },
    perceptionService: {
      getCapabilities() {
        return {
          platform: 'darwin',
          displays_available: true,
          screen_capture: true,
          region_capture: true,
          reason: null
        };
      }
    },
    bridge: {
      invoke: async () => {
        throw new Error('should not be called');
      }
    },
    rendererTimeoutMs: 3000
  });

  assert.deepEqual(result, {
    platform: 'darwin',
    displays_available: true,
    screen_capture: true,
    region_capture: true,
    reason: null
  });
});

test('handleDesktopRpcRequest maps tool.invoke to renderer method', async () => {
  const calls = [];
  const result = await handleDesktopRpcRequest({
    request: {
      method: 'tool.invoke',
      params: {
        name: 'desktop_model_set_param',
        arguments: { name: 'ParamAngleX', value: 3 }
      }
    },
    bridge: {
      invoke: async (payload) => {
        calls.push(payload);
        return { ok: true };
      }
    },
    rendererTimeoutMs: 3456
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'model.param.set');
  assert.equal(calls[0].timeoutMs, 3456);
  assert.deepEqual(calls[0].params, { name: 'ParamAngleX', value: 3 });
  assert.equal(result.ok, true);
});

test('handleDesktopRpcRequest resolves local desktop capture tool without touching renderer bridge', async () => {
  const calls = [];
  const result = await handleDesktopRpcRequest({
    request: {
      method: 'tool.invoke',
      params: {
        name: 'desktop_capture_screen',
        arguments: { display_id: 'display:2' }
      }
    },
    captureService: {
      async captureScreen(params) {
        calls.push(params);
        return { capture_id: 'cap_1', display_id: 'display:2' };
      }
    },
    bridge: {
      invoke: async () => {
        throw new Error('renderer bridge should not be called');
      }
    },
    rendererTimeoutMs: 3456
  });

  assert.deepEqual(calls, [{ display_id: 'display:2' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { capture_id: 'cap_1', display_id: 'display:2' });
});

test('isNewSessionCommand matches /new command only', () => {
  assert.equal(isNewSessionCommand('/new'), true);
  assert.equal(isNewSessionCommand('  /NEW  '), true);
  assert.equal(isNewSessionCommand('/new session'), false);
  assert.equal(isNewSessionCommand('hello'), false);
});
