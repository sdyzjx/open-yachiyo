const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const { resolveDesktopLive2dConfig, upsertDesktopLive2dLayoutOverrides, DEFAULT_UI_CONFIG } = require('./config');
const { validateModelAssetDirectory } = require('./modelAssets');
const { GatewaySupervisor } = require('./gatewaySupervisor');
const { Live2dRpcServer } = require('./rpcServer');
const { IpcRpcBridge } = require('./ipcBridge');
const { GatewayRuntimeClient, createDesktopSessionId } = require('./gatewayRuntimeClient');
const { listDesktopTools, resolveToolInvoke } = require('./toolRegistry');
const { QwenTtsClient } = require('./voice/qwenTtsClient');
const {
  ACTION_EVENT_NAME,
  ACTION_ENQUEUE_METHOD,
  normalizeLive2dActionMessage
} = require('../shared/live2dActionMessage');

const CHANNELS = Object.freeze({
  invoke: 'live2d:rpc:invoke',
  result: 'live2d:rpc:result',
  rendererReady: 'live2d:renderer:ready',
  rendererError: 'live2d:renderer:error',
  getRuntimeConfig: 'live2d:get-runtime-config',
  chatInputSubmit: 'live2d:chat:input:submit',
  chatPanelToggle: 'live2d:chat:panel-toggle',
  chatStateSync: 'live2d:chat:state-sync',
  bubbleStateSync: 'live2d:bubble:state-sync',
  bubbleMetricsUpdate: 'live2d:bubble:metrics-update',
  modelBoundsUpdate: 'live2d:model:bounds-update',
  actionTelemetry: 'live2d:action:telemetry',
  windowDrag: 'live2d:window:drag',
  windowControl: 'live2d:window:control',
  chatPanelVisibility: 'live2d:chat:panel-visibility',
  windowResizeRequest: 'live2d:window:resize-request',
  windowStateSync: 'live2d:window:state-sync'
});

const AVATAR_WINDOW_MAX_OFFSCREEN_RATIO = 0.8;

function normalizeLive2dPresetConfig(config = {}) {
  const safe = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const toObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  return {
    version: Number(safe.version || 1),
    emote: toObject(safe.emote),
    gesture: toObject(safe.gesture),
    react: toObject(safe.react)
  };
}

function loadLive2dPresetConfig({ projectRoot, env = process.env, logger = console } = {}) {
  const presetPath = path.resolve(
    env.LIVE2D_PRESETS_PATH || path.join(projectRoot || process.cwd(), 'config', 'live2d-presets.yaml')
  );

  try {
    const rawYaml = fs.readFileSync(presetPath, 'utf8');
    return normalizeLive2dPresetConfig(YAML.parse(rawYaml) || {});
  } catch (err) {
    logger.warn?.('[desktop-live2d] failed to load live2d presets', {
      presetPath,
      error: err?.message || String(err || 'unknown error')
    });
    return normalizeLive2dPresetConfig({});
  }
}

function isNewSessionCommand(text) {
  return String(text || '').trim().toLowerCase() === '/new';
}

function normalizeWindowDragPayload(payload) {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['start', 'move', 'end'].includes(action)) {
    return null;
  }

  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return null;
  }

  return {
    action,
    screenX: Math.round(screenX),
    screenY: Math.round(screenY)
  };
}

function createWindowDragListener({
  BrowserWindow,
  screen,
  margin = 8,
  maxOffscreenRatio = 0
} = {}) {
  const dragStates = new Map();
  return (event, payload) => {
    const normalized = normalizeWindowDragPayload(payload);
    if (!normalized) {
      return;
    }

    const sender = event?.sender;
    if (!sender || !BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') {
      return;
    }

    const win = BrowserWindow.fromWebContents(sender);
    if (!win || typeof win.getPosition !== 'function' || typeof win.setPosition !== 'function') {
      return;
    }

    const senderId = Number(sender.id);
    if (!Number.isFinite(senderId)) {
      return;
    }

    if (normalized.action === 'start') {
      const [windowX, windowY] = win.getPosition();
      dragStates.set(senderId, {
        cursorX: normalized.screenX,
        cursorY: normalized.screenY,
        windowX,
        windowY
      });
      return;
    }

    if (normalized.action === 'move') {
      const state = dragStates.get(senderId);
      if (!state) {
        return;
      }
      const nextX = Math.round(state.windowX + normalized.screenX - state.cursorX);
      const nextY = Math.round(state.windowY + normalized.screenY - state.cursorY);
      if (typeof win.getBounds === 'function') {
        const currentBounds = win.getBounds();
        const nextBounds = clampWindowBoundsToWorkArea({
          bounds: {
            x: nextX,
            y: nextY,
            width: currentBounds.width,
            height: currentBounds.height
          },
          display: resolveDisplayForBounds({
            screen,
            bounds: {
              x: nextX,
              y: nextY,
              width: currentBounds.width,
              height: currentBounds.height
            }
          }),
          minWidth: currentBounds.width,
          minHeight: currentBounds.height,
          maxWidth: currentBounds.width,
          maxHeight: currentBounds.height,
          margin,
          maxOffscreenRatio
        });
        win.setPosition(nextBounds.x, nextBounds.y);
        return;
      }
      win.setPosition(nextX, nextY);
      return;
    }

    if (normalized.action === 'end') {
      dragStates.delete(senderId);
    }
  };
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function resolveWindowMetrics(uiConfig) {
  const windowConfig = uiConfig?.window || {};
  const chatPanelConfig = uiConfig?.chat?.panel || {};

  const expandedWidth = toPositiveInt(windowConfig.width, 460);
  const expandedHeight = toPositiveInt(windowConfig.height, 620);
  const compactWhenChatHidden = windowConfig.compactWhenChatHidden !== false;
  const compactWidth = toPositiveInt(windowConfig.compactWidth, Math.min(expandedWidth, 300));
  const compactHeight = toPositiveInt(windowConfig.compactHeight, Math.min(expandedHeight, 560));

  const minWidthRaw = toPositiveInt(windowConfig.minWidth, 360);
  const minHeightRaw = toPositiveInt(windowConfig.minHeight, 480);
  const baseMinWidth = Math.max(120, Math.min(minWidthRaw, expandedWidth, compactWhenChatHidden ? compactWidth : expandedWidth));
  const baseMinHeight = Math.max(160, Math.min(minHeightRaw, expandedHeight, compactWhenChatHidden ? compactHeight : expandedHeight));
  const maxWidthRaw = toPositiveInt(windowConfig.maxWidth, 900);
  const maxHeightRaw = toPositiveInt(windowConfig.maxHeight, 1400);

  return {
    expandedWidth,
    expandedHeight,
    compactWidth,
    compactHeight,
    compactWhenChatHidden,
    minWidth: baseMinWidth,
    minHeight: baseMinHeight,
    maxWidth: Math.max(baseMinWidth, expandedWidth, compactWidth, maxWidthRaw),
    maxHeight: Math.max(baseMinHeight, expandedHeight, compactHeight, maxHeightRaw),
    defaultChatPanelVisible: Boolean(chatPanelConfig.enabled && chatPanelConfig.defaultVisible)
  };
}

function resolveWindowSizeForChatPanel({ windowMetrics, chatPanelVisible }) {
  if (!windowMetrics?.compactWhenChatHidden || chatPanelVisible) {
    return {
      width: windowMetrics?.expandedWidth || 460,
      height: windowMetrics?.expandedHeight || 620
    };
  }
  return {
    width: windowMetrics.compactWidth,
    height: windowMetrics.compactHeight
  };
}

function resolveWindowAspectRatio(windowMetrics = {}) {
  const baseWidth = Math.max(1, Number(windowMetrics?.expandedWidth) || 460);
  const baseHeight = Math.max(1, Number(windowMetrics?.expandedHeight) || 620);
  return baseWidth / baseHeight;
}

function resolveAspectLockedWindowSize({
  width,
  height,
  windowMetrics = {}
} = {}) {
  const baseWidth = Math.max(1, Number(windowMetrics?.expandedWidth) || 460);
  const baseHeight = Math.max(1, Number(windowMetrics?.expandedHeight) || 620);
  const minWidth = Math.max(1, Number(windowMetrics?.minWidth) || 120);
  const minHeight = Math.max(1, Number(windowMetrics?.minHeight) || 160);
  const maxWidth = Math.max(minWidth, Number(windowMetrics?.maxWidth) || Number.POSITIVE_INFINITY);
  const maxHeight = Math.max(minHeight, Number(windowMetrics?.maxHeight) || Number.POSITIVE_INFINITY);

  const scaleFromWidth = Number(width) / baseWidth;
  const scaleFromHeight = Number(height) / baseHeight;
  const requestedScale = Number.isFinite(scaleFromWidth) && scaleFromWidth > 0
    ? scaleFromWidth
    : (Number.isFinite(scaleFromHeight) && scaleFromHeight > 0 ? scaleFromHeight : 1);
  const minScale = Math.max(minWidth / baseWidth, minHeight / baseHeight);
  const maxScale = Math.min(maxWidth / baseWidth, maxHeight / baseHeight);
  const safeScale = clamp(requestedScale, minScale, maxScale);

  return {
    width: Math.max(minWidth, Math.round(baseWidth * safeScale)),
    height: Math.max(minHeight, Math.round(baseHeight * safeScale)),
    scale: safeScale,
    aspectRatio: baseWidth / baseHeight
  };
}

function resolveDisplayForBounds({ screen, bounds, fallbackDisplay = null } = {}) {
  if (screen?.getDisplayMatching && bounds) {
    try {
      const matched = screen.getDisplayMatching(bounds);
      if (matched?.workArea) {
        return matched;
      }
    } catch {
      // ignore electron screen lookup failures in tests/bootstrap
    }
  }
  if (screen?.getPrimaryDisplay) {
    const primary = screen.getPrimaryDisplay();
    if (primary?.workArea) {
      return primary;
    }
  }
  return fallbackDisplay?.workArea ? fallbackDisplay : null;
}

function clampWindowBoundsToWorkArea({
  bounds,
  display,
  minWidth = 120,
  minHeight = 160,
  maxWidth = Number.POSITIVE_INFINITY,
  maxHeight = Number.POSITIVE_INFINITY,
  margin = 8,
  maxOffscreenRatio = 0,
  aspectRatio = null
} = {}) {
  if (!bounds) {
    return null;
  }

  const workArea = display?.workArea;
  const rawWidth = Math.max(1, Math.round(Number(bounds.width) || minWidth));
  const rawHeight = Math.max(1, Math.round(Number(bounds.height) || minHeight));
  const safeMinWidth = Math.max(1, Math.round(Number(minWidth) || 1));
  const safeMinHeight = Math.max(1, Math.round(Number(minHeight) || 1));
  const safeMaxWidth = Math.max(safeMinWidth, Math.round(Number.isFinite(maxWidth) ? maxWidth : rawWidth));
  const safeMaxHeight = Math.max(safeMinHeight, Math.round(Number.isFinite(maxHeight) ? maxHeight : rawHeight));
  const safeAspectRatio = Number.isFinite(Number(aspectRatio)) && Number(aspectRatio) > 0
    ? Number(aspectRatio)
    : null;

  if (!workArea || typeof workArea !== 'object') {
    if (safeAspectRatio) {
      const minScale = Math.max(safeMinWidth / rawWidth, safeMinHeight / rawHeight);
      const maxScale = Math.min(safeMaxWidth / rawWidth, safeMaxHeight / rawHeight);
      const safeScale = clamp(1, minScale, maxScale);
      return {
        x: Math.round(Number(bounds.x) || 0),
        y: Math.round(Number(bounds.y) || 0),
        width: Math.max(1, Math.round(rawWidth * safeScale)),
        height: Math.max(1, Math.round(rawHeight * safeScale))
      };
    }
    return {
      x: Math.round(Number(bounds.x) || 0),
      y: Math.round(Number(bounds.y) || 0),
      width: clamp(rawWidth, safeMinWidth, safeMaxWidth),
      height: clamp(rawHeight, safeMinHeight, safeMaxHeight)
    };
  }

  const safeMaxOffscreenRatio = clamp(Number(maxOffscreenRatio) || 0, 0, 0.95);
  const minVisibleRatio = Math.max(0.05, 1 - safeMaxOffscreenRatio);
  const maxVisibleWidth = Math.max(1, Math.round(workArea.width - margin * 2));
  const maxVisibleHeight = Math.max(1, Math.round(workArea.height - margin * 2));
  const maxAllowedWidth = Math.max(1, Math.round(maxVisibleWidth / minVisibleRatio));
  const maxAllowedHeight = Math.max(1, Math.round(maxVisibleHeight / minVisibleRatio));
  const effectiveMinWidth = Math.min(safeMinWidth, maxVisibleWidth);
  const effectiveMinHeight = Math.min(safeMinHeight, maxVisibleHeight);
  let width;
  let height;
  if (safeAspectRatio) {
    const maxWidthByViewport = Math.min(safeMaxWidth, maxAllowedWidth);
    const maxHeightByViewport = Math.min(safeMaxHeight, maxAllowedHeight);
    const minScale = Math.max(effectiveMinWidth / rawWidth, effectiveMinHeight / rawHeight);
    const maxScale = Math.min(maxWidthByViewport / rawWidth, maxHeightByViewport / rawHeight);
    const safeScale = clamp(1, minScale, maxScale);
    width = Math.max(1, Math.round(rawWidth * safeScale));
    height = Math.max(1, Math.round(rawHeight * safeScale));
  } else {
    width = clamp(rawWidth, effectiveMinWidth, Math.min(safeMaxWidth, maxAllowedWidth));
    height = clamp(rawHeight, effectiveMinHeight, Math.min(safeMaxHeight, maxAllowedHeight));
  }

  const minVisibleWidth = Math.min(maxVisibleWidth, Math.max(1, Math.round(width * minVisibleRatio)));
  const minVisibleHeight = Math.min(maxVisibleHeight, Math.max(1, Math.round(height * minVisibleRatio)));

  const minX = Math.round(workArea.x + margin - width + minVisibleWidth);
  const minY = Math.round(workArea.y + margin - height + minVisibleHeight);
  const maxX = Math.round(workArea.x + workArea.width - margin - minVisibleWidth);
  const maxY = Math.round(workArea.y + workArea.height - margin - minVisibleHeight);

  return {
    x: clamp(Math.round(Number(bounds.x) || minX), minX, maxX),
    y: clamp(Math.round(Number(bounds.y) || minY), minY, maxY),
    width,
    height
  };
}

function resizeWindowKeepingBottomRight({
  window,
  width,
  height,
  screen = null,
  display = null,
  minWidth = 120,
  minHeight = 160,
  maxWidth = Number.POSITIVE_INFINITY,
  maxHeight = Number.POSITIVE_INFINITY,
  margin = 8,
  maxOffscreenRatio = 0,
  aspectRatio = null
}) {
  if (!window || typeof window.getBounds !== 'function' || typeof window.setBounds !== 'function') {
    return;
  }

  const bounds = window.getBounds();
  if (bounds.width === width && bounds.height === height) {
    return;
  }

  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  const nextBounds = clampWindowBoundsToWorkArea({
    bounds: {
      x: Math.round(right - width),
      y: Math.round(bottom - height),
      width,
      height
    },
    display: resolveDisplayForBounds({
      screen,
      bounds: {
        x: Math.round(right - width),
        y: Math.round(bottom - height),
        width,
        height
      },
      fallbackDisplay: display
    }),
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    margin,
    maxOffscreenRatio,
    aspectRatio
  });

  window.setBounds(nextBounds, false);
}

function normalizeWindowControlPayload(payload) {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['hide', 'hide_chat', 'close_pet', 'open_webui', 'close_resize_mode', 'save_layout_overrides'].includes(action)) {
    return null;
  }
  const normalized = { action };
  if (action === 'save_layout_overrides') {
    const layout = payload?.layout;
    if (!layout || typeof layout !== 'object') {
      return null;
    }
    const offsetX = Number(layout.offsetX);
    const offsetY = Number(layout.offsetY);
    const scaleMultiplier = Number(layout.scaleMultiplier);
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(scaleMultiplier)) {
      return null;
    }
    normalized.layout = {
      offsetX: Math.round(offsetX),
      offsetY: Math.round(offsetY),
      scaleMultiplier: Math.round(scaleMultiplier * 1000) / 1000
    };
  }
  return normalized;
}

function createWindowControlListener({
  window,
  windows = null,
  onHide = null,
  onHideChat = null,
  onClosePet = null,
  onOpenWebUi = null,
  onCloseResizeMode = null,
  onSaveLayoutOverrides = null
} = {}) {
  const allowedWindows = Array.isArray(windows) && windows.length > 0
    ? windows
    : (window ? [window] : []);

  return (event, payload) => {
    const sender = event?.sender;
    if (!sender || allowedWindows.length === 0) {
      return;
    }

    const matched = allowedWindows.find((candidate) => (
      candidate
      && !candidate.isDestroyed?.()
      && candidate.webContents === sender
    ));
    if (!matched) {
      return;
    }

    const normalized = normalizeWindowControlPayload(payload);
    if (!normalized) {
      return;
    }

    if (normalized.action === 'hide') {
      if (typeof onHide === 'function') {
        onHide();
      }
      return;
    }

    if (normalized.action === 'hide_chat') {
      if (typeof onHideChat === 'function') {
        onHideChat();
      }
      return;
    }

    if (normalized.action === 'close_pet' && typeof onClosePet === 'function') {
      onClosePet();
      return;
    }

    if (normalized.action === 'open_webui' && typeof onOpenWebUi === 'function') {
      onOpenWebUi();
      return;
    }

    if (normalized.action === 'close_resize_mode' && typeof onCloseResizeMode === 'function') {
      onCloseResizeMode();
      return;
    }

    if (normalized.action === 'save_layout_overrides' && typeof onSaveLayoutOverrides === 'function') {
      onSaveLayoutOverrides(normalized.layout);
    }
  };
}

function normalizeChatPanelVisibilityPayload(payload) {
  if (typeof payload?.visible !== 'boolean') {
    return null;
  }
  return {
    visible: payload.visible
  };
}

function normalizeChatPanelTogglePayload(payload) {
  return {
    source: String(payload?.source || 'avatar-window')
  };
}

function normalizeWindowResizePayload(payload) {
  const action = String(payload?.action || 'set').trim().toLowerCase();
  if (!['set', 'grow', 'shrink', 'reset'].includes(action)) {
    return null;
  }

  const normalized = {
    action,
    source: String(payload?.source || 'avatar-window')
  };
  if (payload?.persist !== undefined) {
    normalized.persist = Boolean(payload.persist);
  }

  if (action === 'set') {
    const width = Number(payload?.width);
    const height = Number(payload?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    normalized.width = Math.round(width);
    normalized.height = Math.round(height);
    return normalized;
  }

  const step = Number(payload?.step);
  if (Number.isFinite(step) && step > 0) {
    normalized.step = Math.round(step);
  }
  return normalized;
}

function createChatPanelToggleListener({ window, onToggle = null } = {}) {
  return (event, payload) => {
    if (!window || window.isDestroyed() || event?.sender !== window.webContents) {
      return;
    }
    normalizeChatPanelTogglePayload(payload);
    if (typeof onToggle === 'function') {
      onToggle();
    }
  };
}

function normalizeModelBoundsPayload(payload) {
  const x = Number(payload?.x);
  const y = Number(payload?.y);
  const width = Number(payload?.width);
  const height = Number(payload?.height);
  const stageWidth = Number(payload?.stageWidth);
  const stageHeight = Number(payload?.stageHeight);
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(stageWidth)
    || !Number.isFinite(stageHeight)
    || width <= 0
    || height <= 0
    || stageWidth <= 0
    || stageHeight <= 0
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    stageWidth: Math.round(stageWidth),
    stageHeight: Math.round(stageHeight)
  };
}

function createModelBoundsListener({ window, onModelBounds = null } = {}) {
  return (event, payload) => {
    if (!window || window.isDestroyed() || event?.sender !== window.webContents) {
      return;
    }
    const normalized = normalizeModelBoundsPayload(payload);
    if (!normalized) {
      return;
    }
    if (typeof onModelBounds === 'function') {
      onModelBounds(normalized);
    }
  };
}

function normalizeBubbleMetricsPayload(payload) {
  const width = Number(payload?.width);
  const height = Number(payload?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width: Math.round(width),
    height: Math.round(height)
  };
}

function createBubbleMetricsListener({ window, onBubbleMetrics = null } = {}) {
  return (event, payload) => {
    if (!window || window.isDestroyed() || event?.sender !== window.webContents) {
      return;
    }
    const normalized = normalizeBubbleMetricsPayload(payload);
    if (!normalized) {
      return;
    }
    if (typeof onBubbleMetrics === 'function') {
      onBubbleMetrics(normalized);
    }
  };
}

function normalizeActionTelemetryPayload(payload) {
  const event = String(payload?.event || '').trim().toLowerCase();
  if (!['enqueue', 'drop', 'start', 'done', 'fail', 'ack'].includes(event)) {
    return null;
  }
  const actionId = String(payload?.action_id || payload?.actionId || '').trim();
  const actionType = String(payload?.action_type || payload?.actionType || '').trim();
  const queueSize = Number(payload?.queue_size);
  const timestamp = Number(payload?.timestamp);
  const normalized = {
    event,
    action_id: actionId,
    action_type: actionType || null,
    queue_size: Number.isFinite(queueSize) ? Math.max(0, Math.floor(queueSize)) : null,
    timestamp: Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : Date.now()
  };
  if (payload?.reason != null) {
    normalized.reason = String(payload.reason);
  }
  if (payload?.error != null) {
    normalized.error = String(payload.error);
  }
  if (payload?.dropped != null && Number.isFinite(Number(payload.dropped))) {
    normalized.dropped = Math.max(0, Math.floor(Number(payload.dropped)));
  }
  return normalized;
}

function createActionTelemetryListener({ window, onTelemetry = null } = {}) {
  return (event, payload) => {
    if (!window || window.isDestroyed() || event?.sender !== window.webContents) {
      return;
    }
    const normalized = normalizeActionTelemetryPayload(payload);
    if (!normalized) {
      return;
    }
    onTelemetry?.(normalized);
  };
}

function createChatPanelVisibilityListener({ window, windowMetrics, screen, display, margin = 8 } = {}) {
  let lastVisible = null;
  return (event, payload) => {
    if (!window || window.isDestroyed() || event?.sender !== window.webContents) {
      return;
    }

    const normalized = normalizeChatPanelVisibilityPayload(payload);
    if (!normalized || normalized.visible === lastVisible) {
      return;
    }
    lastVisible = normalized.visible;

    const nextSize = resolveWindowSizeForChatPanel({
      windowMetrics,
      chatPanelVisible: normalized.visible
    });
    resizeWindowKeepingBottomRight({
      window,
      width: nextSize.width,
      height: nextSize.height,
      screen,
      display,
      minWidth: windowMetrics?.minWidth,
      minHeight: windowMetrics?.minHeight,
      maxWidth: windowMetrics?.maxWidth,
      maxHeight: windowMetrics?.maxHeight,
      margin
    });
  };
}

function buildWindowStatePayload({ window, windowMetrics } = {}) {
  if (!window || typeof window.getBounds !== 'function') {
    return null;
  }

  const bounds = window.getBounds();
  return {
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    minWidth: Math.round(windowMetrics?.minWidth || 0),
    minHeight: Math.round(windowMetrics?.minHeight || 0),
    maxWidth: Math.round(windowMetrics?.maxWidth || 0),
    maxHeight: Math.round(windowMetrics?.maxHeight || 0),
    defaultWidth: Math.round(windowMetrics?.expandedWidth || bounds.width),
    defaultHeight: Math.round(windowMetrics?.expandedHeight || bounds.height),
    aspectRatio: resolveWindowAspectRatio(windowMetrics),
    resizeModeEnabled: false
  };
}

function createWindowResizeListener({
  window,
  windowMetrics,
  screen,
  display,
  margin = 8,
  maxOffscreenRatio = 0,
  onStateChange = null,
  onResizeCommitted = null
} = {}) {
  return (event, payload) => {
    if (!window || window.isDestroyed?.() || event?.sender !== window.webContents) {
      return;
    }

    const normalized = normalizeWindowResizePayload(payload);
    if (!normalized) {
      return;
    }

    const bounds = window.getBounds();
    const resizeStep = Math.max(20, Number(normalized.step) || 48);
    let nextWidth = bounds.width;
    let nextHeight = bounds.height;

    if (normalized.action === 'reset') {
      nextWidth = Number(windowMetrics?.expandedWidth) || bounds.width;
      nextHeight = Number(windowMetrics?.expandedHeight) || bounds.height;
    } else if (normalized.action === 'grow') {
      nextWidth += resizeStep;
    } else if (normalized.action === 'shrink') {
      nextWidth -= resizeStep;
    } else {
      nextWidth = normalized.width;
      nextHeight = normalized.height;
    }

    const lockedSize = resolveAspectLockedWindowSize({
      width: nextWidth,
      height: nextHeight,
      windowMetrics
    });

    resizeWindowKeepingBottomRight({
      window,
      width: lockedSize.width,
      height: lockedSize.height,
      screen,
      display,
      minWidth: Number(windowMetrics?.minWidth) || 120,
      minHeight: Number(windowMetrics?.minHeight) || 160,
      maxWidth: Number(windowMetrics?.maxWidth) || Number.POSITIVE_INFINITY,
      maxHeight: Number(windowMetrics?.maxHeight) || Number.POSITIVE_INFINITY,
      margin,
      maxOffscreenRatio,
      aspectRatio: resolveWindowAspectRatio(windowMetrics)
    });
    const nextState = buildWindowStatePayload({ window, windowMetrics });
    onStateChange?.(nextState);
    if (normalized.persist !== false) {
      onResizeCommitted?.(nextState);
    }
  };
}

function normalizePersistedWindowState(value, { windowMetrics } = {}) {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const lockedSize = resolveAspectLockedWindowSize({
    width,
    height,
    windowMetrics
  });

  return {
    width: lockedSize.width,
    height: lockedSize.height
  };
}

function loadPersistedWindowState(windowStatePath, { windowMetrics, logger = console } = {}) {
  if (!windowStatePath || !fs.existsSync(windowStatePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
    return normalizePersistedWindowState(raw, { windowMetrics });
  } catch (err) {
    logger.warn?.('[desktop-live2d] failed to load window state', {
      windowStatePath,
      error: err?.message || String(err || 'unknown error')
    });
    return null;
  }
}

function writePersistedWindowState(windowStatePath, payload, { logger = console } = {}) {
  if (!windowStatePath || !payload) {
    return;
  }

  const normalized = normalizePersistedWindowState(payload);
  if (!normalized) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(windowStatePath), { recursive: true });
    fs.writeFileSync(windowStatePath, JSON.stringify({
      width: normalized.width,
      height: normalized.height,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (err) {
    logger.warn?.('[desktop-live2d] failed to persist window state', {
      windowStatePath,
      error: err?.message || String(err || 'unknown error')
    });
  }
}

async function forwardLive2dActionEvent({
  eventName,
  eventPayload,
  bridge,
  rendererTimeoutMs,
  onTelemetry = null,
  logger = console
} = {}) {
  if (eventName !== ACTION_EVENT_NAME) {
    return {
      forwarded: false,
      reason: 'event_name_mismatch'
    };
  }

  const normalized = normalizeLive2dActionMessage(eventPayload);
  if (!normalized.ok) {
    logger.warn?.('[desktop-live2d] live2d action event dropped', {
      eventName,
      error: normalized.error
    });
    return {
      forwarded: false,
      reason: 'invalid_payload',
      error: normalized.error
    };
  }

  if (!bridge || typeof bridge.invoke !== 'function') {
    return {
      forwarded: false,
      reason: 'bridge_unavailable'
    };
  }

  try {
    const result = await bridge.invoke({
      method: ACTION_ENQUEUE_METHOD,
      params: normalized.value,
      timeoutMs: rendererTimeoutMs
    });
    onTelemetry?.({
      event: 'ack',
      action_id: normalized.value.action_id,
      action_type: normalized.value.action?.type || null,
      queue_size: Number.isFinite(Number(result?.queue_size)) ? Number(result.queue_size) : null,
      timestamp: Date.now()
    });
    return {
      forwarded: true,
      result,
      payload: normalized.value
    };
  } catch (err) {
    const message = err?.message || String(err || 'unknown error');
    logger.error?.('[desktop-live2d] live2d action forward failed', {
      eventName,
      error: message
    });
    return {
      forwarded: false,
      reason: 'bridge_invoke_failed',
      error: message
    };
  }
}

async function processVoiceRequestedOnDesktop({
  eventPayload,
  ttsClient,
  avatarWindow,
  rpcServerRef,
  logger = console
} = {}) {
  const requestId = String(eventPayload?.request_id || `${Date.now()}-voice`);
  const text = String(eventPayload?.text || '').trim();
  if (!text) return;

  const timeoutSec = Math.max(1, Number(eventPayload?.timeoutSec || 45));
  const model = String(eventPayload?.model || '');
  const voice = String(eventPayload?.voiceId || '');

  rpcServerRef?.notify({
    method: 'desktop.event',
    params: {
      type: 'voice.synthesis.started',
      timestamp: Date.now(),
      data: { request_id: requestId }
    }
  });

  try {
    const synthesis = await ttsClient.synthesizeNonStreaming({
      text,
      model,
      voice,
      timeoutMs: timeoutSec * 1000
    });

    const audioBuffer = await ttsClient.fetchAudioBuffer({
      audioUrl: synthesis.audioUrl,
      timeoutMs: timeoutSec * 1000
    });

    const audioBase64 = audioBuffer.toString('base64');

    rpcServerRef?.notify({
      method: 'desktop.event',
      params: {
        type: 'voice.synthesis.completed',
        timestamp: Date.now(),
        data: {
          request_id: requestId,
          bytes: audioBuffer.length,
          mime_type: synthesis.mimeType,
          model: synthesis.model
        }
      }
    });

    if (!avatarWindow.isDestroyed()) {
      avatarWindow.webContents.send('desktop:voice:play-memory', {
        requestId,
        audioBase64,
        mimeType: synthesis.mimeType || 'audio/ogg'
      });
      rpcServerRef?.notify({
        method: 'desktop.event',
        params: {
          type: 'voice.playback.started',
          timestamp: Date.now(),
          data: { request_id: requestId }
        }
      });
    }
  } catch (err) {
    logger.error?.('[desktop-live2d] voice requested process failed', {
      requestId,
      code: err?.code,
      error: err?.message || String(err)
    });

    rpcServerRef?.notify({
      method: 'desktop.event',
      params: {
        type: 'voice.synthesis.failed',
        timestamp: Date.now(),
        data: {
          request_id: requestId,
          code: String(err?.code || 'TTS_PROVIDER_DOWN'),
          error: String(err?.message || 'unknown tts error')
        }
      }
    });
  }
}

async function startDesktopSuite({
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell = null,
  onResizeModeChange = null,
  logger = console,
  onChatInput = null
} = {}) {
  if (!app || !BrowserWindow || !ipcMain) {
    throw new Error('startDesktopSuite requires app, BrowserWindow, and ipcMain');
  }

  const config = resolveDesktopLive2dConfig();
  const modelValidation = validateModelAssetDirectory({
    modelDir: config.modelDir,
    modelJsonName: config.modelJsonName
  });
  const live2dPresetConfig = loadLive2dPresetConfig({
    projectRoot: config.projectRoot,
    env: process.env,
    logger
  });
  const display = screen?.getPrimaryDisplay?.();

  logger.info?.('[desktop-live2d] desktop_up_start', {
    modelDir: config.modelDir,
    rpcPort: config.rpcPort,
    gatewayExternal: config.gatewayExternal
  });

  const gatewaySupervisor = new GatewaySupervisor({
    projectRoot: config.projectRoot,
    gatewayUrl: config.gatewayUrl,
    gatewayHost: config.gatewayHost,
    gatewayPort: config.gatewayPort,
    external: config.gatewayExternal
  });

  await gatewaySupervisor.start();

  let rpcServerRef = null;
  let ipcBridgeRef = null;
  const windowMetrics = resolveWindowMetrics(config.uiConfig);
  const persistedWindowState = loadPersistedWindowState(config.windowStatePath, {
    windowMetrics,
    logger
  });
  let manualWindowSizeActive = Boolean(persistedWindowState);
  let initialManualFitPending = Boolean(persistedWindowState);
  let resizeModeEnabled = false;
  const avatarWindow = createMainWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    display,
    uiConfig: config.uiConfig,
    windowMetrics,
    initialSizeOverride: persistedWindowState
  });
  const avatarWindowBounds = avatarWindow.getBounds();

  const chatWindow = createChatWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    uiConfig: config.uiConfig,
    avatarBounds: avatarWindowBounds,
    display
  });
  const bubbleWindow = createBubbleWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    avatarBounds: avatarWindowBounds,
    display
  });
  await chatWindow.loadFile(path.join(config.projectRoot, 'apps', 'desktop-live2d', 'renderer', 'chat.html'));
  await bubbleWindow.loadFile(path.join(config.projectRoot, 'apps', 'desktop-live2d', 'renderer', 'bubble.html'));

  const chatPanelConfig = config.uiConfig?.chat?.panel || {};
  const chatState = {
    enabled: Boolean(chatPanelConfig.enabled),
    visible: Boolean(chatPanelConfig.enabled && chatPanelConfig.defaultVisible),
    maxMessages: toPositiveInt(chatPanelConfig.maxMessages, 200),
    inputEnabled: chatPanelConfig.inputEnabled !== false,
    messages: []
  };
  const bubbleState = {
    visible: false,
    text: '',
    width: 320,
    height: 160
  };
  let bubbleHideTimer = null;
  const fitWindowConfig = {
    enabled: true,
    minWidth: windowMetrics.minWidth,
    minHeight: windowMetrics.minHeight,
    maxWidth: windowMetrics.maxWidth,
    maxHeight: windowMetrics.maxHeight,
    paddingX: 18,
    paddingTop: 8,
    paddingBottom: 4
  };

  function buildChatStateSnapshot() {
    return {
      enabled: chatState.enabled,
      visible: chatState.visible,
      inputEnabled: chatState.inputEnabled,
      maxMessages: chatState.maxMessages,
      messages: chatState.messages
    };
  }

  function syncChatStateToRenderer() {
    if (chatWindow.isDestroyed()) {
      return;
    }
    chatWindow.webContents.send(CHANNELS.chatStateSync, buildChatStateSnapshot());
  }

  function syncBubbleStateToRenderer() {
    if (bubbleWindow.isDestroyed()) {
      return;
    }
    bubbleWindow.webContents.send(CHANNELS.bubbleStateSync, {
      visible: bubbleState.visible,
      text: bubbleState.text
    });
  }

  function syncWindowStateToRenderer() {
    const payload = buildWindowStatePayload({ window: avatarWindow, windowMetrics });
    if (!payload) {
      return;
    }
    payload.resizeModeEnabled = resizeModeEnabled;
    if (!avatarWindow.isDestroyed()) {
      avatarWindow.webContents.send(CHANNELS.windowStateSync, payload);
    }
    if (!chatWindow.isDestroyed()) {
      chatWindow.webContents.send(CHANNELS.windowStateSync, payload);
    }
  }

  function persistAvatarWindowState(payload) {
    manualWindowSizeActive = true;
    writePersistedWindowState(config.windowStatePath, payload, { logger });
  }

  function setResizeModeEnabled(enabled) {
    resizeModeEnabled = Boolean(enabled);
    onResizeModeChange?.(resizeModeEnabled);
    syncWindowStateToRenderer();
    return resizeModeEnabled;
  }

  function isResizeModeEnabled() {
    return resizeModeEnabled;
  }

  function resolveAvatarDisplay(bounds = null) {
    const targetBounds = bounds || (avatarWindow.isDestroyed() ? null : avatarWindow.getBounds());
    return resolveDisplayForBounds({
      screen,
      bounds: targetBounds,
      fallbackDisplay: display
    }) || display;
  }

  function setWindowBoundsIfChanged(windowRef, nextBounds) {
    if (!windowRef || windowRef.isDestroyed?.() || !nextBounds) {
      return;
    }
    const current = windowRef.getBounds();
    if (
      current.x === nextBounds.x
      && current.y === nextBounds.y
      && current.width === nextBounds.width
      && current.height === nextBounds.height
    ) {
      return;
    }
    windowRef.setBounds(nextBounds, false);
  }

  function applyAvatarFitBounds(modelBounds) {
    if (!fitWindowConfig.enabled || resizeModeEnabled || avatarWindow.isDestroyed()) {
      return;
    }
    const allowInitialShrinkFit = initialManualFitPending && manualWindowSizeActive;
    if (manualWindowSizeActive && !allowInitialShrinkFit) {
      return;
    }

    const current = avatarWindow.getBounds();
    const activeDisplay = resolveAvatarDisplay(avatarWindow.getBounds());
    const nextBounds = computeFittedAvatarWindowBounds({
      windowBounds: current,
      modelBounds,
      display: activeDisplay,
      minWidth: fitWindowConfig.minWidth,
      minHeight: fitWindowConfig.minHeight,
      maxWidth: fitWindowConfig.maxWidth,
      maxHeight: fitWindowConfig.maxHeight,
      paddingX: fitWindowConfig.paddingX,
      paddingTop: fitWindowConfig.paddingTop,
      paddingBottom: fitWindowConfig.paddingBottom,
      anchor: 'model'
    });
    if (!nextBounds) {
      if (allowInitialShrinkFit) {
        initialManualFitPending = false;
      }
      return;
    }
    if (allowInitialShrinkFit) {
      initialManualFitPending = false;
      const shrinkOnly = nextBounds.width <= current.width && nextBounds.height <= current.height;
      if (!shrinkOnly) {
        return;
      }
    }

    const unchanged = Math.abs(current.x - nextBounds.x) < 2
      && Math.abs(current.y - nextBounds.y) < 2
      && Math.abs(current.width - nextBounds.width) < 3
      && Math.abs(current.height - nextBounds.height) < 3;
    if (unchanged) {
      return;
    }
    avatarWindow.setBounds(nextBounds, false);
    if (allowInitialShrinkFit) {
      writePersistedWindowState(config.windowStatePath, nextBounds, { logger });
    }
  }

  function updateBubbleWindowBounds() {
    if (!bubbleState.visible || bubbleWindow.isDestroyed()) {
      return;
    }
    const activeDisplay = resolveAvatarDisplay(avatarWindow.getBounds());
    const workArea = activeDisplay?.workArea;
    const maxBubbleWidth = Math.max(120, (Number(workArea?.width) || 520) - 32);
    const maxBubbleHeight = Math.max(44, (Number(workArea?.height) || 1000) - 32);
    const bubbleWidth = clamp(Number(bubbleState.width) || 320, 120, maxBubbleWidth);
    const bubbleHeight = clamp(Number(bubbleState.height) || 160, 44, maxBubbleHeight);
    const bubbleBounds = computeBubbleWindowBounds({
      avatarBounds: avatarWindow.getBounds(),
      bubbleWidth,
      bubbleHeight,
      display: activeDisplay
    });
    setWindowBoundsIfChanged(bubbleWindow, bubbleBounds);
  }

  function appendChatMessage(params, fallbackRole = 'assistant') {
    const text = String(params?.text || '').trim();
    if (!text) {
      return { ok: false, count: chatState.messages.length };
    }
    const role = String(params?.role || fallbackRole || 'assistant');
    const message = {
      role,
      text,
      timestamp: Number.isFinite(Number(params?.timestamp)) ? Number(params.timestamp) : Date.now()
    };
    chatState.messages = chatState.messages.concat(message);
    if (chatState.messages.length > chatState.maxMessages) {
      chatState.messages = chatState.messages.slice(chatState.messages.length - chatState.maxMessages);
    }
    syncChatStateToRenderer();
    return { ok: true, count: chatState.messages.length };
  }

  function clearChatMessages() {
    chatState.messages = [];
    syncChatStateToRenderer();
    return { ok: true, count: 0 };
  }

  function setChatPanelVisible(visible) {
    if (!chatState.enabled) {
      return { ok: false, visible: false };
    }
    chatState.visible = Boolean(visible);
    syncChatStateToRenderer();
    if (chatState.visible) {
      chatWindow.show();
      chatWindow.focus();
    } else {
      chatWindow.hide();
    }
    return { ok: true, visible: chatState.visible };
  }

  function toggleChatPanelVisible() {
    return setChatPanelVisible(!chatState.visible);
  }

  function hideBubbleWindow() {
    if (bubbleHideTimer) {
      clearTimeout(bubbleHideTimer);
      bubbleHideTimer = null;
    }
    bubbleState.visible = false;
    bubbleState.text = '';
    bubbleState.streaming = false;
    syncBubbleStateToRenderer();
    if (!bubbleWindow.isDestroyed()) {
      bubbleWindow.hide();
    }
  }

  // Streaming state for bubble
  let streamingState = {
    active: false,
    sessionId: null,
    traceId: null,
    accumulatedText: '',
    lastUpdateTime: 0
  };
  let bubbleStreamingThrottle = null;

  function updateBubbleStreaming(delta) {
    const currentSessionId = streamingState.sessionId;
    const currentTraceId = streamingState.traceId;

    if (!streamingState.active) {
      streamingState.active = true;
      streamingState.accumulatedText = '';
      emitDesktopDebug('chain.electron.bubble.streaming_started', 'bubble streaming started', {
        session_id: currentSessionId,
        trace_id: currentTraceId
      });
    }

    streamingState.accumulatedText += delta;
    streamingState.lastUpdateTime = Date.now();

    // Throttle updates to avoid excessive IPC
    if (bubbleStreamingThrottle) {
      clearTimeout(bubbleStreamingThrottle);
    }

    bubbleStreamingThrottle = setTimeout(() => {
      bubbleStreamingThrottle = null;
      showBubble({
        text: streamingState.accumulatedText,
        durationMs: 30000, // Keep visible during streaming
        streaming: true
      });
      emitDesktopDebug('chain.electron.bubble.streaming_update', 'bubble streaming update', {
        session_id: currentSessionId,
        trace_id: currentTraceId,
        accumulated_chars: streamingState.accumulatedText.length
      });
    }, 50); // 50ms throttle
  }

  function finishBubbleStreaming(finalText) {
    if (bubbleStreamingThrottle) {
      clearTimeout(bubbleStreamingThrottle);
      bubbleStreamingThrottle = null;
    }

    const currentSessionId = streamingState.sessionId;
    const currentTraceId = streamingState.traceId;

    streamingState.active = false;
    const accumulatedChars = streamingState.accumulatedText.length;
    streamingState.accumulatedText = '';

    showBubble({
      text: finalText,
      durationMs: 5000,
      streaming: false
    });

    emitDesktopDebug('chain.electron.bubble.streaming_finished', 'bubble streaming finished', {
      session_id: currentSessionId,
      trace_id: currentTraceId,
      accumulated_chars: accumulatedChars,
      final_chars: finalText.length
    });
  }

  function showBubble(params) {
    const text = String(params?.text || '').trim();
    if (!text) {
      return { ok: false };
    }
    const durationMs = Number.isFinite(Number(params?.durationMs))
      ? Math.max(500, Math.min(30000, Number(params.durationMs)))
      : 5000;
    const streaming = Boolean(params?.streaming);

    bubbleState.visible = true;
    bubbleState.text = text;
    bubbleState.streaming = streaming;
    const roughLines = Math.max(
      1,
      text.split('\n').length + Math.floor(text.length / 20)
    );
    const workArea = resolveAvatarDisplay(avatarWindow.getBounds())?.workArea;
    const maxBubbleHeight = Math.max(44, (Number(workArea?.height) || 1000) - 32);
    bubbleState.width = 320;
    bubbleState.height = clamp(44 + roughLines * 24, 60, maxBubbleHeight);
    updateBubbleWindowBounds();
    syncBubbleStateToRenderer();
    bubbleWindow.showInactive();

    if (bubbleHideTimer) {
      clearTimeout(bubbleHideTimer);
    }

    // Don't auto-hide during streaming
    if (!streaming) {
      bubbleHideTimer = setTimeout(() => {
        hideBubbleWindow();
      }, durationMs);
    }

    return { ok: true, expiresAt: Date.now() + durationMs, streaming };
  }

  function hidePetWindows() {
    if (!avatarWindow.isDestroyed()) {
      avatarWindow.hide();
    }
    hideBubbleWindow();
  }

  function showPetWindows() {
    if (avatarWindow.isDestroyed()) {
      return;
    }
    avatarWindow.show();
    avatarWindow.focus();
    updateBubbleWindowBounds();
  }

  function hideChatWindow() {
    chatState.visible = false;
    syncChatStateToRenderer();
    if (!chatWindow.isDestroyed()) {
      chatWindow.hide();
    }
  }

  function openWebUi() {
    const gatewayUrl = String(config.gatewayUrl || '').trim();
    if (!gatewayUrl || typeof shell?.openExternal !== 'function') {
      return;
    }
    void shell.openExternal(gatewayUrl).catch((err) => {
      logger.warn?.('[desktop-live2d] failed to open web ui', {
        gatewayUrl,
        error: err?.message || String(err || 'unknown error')
      });
    });
  }

  function publishLive2dActionTelemetry(payload = {}) {
    const normalized = normalizeActionTelemetryPayload(payload);
    if (!normalized) {
      return;
    }
    logger.info?.('[desktop-live2d] live2d action telemetry', normalized);
    rpcServerRef?.notify({
      method: 'desktop.event',
      params: {
        type: 'live2d.action.telemetry',
        timestamp: Date.now(),
        data: normalized
      }
    });
  }

  avatarWindow.on('move', () => {
    updateBubbleWindowBounds();
    syncWindowStateToRenderer();
  });
  avatarWindow.on('resize', () => {
    updateBubbleWindowBounds();
    syncWindowStateToRenderer();
  });
  avatarWindow.on('hide', () => {
    hideBubbleWindow();
  });

  const avatarUiConfig = {
    ...config.uiConfig,
    chat: {
      ...(config.uiConfig?.chat || {}),
      panel: {
        ...(config.uiConfig?.chat?.panel || {}),
        enabled: false
      }
    }
  };
  function persistLayoutOverrides(layoutOverrides) {
    const nextRaw = upsertDesktopLive2dLayoutOverrides(config.uiConfigPath, layoutOverrides, {
      defaults: DEFAULT_UI_CONFIG.layout
    });
    config.uiConfig.layout = {
      ...config.uiConfig.layout,
      ...(nextRaw.layout || {})
    };
    avatarUiConfig.layout = config.uiConfig.layout;
  }

  ipcMain.handle(CHANNELS.getRuntimeConfig, (event) => ({
    modelRelativePath: config.modelRelativePath,
    modelName: modelValidation.modelName,
    gatewayUrl: config.gatewayUrl,
    live2dPresets: live2dPresetConfig,
    uiConfig: event?.sender === avatarWindow.webContents ? avatarUiConfig : config.uiConfig
  }));
  const windowDragListener = createWindowDragListener({
    BrowserWindow,
    screen,
    maxOffscreenRatio: AVATAR_WINDOW_MAX_OFFSCREEN_RATIO
  });
  ipcMain.on(CHANNELS.windowDrag, windowDragListener);
  const chatPanelVisibilityListener = createChatPanelVisibilityListener({
    window: avatarWindow,
    windowMetrics,
    screen,
    display
  });
  ipcMain.on(CHANNELS.chatPanelVisibility, chatPanelVisibilityListener);
  const chatPanelToggleListener = createChatPanelToggleListener({
    window: avatarWindow,
    onToggle: () => {
      toggleChatPanelVisible();
    }
  });
  ipcMain.on(CHANNELS.chatPanelToggle, chatPanelToggleListener);
  const modelBoundsListener = createModelBoundsListener({
    window: avatarWindow,
    onModelBounds: (modelBounds) => {
      applyAvatarFitBounds(modelBounds);
    }
  });
  ipcMain.on(CHANNELS.modelBoundsUpdate, modelBoundsListener);
  const bubbleMetricsListener = createBubbleMetricsListener({
    window: bubbleWindow,
    onBubbleMetrics: (metrics) => {
      const workArea = resolveAvatarDisplay(avatarWindow.getBounds())?.workArea;
      const maxBubbleWidth = Math.max(120, (Number(workArea?.width) || 520) - 32);
      const maxBubbleHeight = Math.max(44, (Number(workArea?.height) || 1000) - 32);
      bubbleState.width = clamp(metrics.width + 20, 120, maxBubbleWidth);
      bubbleState.height = clamp(metrics.height + 24, 44, maxBubbleHeight);
      if (bubbleState.visible) {
        updateBubbleWindowBounds();
      }
    }
  });
  ipcMain.on(CHANNELS.bubbleMetricsUpdate, bubbleMetricsListener);
  const actionTelemetryListener = createActionTelemetryListener({
    window: avatarWindow,
    onTelemetry: publishLive2dActionTelemetry
  });
  ipcMain.on(CHANNELS.actionTelemetry, actionTelemetryListener);

  const windowControlListener = createWindowControlListener({
    windows: [avatarWindow, chatWindow],
    onHide: hidePetWindows,
    onHideChat: hideChatWindow,
    onClosePet: hidePetWindows,
    onOpenWebUi: openWebUi,
    onCloseResizeMode: () => {
      setResizeModeEnabled(false);
    },
    onSaveLayoutOverrides: (layoutOverrides) => {
      persistLayoutOverrides(layoutOverrides);
    }
  });
  ipcMain.on(CHANNELS.windowControl, windowControlListener);
  const windowResizeListener = createWindowResizeListener({
    window: avatarWindow,
    windowMetrics,
    screen,
    display,
    maxOffscreenRatio: AVATAR_WINDOW_MAX_OFFSCREEN_RATIO,
    onStateChange: syncWindowStateToRenderer,
    onResizeCommitted: persistAvatarWindowState
  });
  ipcMain.on(CHANNELS.windowResizeRequest, windowResizeListener);

  const qwenTtsClient = new QwenTtsClient();

  const gatewayRuntimeClient = new GatewayRuntimeClient({
    gatewayUrl: config.gatewayUrl,
    sessionId: 'desktop-live2d-chat',
    logger,
    onNotification: (desktopEvent) => {
      emitDesktopDebug('chain.electron.notification.received', 'electron main received gateway notification', {
        type: desktopEvent?.type || null,
        session_id: desktopEvent?.data?.session_id || null,
        trace_id: desktopEvent?.data?.trace_id || null
      });
      rpcServerRef?.notify({
        method: 'desktop.event',
        params: desktopEvent
      });

      //  2. 【核心改造】：新增这块透明透传网关逻辑！
      if (desktopEvent.type === 'runtime.event' && desktopEvent.data?.name) {
        const eventName = desktopEvent.data.name;
        console.log('[desktop-live2d] gateway_event_forward', { eventName });
        const activeBridge = ipcBridgeRef;

        if (eventName === ACTION_EVENT_NAME) {
          void forwardLive2dActionEvent({
            eventName,
            eventPayload: desktopEvent.data.data,
            bridge: activeBridge,
            rendererTimeoutMs: config.rendererTimeoutMs,
            onTelemetry: publishLive2dActionTelemetry,
            logger
          });
        } else if (eventName === 'voice.requested') {
          void processVoiceRequestedOnDesktop({
            eventPayload: desktopEvent.data.data,
            ttsClient: qwenTtsClient,
            avatarWindow,
            rpcServerRef,
            logger
          });
        } else if (eventName.startsWith('ui.') || eventName.startsWith('client.') || eventName.startsWith('voice.')) {
          activeBridge?.invoke({
            method: 'server_event_forward',
            params: {
              name: eventName,
              data: desktopEvent.data.data
            },
            timeoutMs: config.rendererTimeoutMs
          }).catch(() => { });
        }
      }

      // backward-compatible legacy voice playback event
      if (desktopEvent.type === 'runtime.event') {
        const eventName = desktopEvent.data?.event || desktopEvent.data?.payload?.event;
        if (eventName === 'voice.playback.electron') {
          const payload = desktopEvent.data?.payload || desktopEvent.data;
          const audioRef = payload?.audio_ref || payload?.audioRef;
          if (audioRef && !avatarWindow.isDestroyed()) {
            logger.info?.('[desktop-live2d] voice_playback_electron_ipc', { audioRef: audioRef.split('/').pop() });
            avatarWindow.webContents.send('desktop:voice:play', {
              audioRef,
              format: payload?.format || 'ogg',
              gatewayUrl: config.gatewayUrl
            });
          }
        }
      }

      // Handle message.delta for streaming bubble output
      if (desktopEvent.type === 'message.delta') {
        const delta = String(desktopEvent.data?.delta || '').trim();
        const currentSessionId = desktopEvent.data?.session_id;
        const currentTraceId = desktopEvent.data?.trace_id;

        // Reset streaming state if session/trace changed
        if (streamingState.active &&
            (streamingState.sessionId !== currentSessionId ||
             streamingState.traceId !== currentTraceId)) {
          emitDesktopDebug('chain.electron.bubble.streaming_reset', 'bubble streaming reset due to session/trace change', {
            old_session_id: streamingState.sessionId,
            old_trace_id: streamingState.traceId,
            new_session_id: currentSessionId,
            new_trace_id: currentTraceId
          });
          streamingState.active = false;
          streamingState.accumulatedText = '';
        }

        streamingState.sessionId = currentSessionId;
        streamingState.traceId = currentTraceId;

        if (delta) {
          updateBubbleStreaming(delta);
        }
        return;
      }

      if (desktopEvent.type !== 'runtime.final') {
        return;
      }

      const output = String(desktopEvent.data?.output || '').trim();
      if (!output) {
        emitDesktopDebug('chain.electron.notification.final_empty', 'electron main received empty final output', {
          session_id: desktopEvent?.data?.session_id || null,
          trace_id: desktopEvent?.data?.trace_id || null
        });
        return;
      }

      appendChatMessage({
        role: 'assistant',
        text: output,
        timestamp: Date.now()
      }, 'assistant');

      // Handle streaming vs non-streaming mode
      if (streamingState.active) {
        // Streaming mode: finish with final output
        finishBubbleStreaming(output);
      } else {
        // Non-streaming mode: show bubble directly
        showBubble({
          text: output,
          durationMs: 5000
        });
      }

      emitDesktopDebug('chain.electron.ui.output_rendered', 'electron main rendered assistant output to chat+bubble', {
        session_id: desktopEvent?.data?.session_id || null,
        trace_id: desktopEvent?.data?.trace_id || null,
        output_chars: output.length,
        was_streaming: streamingState.active
      });
    }
  });
  const emitDesktopDebug = (topic, msg, meta = {}) => {
    void gatewayRuntimeClient.emitDebug(topic, msg, {
      source_file: 'apps/desktop-live2d/main/desktopSuite.js',
      ...(meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {})
    });
  };
  const initialSessionId = createDesktopSessionId();
  gatewayRuntimeClient.setSessionId(initialSessionId);
  emitDesktopDebug('chain.electron.session.initialized', 'electron main initialized session id', {
    session_id: initialSessionId
  });
  try {
    await gatewayRuntimeClient.ensureSession({ sessionId: initialSessionId, permissionLevel: 'medium' });
    logger.info?.('[desktop-live2d] gateway_session_bootstrap_ok', { sessionId: initialSessionId });
    emitDesktopDebug('chain.electron.session.bootstrap_ok', 'electron main ensured initial session', {
      session_id: initialSessionId,
      permission_level: 'medium'
    });
  } catch (err) {
    logger.error?.('[desktop-live2d] gateway_session_bootstrap_failed', err);
    emitDesktopDebug('chain.electron.session.bootstrap_failed', 'electron main failed to ensure initial session', {
      session_id: initialSessionId,
      error: err?.message || String(err)
    });
  }

  gatewayRuntimeClient.startNotificationStream();
  logger.info?.('[desktop-live2d] notification_stream_started');

  const chatInputListener = createChatInputListener({
    logger,
    onChatInput: (payload) => {
      const isNewSession = isNewSessionCommand(payload.text);
      emitDesktopDebug('chain.electron.chat_input.received', 'electron main received chat input', {
        session_id: gatewayRuntimeClient.getSessionId(),
        input_chars: String(payload?.text || '').trim().length,
        is_new_session_command: isNewSession
      });
      if (typeof onChatInput === 'function') {
        onChatInput(payload);
      }
      appendChatMessage({
        role: 'user',
        text: payload.text,
        timestamp: payload.timestamp
      }, 'user');

      if (isNewSession) {
        emitDesktopDebug('chain.electron.session.new_command', 'electron main handling /new session command', {
          previous_session_id: gatewayRuntimeClient.getSessionId()
        });
        void gatewayRuntimeClient.createAndUseNewSession({ permissionLevel: 'medium' }).then((sessionId) => {
          logger.info?.('[desktop-live2d] gateway_session_switched', { sessionId });
          emitDesktopDebug('chain.electron.session.switched', 'electron main switched to new session', {
            session_id: sessionId,
            permission_level: 'medium'
          });
          rpcServerRef?.notify({
            method: 'desktop.event',
            params: {
              type: 'session.new',
              timestamp: Date.now(),
              data: {
                session_id: sessionId
              }
            }
          });
          clearChatMessages();
          appendChatMessage({
            role: 'system',
            text: `[session] switched to ${sessionId}`,
            timestamp: Date.now()
          }, 'system');
          showBubble({
            text: 'New session created',
            durationMs: 2200
          });
        }).catch((err) => {
          logger.error?.('[desktop-live2d] /new session create failed', err);
          emitDesktopDebug('chain.electron.session.new_failed', 'electron main failed to create new session', {
            error: err?.message || String(err)
          });
        });
        return;
      }

      emitDesktopDebug('chain.electron.run.dispatched', 'electron main dispatching runInput', {
        session_id: gatewayRuntimeClient.getSessionId(),
        input_chars: String(payload?.text || '').trim().length
      });
      void gatewayRuntimeClient.runInput({ input: payload.text }).catch((err) => {
        logger.error?.('[desktop-live2d] gateway runtime input failed', err);
        emitDesktopDebug('chain.electron.run.failed', 'electron main runInput failed', {
          session_id: gatewayRuntimeClient.getSessionId(),
          error: err?.message || String(err)
        });
        rpcServerRef?.notify({
          method: 'desktop.event',
          params: {
            type: 'runtime.error',
            timestamp: Date.now(),
            data: {
              message: err?.message || String(err || 'unknown runtime error')
            }
          }
        });
        appendChatMessage({
          role: 'system',
          text: `[runtime error] ${err?.message || String(err || 'unknown runtime error')}`,
          timestamp: Date.now()
        }, 'system');
      });
    }
  });
  ipcMain.on(CHANNELS.chatInputSubmit, chatInputListener);

  const rendererReadyPromise = waitForRendererReady({ ipcMain, timeoutMs: 15000 });

  await avatarWindow.loadFile(path.join(config.projectRoot, 'apps', 'desktop-live2d', 'renderer', 'index.html'));
  await rendererReadyPromise;
  syncChatStateToRenderer();
  syncBubbleStateToRenderer();
  syncWindowStateToRenderer();
  if (chatState.visible) {
    chatWindow.show();
  }

  const bridge = new IpcRpcBridge({
    ipcMain,
    webContents: avatarWindow.webContents,
    invokeChannel: CHANNELS.invoke,
    resultChannel: CHANNELS.result,
    timeoutMs: config.rendererTimeoutMs
  });
  ipcBridgeRef = bridge;

  const rpcServer = new Live2dRpcServer({
    host: config.rpcHost,
    port: config.rpcPort,
    token: config.rpcToken,
    requestHandler: async (request) => handleDesktopRpcRequest({
      request,
      bridge,
      rendererTimeoutMs: config.rendererTimeoutMs,
      setChatPanelVisible,
      appendChatMessage,
      clearChatMessages,
      showBubble,
      avatarWindow
    }),
    logger
  });
  const rpcInfo = await rpcServer.start();
  rpcServerRef = rpcServer;

  const summary = {
    startedAt: new Date().toISOString(),
    rpcUrl: rpcInfo.url,
    rpcToken: config.rpcToken,
    gatewayUrl: config.gatewayUrl,
    currentSessionId: gatewayRuntimeClient.getSessionId(),
    modelJsonPath: modelValidation.modelJsonPath,
    methods: [
      'state.get',
      'param.set',
      'model.param.set',
      'model.param.batchSet',
      'model.motion.play',
      'model.expression.set',
      'chat.show',
      'chat.bubble.show',
      'chat.panel.show',
      'chat.panel.hide',
      'chat.panel.append',
      'chat.panel.clear',
      'tool.list',
      'tool.invoke'
    ]
  };
  writeRuntimeSummary(config.runtimeSummaryPath, summary);

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;

    ipcMain.removeHandler(CHANNELS.getRuntimeConfig);
    ipcMain.off(CHANNELS.windowDrag, windowDragListener);
    ipcMain.off(CHANNELS.chatPanelVisibility, chatPanelVisibilityListener);
    ipcMain.off(CHANNELS.chatPanelToggle, chatPanelToggleListener);
    ipcMain.off(CHANNELS.modelBoundsUpdate, modelBoundsListener);
    ipcMain.off(CHANNELS.bubbleMetricsUpdate, bubbleMetricsListener);
    ipcMain.off(CHANNELS.actionTelemetry, actionTelemetryListener);
    ipcMain.off(CHANNELS.windowControl, windowControlListener);
    ipcMain.off(CHANNELS.windowResizeRequest, windowResizeListener);
    ipcMain.off(CHANNELS.chatInputSubmit, chatInputListener);

    if (rpcServerRef) {
      await rpcServerRef.stop();
      rpcServerRef = null;
    }
    if (ipcBridgeRef) {
      ipcBridgeRef.dispose();
      ipcBridgeRef = null;
    }

    hideBubbleWindow();
    if (!bubbleWindow.isDestroyed()) {
      bubbleWindow.destroy();
    }
    if (!chatWindow.isDestroyed()) {
      chatWindow.destroy();
    }
    if (!avatarWindow.isDestroyed()) {
      avatarWindow.destroy();
    }

    await gatewaySupervisor.stop();
    gatewayRuntimeClient.stopNotificationStream();
  }

  return {
    config,
    summary,
    window: avatarWindow,
    avatarWindow,
    chatWindow,
    bubbleWindow,
    setResizeModeEnabled,
    isResizeModeEnabled,
    showPetWindows,
    hidePetWindows,
    stop
  };
}

function normalizeChatInputPayload(payload) {
  const text = String(payload?.text || '').trim();
  if (!text) {
    return null;
  }

  const role = String(payload?.role || 'user').trim();
  const allowedRoles = new Set(['user', 'assistant', 'system', 'tool']);
  return {
    role: allowedRoles.has(role) ? role : 'user',
    text,
    source: String(payload?.source || 'chat-panel'),
    timestamp: Number.isFinite(Number(payload?.timestamp)) ? Number(payload.timestamp) : Date.now()
  };
}

function createChatInputListener({ logger = console, onChatInput = null } = {}) {
  return (_event, payload) => {
    const normalized = normalizeChatInputPayload(payload);
    if (!normalized) {
      return;
    }
    logger.info?.('[desktop-live2d] chat_input_submit', {
      role: normalized.role,
      textLength: normalized.text.length,
      source: normalized.source
    });
    if (typeof onChatInput === 'function') {
      onChatInput(normalized);
    }
  };
}

async function handleDesktopRpcRequest({
  request,
  bridge,
  rendererTimeoutMs,
  setChatPanelVisible = null,
  appendChatMessage = null,
  clearChatMessages = null,
  showBubble = null,
  avatarWindow = null
}) {
  console.log(`[Desktop RPC] Received method: ${request.method}`, request.params);

  if (request.method === 'tool.list') {
    return {
      tools: listDesktopTools()
    };
  }

  if (request.method === 'tool.invoke') {
    const resolved = resolveToolInvoke({
      name: request.params?.name,
      args: request.params?.arguments
    });
    const result = await bridge.invoke({
      method: resolved.method,
      params: resolved.params,
      timeoutMs: rendererTimeoutMs
    });
    return {
      ok: true,
      tool: resolved.toolName,
      result
    };
  }

  if (request.method === 'voice.play.test') {
    const audioRef = String(request.params?.audioRef || '');
    const gatewayUrl = String(request.params?.gatewayUrl || 'http://127.0.0.1:3000');
    if (!audioRef) return { ok: false, error: 'audioRef required' };
    if (!avatarWindow.isDestroyed()) {
      avatarWindow.webContents.send('desktop:voice:play', { audioRef, format: 'ogg', gatewayUrl });
      return { ok: true, audioRef };
    }
    return { ok: false, error: 'avatarWindow not available' };
  }

  if (request.method === 'chat.show' || request.method === 'chat.bubble.show') {
    if (typeof showBubble !== 'function') {
      return { ok: false };
    }
    return showBubble(request.params || {});
  }

  if (request.method === 'chat.panel.show') {
    return typeof setChatPanelVisible === 'function'
      ? setChatPanelVisible(true)
      : { ok: false, visible: false };
  }

  if (request.method === 'chat.panel.hide') {
    return typeof setChatPanelVisible === 'function'
      ? setChatPanelVisible(false)
      : { ok: false, visible: false };
  }

  if (request.method === 'chat.panel.append') {
    return typeof appendChatMessage === 'function'
      ? appendChatMessage(request.params || {}, 'assistant')
      : { ok: false, count: 0 };
  }

  if (request.method === 'chat.panel.clear') {
    return typeof clearChatMessages === 'function'
      ? clearChatMessages()
      : { ok: false, count: 0 };
  }

  return bridge.invoke({
    method: request.method,
    params: request.params,
    timeoutMs: rendererTimeoutMs
  });
}

function createMainWindow({ BrowserWindow, preloadPath, display, uiConfig, windowMetrics, initialSizeOverride = null }) {
  const windowConfig = uiConfig?.window || {};
  const aspectRatio = resolveWindowAspectRatio(windowMetrics);
  const initialSize = normalizePersistedWindowState(initialSizeOverride, { windowMetrics }) || {
    width: windowMetrics?.expandedWidth || 320,
    height: windowMetrics?.expandedHeight || 500
  };
  const placement = windowConfig.placement || {};
  const unclampedWindowBounds = computeWindowBounds({
    width: initialSize.width,
    height: initialSize.height,
    display,
    anchor: String(placement.anchor || 'bottom-right'),
    marginRight: Number(placement.marginRight) || 18,
    marginBottom: Number(placement.marginBottom) || 18,
    marginLeft: Number(placement.marginLeft) || 18,
    marginTop: Number(placement.marginTop) || 18,
    x: placement.x,
    y: placement.y
  });
  const windowBounds = clampWindowBoundsToWorkArea({
    bounds: {
      x: unclampedWindowBounds.x,
      y: unclampedWindowBounds.y,
      width: initialSize.width,
      height: initialSize.height
    },
    display,
    minWidth: windowMetrics?.minWidth || 220,
    minHeight: windowMetrics?.minHeight || 320,
    maxWidth: windowMetrics?.maxWidth || Number.POSITIVE_INFINITY,
    maxHeight: windowMetrics?.maxHeight || Number.POSITIVE_INFINITY,
    maxOffscreenRatio: AVATAR_WINDOW_MAX_OFFSCREEN_RATIO
  });

  const win = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    minWidth: windowMetrics?.minWidth || 220,
    minHeight: windowMetrics?.minHeight || 320,
    maxWidth: windowMetrics?.maxWidth || undefined,
    maxHeight: windowMetrics?.maxHeight || undefined,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  if (typeof win.setAspectRatio === 'function' && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    win.setAspectRatio(aspectRatio);
  }

  return win;
}

function createChatWindow({ BrowserWindow, preloadPath, uiConfig, avatarBounds, display }) {
  const panelConfig = uiConfig?.chat?.panel || {};
  const width = toPositiveInt(panelConfig.width, 320);
  const height = toPositiveInt(panelConfig.height, 220);
  const bounds = computeChatWindowBounds({
    avatarBounds,
    chatWidth: width,
    chatHeight: height,
    display
  });

  return new BrowserWindow({
    width,
    height,
    x: bounds.x,
    y: bounds.y,
    minWidth: Math.max(260, Math.min(width, width)),
    minHeight: Math.max(180, Math.min(height, height)),
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    show: false,
    movable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
}

function createBubbleWindow({ BrowserWindow, preloadPath, avatarBounds, display }) {
  const bounds = computeBubbleWindowBounds({
    avatarBounds,
    bubbleWidth: 320,
    bubbleHeight: 160,
    display
  });

  const bubbleWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    focusable: false,
    resizable: false,
    movable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  bubbleWindow.setIgnoreMouseEvents(true, { forward: true });
  return bubbleWindow;
}

function computeRightBottomWindowBounds({ width, height, display, marginRight = 16, marginBottom = 16 }) {
  const fallback = { x: undefined, y: undefined };
  const workArea = display?.workArea;
  if (!workArea || typeof workArea !== 'object') {
    return fallback;
  }

  const x = Math.round(workArea.x + workArea.width - width - marginRight);
  const y = Math.round(workArea.y + workArea.height - height - marginBottom);
  return { x, y };
}

function computeWindowBounds({ width, height, display, anchor = 'bottom-right', x, y, ...margins }) {
  const workArea = display?.workArea;
  if (!workArea || typeof workArea !== 'object') {
    return { x: undefined, y: undefined };
  }

  if (anchor === 'custom') {
    const customX = Number.isFinite(Number(x)) ? Math.round(Number(x)) : undefined;
    const customY = Number.isFinite(Number(y)) ? Math.round(Number(y)) : undefined;
    return { x: customX, y: customY };
  }

  const marginLeft = Number(margins.marginLeft) || 16;
  const marginTop = Number(margins.marginTop) || 16;
  const marginRight = Number(margins.marginRight) || 16;
  const marginBottom = Number(margins.marginBottom) || 16;

  if (anchor === 'top-left') {
    return {
      x: Math.round(workArea.x + marginLeft),
      y: Math.round(workArea.y + marginTop)
    };
  }

  if (anchor === 'top-right') {
    return {
      x: Math.round(workArea.x + workArea.width - width - marginRight),
      y: Math.round(workArea.y + marginTop)
    };
  }

  if (anchor === 'bottom-left') {
    return {
      x: Math.round(workArea.x + marginLeft),
      y: Math.round(workArea.y + workArea.height - height - marginBottom)
    };
  }

  if (anchor === 'center') {
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2)
    };
  }

  return computeRightBottomWindowBounds({ width, height, display, marginRight, marginBottom });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeFittedAvatarWindowBounds({
  windowBounds,
  modelBounds,
  display,
  minWidth = 180,
  minHeight = 260,
  maxWidth = 900,
  maxHeight = 1400,
  paddingX = 18,
  paddingTop = 8,
  paddingBottom = 4,
  margin = 8,
  anchor = 'model'
}) {
  if (!windowBounds || !modelBounds) {
    return null;
  }

  const workArea = display?.workArea;
  const desiredWidth = Math.round(modelBounds.width + paddingX * 2);
  const desiredHeight = Math.round(modelBounds.height + paddingTop + paddingBottom);
  const width = clamp(desiredWidth, minWidth, maxWidth);
  const height = clamp(desiredHeight, minHeight, maxHeight);

  let x;
  let y;
  if (anchor === 'bottom-right') {
    const right = windowBounds.x + windowBounds.width;
    const bottom = windowBounds.y + windowBounds.height;
    x = Math.round(right - width);
    y = Math.round(bottom - height);
  } else {
    x = Math.round(windowBounds.x + modelBounds.x - paddingX - (width - desiredWidth) / 2);
    y = Math.round(windowBounds.y + modelBounds.y - paddingTop - (height - desiredHeight) / 2);
  }

  if (workArea && typeof workArea === 'object') {
    const maxAllowedWidth = Math.max(1, workArea.width - margin * 2);
    const maxAllowedHeight = Math.max(1, workArea.height - margin * 2);
    const safeWidth = clamp(width, Math.min(minWidth, maxAllowedWidth), Math.min(maxWidth, maxAllowedWidth));
    const safeHeight = clamp(height, Math.min(minHeight, maxAllowedHeight), Math.min(maxHeight, maxAllowedHeight));
    const minX = workArea.x + margin;
    const minY = workArea.y + margin;
    const maxX = workArea.x + workArea.width - safeWidth - margin;
    const maxY = workArea.y + workArea.height - safeHeight - margin;
    x = clamp(x, minX, maxX);
    y = clamp(y, minY, maxY);
    return { x: Math.round(x), y: Math.round(y), width: Math.round(safeWidth), height: Math.round(safeHeight) };
  }

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function computeChatWindowBounds({
  avatarBounds,
  chatWidth,
  chatHeight,
  display,
  gap = 12,
  margin = 16
}) {
  const workArea = display?.workArea;
  if (!workArea || !avatarBounds) {
    return { x: undefined, y: undefined, width: chatWidth, height: chatHeight };
  }

  const workLeft = workArea.x + margin;
  const workTop = workArea.y + margin;
  const workRight = workArea.x + workArea.width - margin;
  const workBottom = workArea.y + workArea.height - margin;

  let x = avatarBounds.x - chatWidth - gap;
  if (x < workLeft) {
    x = avatarBounds.x + avatarBounds.width + gap;
  }
  x = clamp(x, workLeft, workRight - chatWidth);

  const preferredY = avatarBounds.y + avatarBounds.height - chatHeight;
  const y = clamp(preferredY, workTop, workBottom - chatHeight);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: chatWidth,
    height: chatHeight
  };
}

function computeBubbleWindowBounds({
  avatarBounds,
  bubbleWidth,
  bubbleHeight,
  display,
  gap = 10,
  margin = 16
}) {
  const workArea = display?.workArea;
  if (!workArea || !avatarBounds) {
    return { x: undefined, y: undefined, width: bubbleWidth, height: bubbleHeight };
  }

  const workLeft = workArea.x + margin;
  const workTop = workArea.y + margin;
  const workRight = workArea.x + workArea.width - margin;
  const workBottom = workArea.y + workArea.height - margin;

  const avatarCenterX = avatarBounds.x + avatarBounds.width / 2;
  const preferredX = avatarCenterX - bubbleWidth / 2;
  let x = preferredX;
  x = clamp(x, workLeft, workRight - bubbleWidth);

  const preferredY = avatarBounds.y - bubbleHeight - gap;
  const y = clamp(preferredY, workTop, workBottom - bubbleHeight);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: bubbleWidth,
    height: bubbleHeight
  };
}

function waitForRendererReady({ ipcMain, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`renderer ready timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (_event, payload) => {
      cleanup();
      const reason = payload?.message || 'renderer reported error';
      reject(new Error(reason));
    };

    function cleanup() {
      clearTimeout(timer);
      ipcMain.off(CHANNELS.rendererReady, onReady);
      ipcMain.off(CHANNELS.rendererError, onError);
    }

    ipcMain.on(CHANNELS.rendererReady, onReady);
    ipcMain.on(CHANNELS.rendererError, onError);
  });
}

function writeRuntimeSummary(summaryPath, payload) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(payload, null, 2), 'utf8');
}

module.exports = {
  CHANNELS,
  normalizeLive2dPresetConfig,
  loadLive2dPresetConfig,
  startDesktopSuite,
  waitForRendererReady,
  createMainWindow,
  computeWindowBounds,
  computeRightBottomWindowBounds,
  resolveDisplayForBounds,
  clampWindowBoundsToWorkArea,
  resolveWindowMetrics,
  resolveWindowSizeForChatPanel,
  resizeWindowKeepingBottomRight,
  writeRuntimeSummary,
  normalizeChatInputPayload,
  normalizeWindowDragPayload,
  normalizeWindowControlPayload,
  normalizeChatPanelVisibilityPayload,
  normalizeChatPanelTogglePayload,
  normalizeModelBoundsPayload,
  normalizeBubbleMetricsPayload,
  normalizeActionTelemetryPayload,
  normalizeWindowResizePayload,
  createWindowDragListener,
  createWindowControlListener,
  createChatPanelVisibilityListener,
  buildWindowStatePayload,
  createWindowResizeListener,
  normalizePersistedWindowState,
  loadPersistedWindowState,
  writePersistedWindowState,
  createChatPanelToggleListener,
  createModelBoundsListener,
  createBubbleMetricsListener,
  createActionTelemetryListener,
  createChatInputListener,
  forwardLive2dActionEvent,
  handleDesktopRpcRequest,
  isNewSessionCommand,
  createChatWindow,
  createBubbleWindow,
  computeChatWindowBounds,
  computeBubbleWindowBounds,
  computeFittedAvatarWindowBounds
};
