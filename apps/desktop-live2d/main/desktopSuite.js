const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const YAML = require('yaml');

const {
  resolveDesktopLive2dConfig,
  upsertDesktopLive2dLayoutOverrides,
  upsertDesktopLive2dDragZoneOverrides,
  DEFAULT_UI_CONFIG
} = require('./config');
const { validateModelAssetDirectory } = require('./modelAssets');
const { GatewaySupervisor } = require('./gatewaySupervisor');
const { Live2dRpcServer } = require('./rpcServer');
const { IpcRpcBridge } = require('./ipcBridge');
const { GatewayRuntimeClient, createDesktopSessionId } = require('./gatewayRuntimeClient');
const { listDesktopTools, resolveToolInvoke } = require('./toolRegistry');
const { createDesktopPerceptionService } = require('./desktopPerceptionService');
const { createDesktopCaptureStore } = require('./desktopCaptureStore');
const { createDesktopCaptureService } = require('./desktopCaptureService');
const { QwenTtsClient } = require('./voice/qwenTtsClient');
const { QwenTtsRealtimeClient } = require('./voice/qwenTtsRealtimeClient');
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
  chatStreamSync: 'live2d:chat:stream-sync',
  chatImagePreviewOpen: 'live2d:chat:image-preview-open',
  bubbleStateSync: 'live2d:bubble:state-sync',
  bubbleMetricsUpdate: 'live2d:bubble:metrics-update',
  modelBoundsUpdate: 'live2d:model:bounds-update',
  actionTelemetry: 'live2d:action:telemetry',
  lipsyncTelemetry: 'live2d:lipsync:telemetry',
  windowDrag: 'live2d:window:drag',
  windowControl: 'live2d:window:control',
  chatPanelVisibility: 'live2d:chat:panel-visibility',
  windowResizeRequest: 'live2d:window:resize-request',
  windowStateSync: 'live2d:window:state-sync',
  windowInteractivity: 'live2d:window:interactivity'
});

const AVATAR_WINDOW_MAX_OFFSCREEN_RATIO = 0.8;
const BUBBLE_DEFAULT_LINE_DURATION_MS = 2000;
const BUBBLE_DEFAULT_LAUNCH_INTERVAL_MS = 300;
const BUBBLE_DEFAULT_WIDTH = 560;
const BUBBLE_DEFAULT_HEIGHT = 236;
const BUBBLE_MIN_WIDTH = 240;
const BUBBLE_MIN_HEIGHT = 120;
const BUBBLE_FONT_SIZE_PX = 16;
const BUBBLE_LINE_HEIGHT_RATIO = 1.45;
const BUBBLE_PADDING_HORIZONTAL_PX = 14;
const BUBBLE_PADDING_VERTICAL_PX = 10;
const BUBBLE_MIN_TEXT_UNITS_PER_LINE = 12;
const BUBBLE_UNFILLED_DRAIN_DELAY_MS = 3000;

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
  if (!['hide', 'hide_chat', 'close_pet', 'open_webui', 'close_resize_mode', 'save_layout_overrides', 'save_drag_zone_overrides'].includes(action)) {
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
  if (action === 'save_drag_zone_overrides') {
    const dragZone = payload?.dragZone;
    if (!dragZone || typeof dragZone !== 'object') {
      return null;
    }
    const normalizedDragZone = normalizeDragZonePayload(dragZone);
    if (!normalizedDragZone) {
      return null;
    }
    normalized.dragZone = normalizedDragZone;
  }
  return normalized;
}

function normalizeDragZonePayload(dragZone) {
  const centerXRatio = Number(dragZone.centerXRatio);
  const centerYRatio = Number(dragZone.centerYRatio);
  const widthRatio = Number(dragZone.widthRatio);
  const heightRatio = Number(dragZone.heightRatio);
  if (!Number.isFinite(centerXRatio) || !Number.isFinite(centerYRatio) || !Number.isFinite(widthRatio) || !Number.isFinite(heightRatio)) {
    return null;
  }
  const normalizedWidthRatio = Math.round(clamp(widthRatio, 0.1, 0.9) * 1000) / 1000;
  const normalizedHeightRatio = Math.round(clamp(heightRatio, 0.1, 0.9) * 1000) / 1000;
  return {
    centerXRatio: Math.round(clamp(centerXRatio, normalizedWidthRatio / 2, 1 - normalizedWidthRatio / 2) * 1000) / 1000,
    centerYRatio: Math.round(clamp(centerYRatio, normalizedHeightRatio / 2, 1 - normalizedHeightRatio / 2) * 1000) / 1000,
    widthRatio: normalizedWidthRatio,
    heightRatio: normalizedHeightRatio
  };
}

function createWindowControlListener({
  window,
  windows = null,
  onHide = null,
  onHideChat = null,
  onClosePet = null,
  onOpenWebUi = null,
  onCloseResizeMode = null,
  onSaveLayoutOverrides = null,
  onSaveDragZoneOverrides = null
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
    if (normalized.action === 'save_drag_zone_overrides' && typeof onSaveDragZoneOverrides === 'function') {
      onSaveDragZoneOverrides(normalized.dragZone);
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

function normalizeWindowInteractivityPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  if (typeof payload.interactive !== 'boolean') {
    return null;
  }
  return {
    interactive: payload.interactive
  };
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

function normalizeLipsyncTelemetryPayload(payload) {
  const event = String(payload?.event || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:\.[a-z0-9_]+){0,6}$/.test(event)) {
    return null;
  }

  const timestamp = Number(payload?.timestamp);
  const normalized = {
    event,
    timestamp: Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : Date.now()
  };

  const requestId = String(payload?.request_id || payload?.requestId || '').trim();
  if (requestId) {
    normalized.request_id = requestId.slice(0, 128);
  }

  const fieldsString = ['mime_type', 'reason', 'error'];
  for (const key of fieldsString) {
    if (payload?.[key] != null) {
      normalized[key] = String(payload[key]).slice(0, 512);
    }
  }

  const fieldsBoolean = [
    'has_lipsync_api',
    'has_model',
    'has_audio_element',
    'has_animation_frame',
    'has_state',
    'has_audio_context',
    'has_audio_source',
    'has_analyser'
  ];
  for (const key of fieldsBoolean) {
    if (typeof payload?.[key] === 'boolean') {
      normalized[key] = payload[key];
    }
  }

  const fieldsNumber = [
    'base64_chars',
    'bytes',
    'binary_length',
    'frame',
    'sample_rate',
    'fft_size',
    'frequency_bin_count',
    'voice_energy',
    'mouth_open',
    'mouth_form',
    'confidence'
  ];
  for (const key of fieldsNumber) {
    const value = Number(payload?.[key]);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (['voice_energy', 'mouth_open', 'mouth_form', 'confidence'].includes(key)) {
      normalized[key] = Math.round(value * 1000) / 1000;
    } else {
      normalized[key] = Math.round(value);
    }
  }

  return normalized;
}

function createLipsyncTelemetryListener({ window, onTelemetry = null } = {}) {
  return (event, payload) => {
    if (!window || window.isDestroyed() || event?.sender !== window.webContents) {
      return;
    }
    const normalized = normalizeLipsyncTelemetryPayload(payload);
    if (!normalized) {
      return;
    }
    onTelemetry?.(normalized);
  };
}

function normalizeRendererDebugEventName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+){0,6}$/.test(normalized)) {
    return 'unknown';
  }
  return normalized;
}

function parseRendererDebugConsoleMessage(message) {
  const prefix = '[renderer-debug] ';
  const raw = String(message || '');
  if (!raw.startsWith(prefix)) {
    return null;
  }
  const body = raw.slice(prefix.length);
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        event: 'unknown',
        data: { raw: body }
      };
    }
    const { event, ...rest } = parsed;
    const normalizedEvent = normalizeRendererDebugEventName(event);
    return {
      event: normalizedEvent,
      data: normalizedEvent === 'unknown'
        ? { raw_event: event == null ? null : String(event), ...rest }
        : rest
    };
  } catch {
    return {
      event: 'unknown',
      data: { raw: body }
    };
  }
}

function createMouthWaveformRecorder({
  enabled = false,
  outputDir = null,
  logger = console,
  idleCloseMs = 15000
} = {}) {
  const activeStreams = new Map();
  const trackedTopics = new Set([
    'chain.renderer.mouth.frame_sample',
    'chain.renderer.lipsync.frame_applied'
  ]);
  let latestFilePath = null;

  function sanitizeFileSegment(value) {
    return String(value || 'unknown')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'unknown';
  }

  function closeEntry(requestId) {
    const entry = activeStreams.get(requestId);
    if (!entry) {
      return;
    }
    activeStreams.delete(requestId);
    try {
      entry.stream.end();
    } catch (err) {
      logger.warn?.('[desktop-live2d] mouth waveform close failed', {
        requestId,
        error: err?.message || String(err || 'unknown error')
      });
    }
  }

  function ensureEntry(requestId) {
    const normalizedRequestId = sanitizeFileSegment(requestId);
    const existing = activeStreams.get(normalizedRequestId);
    if (existing) {
      existing.lastWriteAt = Date.now();
      return existing;
    }
    if (!outputDir) {
      return null;
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `${Date.now()}-${normalizedRequestId}.jsonl`);
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    const entry = {
      stream,
      filePath,
      lastWriteAt: Date.now()
    };
    activeStreams.set(normalizedRequestId, entry);
    latestFilePath = filePath;
    return entry;
  }

  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [requestId, entry] of activeStreams.entries()) {
      if (!Number.isFinite(entry.lastWriteAt) || now - entry.lastWriteAt > idleCloseMs) {
        closeEntry(requestId);
      }
    }
  }, Math.max(1000, Math.min(idleCloseMs, 5000)));
  pruneTimer.unref?.();

  return {
    record(topic, payload = {}) {
      if (!enabled || !trackedTopics.has(topic)) {
        return;
      }
      const requestId = payload?.request_id || 'unknown';
      const entry = ensureEntry(requestId);
      if (!entry) {
        return;
      }
      entry.lastWriteAt = Date.now();
      try {
        entry.stream.write(`${JSON.stringify({
          topic,
          recorded_at: Date.now(),
          ...payload
        })}\n`);
      } catch (err) {
        logger.warn?.('[desktop-live2d] mouth waveform write failed', {
          requestId,
          error: err?.message || String(err || 'unknown error')
        });
      }
    },
    getState() {
      return {
        enabled: Boolean(enabled),
        outputDir,
        latestFilePath
      };
    },
    dispose() {
      clearInterval(pruneTimer);
      for (const requestId of Array.from(activeStreams.keys())) {
        closeEntry(requestId);
      }
    }
  };
}

function summarizeProviderErrorMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return {};
  }
  const status = Number(meta.status);
  let bodyPreview = '';
  if (typeof meta.body === 'string') {
    bodyPreview = meta.body;
  } else if (meta.body && typeof meta.body === 'object') {
    try {
      bodyPreview = JSON.stringify(meta.body);
    } catch {
      bodyPreview = '[unserializable body]';
    }
  }
  const normalized = {};
  if (Number.isFinite(status)) {
    normalized.provider_status = Math.round(status);
  }
  if (bodyPreview) {
    normalized.provider_body = bodyPreview.slice(0, 800);
  }
  return normalized;
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

function createWindowInteractivityListener({
  window,
  isResizeModeEnabled = null
} = {}) {
  let lastInteractive = null;
  return (event, payload) => {
    if (!window || window.isDestroyed?.() || event?.sender !== window.webContents) {
      return;
    }

    const normalized = normalizeWindowInteractivityPayload(payload);
    if (!normalized || typeof window.setIgnoreMouseEvents !== 'function') {
      return;
    }

    const interactive = typeof isResizeModeEnabled === 'function' && isResizeModeEnabled()
      ? true
      : normalized.interactive;
    if (interactive === lastInteractive) {
      return;
    }
    lastInteractive = interactive;
    window.setIgnoreMouseEvents(!interactive, interactive ? undefined : { forward: true });
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
  realtimeTtsClient,
  voiceConfig,
  avatarWindow,
  rpcServerRef,
  emitDebug = null,
  logger = console
} = {}) {
  const requestId = String(eventPayload?.request_id || `${Date.now()}-voice`);
  const text = String(eventPayload?.text || '').trim();
  if (!text) return;

  const timeoutSec = Math.max(1, Number(eventPayload?.timeoutSec || 45));
  const model = String(eventPayload?.model || '');
  const voice = String(eventPayload?.voiceId || '');
  const sessionId = String(eventPayload?.session_id || '').trim() || null;
  const traceId = String(eventPayload?.trace_id || '').trim() || null;
  const voiceTransport = String(voiceConfig?.transport || 'realtime').trim().toLowerCase();
  const voiceOutputDelayMs = Math.max(0, Math.min(500, Math.round(Number(voiceConfig?.outputDelayMs) || 0)));
  const fallbackOnRealtimeError = voiceConfig?.fallbackOnRealtimeError !== false;
  const realtimePrebufferMs = Math.max(40, Number(voiceConfig?.realtime?.prebufferMs) || 160);
  const realtimeIdleTimeoutMs = Math.max(1000, Number(voiceConfig?.realtime?.idleTimeoutMs) || 8000);

  emitDebug?.('chain.electron.voice.requested', 'electron main received voice.requested', {
    request_id: requestId,
    session_id: sessionId,
    trace_id: traceId,
    text_chars: text.length,
    timeout_sec: timeoutSec,
    model: model || null,
    voice_id: voice || null,
    transport: voiceTransport,
    output_delay_ms: voiceOutputDelayMs,
    fallback_on_realtime_error: fallbackOnRealtimeError
  });

  rpcServerRef?.notify({
    method: 'desktop.event',
    params: {
      type: 'voice.synthesis.started',
      timestamp: Date.now(),
      data: { request_id: requestId }
    }
  });

  try {
    if (voiceTransport === 'realtime') {
      if (!realtimeTtsClient || typeof realtimeTtsClient.streamSynthesis !== 'function') {
        emitDebug?.(
          'chain.electron.voice.realtime.unavailable',
          'realtime transport requested but realtime client is unavailable, fallback to non-streaming',
          {
            request_id: requestId,
            session_id: sessionId,
            trace_id: traceId
          }
        );
      } else {
        const realtimeTimeoutMs = Math.max(8000, Math.min(timeoutSec * 1000, 60000));
        emitDebug?.(
          'chain.electron.voice.realtime.stream_started',
          'realtime transport stream started',
          {
            request_id: requestId,
            session_id: sessionId,
            trace_id: traceId,
            requested_model: model || null,
            effective_model_source: 'provider_tts_realtime_model',
            timeout_ms: realtimeTimeoutMs,
            prebuffer_ms: realtimePrebufferMs,
            idle_timeout_ms: realtimeIdleTimeoutMs
          }
        );
        try {
          if (!avatarWindow.isDestroyed()) {
            avatarWindow.webContents.send('desktop:voice:stream-start', {
              requestId,
              sampleRate: 24000,
              mimeType: 'audio/pcm',
              outputDelayMs: voiceOutputDelayMs,
              prebufferMs: realtimePrebufferMs,
              idleTimeoutMs: realtimeIdleTimeoutMs
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

          const result = await realtimeTtsClient.streamSynthesis({
            text,
            voice,
            timeoutMs: realtimeTimeoutMs,
            onEvent: (event) => {
              if (event.type === 'chunk') {
                const chunkIndex = Number(event.chunk_index || 0);
                if (!avatarWindow.isDestroyed()) {
                  avatarWindow.webContents.send('desktop:voice:stream-chunk', {
                    requestId,
                    seq: chunkIndex,
                    audioBase64: String(event.audio_base64 || ''),
                    audioBytes: Number(event.audio_bytes || 0),
                    totalAudioBytes: Number(event.total_audio_bytes || 0)
                  });
                }
                if (chunkIndex <= 3 || chunkIndex % 10 === 0) {
                  emitDebug?.(
                    'chain.electron.voice.realtime.chunk',
                    'realtime transport chunk dispatched to renderer',
                    {
                      request_id: requestId,
                      session_id: sessionId,
                      trace_id: traceId,
                      chunk_index: chunkIndex,
                      audio_bytes: Number(event.audio_bytes || 0),
                      total_audio_bytes: Number(event.total_audio_bytes || 0)
                    }
                  );
                }
                return;
              }
              emitDebug?.(
                `chain.electron.voice.realtime.${event.type}`,
                'realtime transport event',
                {
                  request_id: requestId,
                  session_id: sessionId,
                  trace_id: traceId,
                  ...event
                }
              );
            }
          });

          if (!avatarWindow.isDestroyed()) {
            avatarWindow.webContents.send('desktop:voice:stream-end', {
              requestId,
              reason: 'completed'
            });
          }

          emitDebug?.(
            'chain.electron.voice.realtime.stream_completed',
            'realtime transport stream completed',
            {
              request_id: requestId,
              session_id: sessionId,
              trace_id: traceId,
              result
            }
          );
          rpcServerRef?.notify({
            method: 'desktop.event',
            params: {
              type: 'voice.synthesis.completed',
              timestamp: Date.now(),
              data: {
                request_id: requestId,
                bytes: Number(result?.totalAudioBytes) || null,
                mime_type: 'audio/pcm',
                model: result?.model || null,
                playback_route: 'realtime_stream'
              }
            }
          });
          return;
        } catch (err) {
          const code = String(err?.code || 'TTS_REALTIME_FAILED');
          const errorText = String(err?.message || 'unknown realtime error');
          if (!avatarWindow.isDestroyed()) {
            avatarWindow.webContents.send('desktop:voice:stream-error', {
              requestId,
              code,
              error: errorText
            });
          }
          emitDebug?.(
            'chain.electron.voice.realtime.stream_failed',
            'realtime transport stream failed',
            {
              request_id: requestId,
              session_id: sessionId,
              trace_id: traceId,
              code,
              error: errorText
            }
          );
          if (!fallbackOnRealtimeError) {
            rpcServerRef?.notify({
              method: 'desktop.event',
              params: {
                type: 'voice.synthesis.failed',
                timestamp: Date.now(),
                data: {
                  request_id: requestId,
                  code,
                  error: errorText
                }
              }
            });
            return;
          }
        }
      }
    }

    const preferStreamingPlayback = String(process.env.DESKTOP_VOICE_STREAMING_PLAYBACK || 'true')
      .trim()
      .toLowerCase() !== 'false';
    const synthesis = await ttsClient.synthesizeNonStreaming({
      text,
      model,
      voice,
      timeoutMs: timeoutSec * 1000
    });
    let audioUrlHost = null;
    try {
      audioUrlHost = new URL(String(synthesis.audioUrl || '')).host || null;
    } catch {
      audioUrlHost = null;
    }

    emitDebug?.('chain.electron.voice.synthesis.completed', 'electron main synthesized voice and resolved audio playback source', {
      request_id: requestId,
      session_id: sessionId,
      trace_id: traceId,
      bytes: null,
      mime_type: synthesis.mimeType || null,
      model: synthesis.model || null,
      playback_route: preferStreamingPlayback ? 'remote_stream' : 'memory_buffer',
      audio_url_host: audioUrlHost
    });

    rpcServerRef?.notify({
      method: 'desktop.event',
      params: {
        type: 'voice.synthesis.completed',
        timestamp: Date.now(),
        data: {
          request_id: requestId,
          bytes: null,
          mime_type: synthesis.mimeType,
          model: synthesis.model,
          playback_route: preferStreamingPlayback ? 'remote_stream' : 'memory_buffer'
        }
      }
    });

    if (!avatarWindow.isDestroyed()) {
      if (preferStreamingPlayback) {
        avatarWindow.webContents.send('desktop:voice:play-remote', {
          requestId,
          audioUrl: synthesis.audioUrl,
          mimeType: synthesis.mimeType || 'audio/ogg',
          outputDelayMs: voiceOutputDelayMs
        });
        emitDebug?.('chain.electron.voice.ipc.dispatched_remote', 'electron main dispatched remote voice playback to renderer', {
          request_id: requestId,
          session_id: sessionId,
          trace_id: traceId,
          mime_type: synthesis.mimeType || 'audio/ogg',
          audio_url_host: audioUrlHost
        });
      } else {
        const audioBuffer = await ttsClient.fetchAudioBuffer({
          audioUrl: synthesis.audioUrl,
          timeoutMs: timeoutSec * 1000
        });
        const audioBytes = new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
        avatarWindow.webContents.send('desktop:voice:play-memory', {
          requestId,
          audioBytes,
          mimeType: synthesis.mimeType || 'audio/ogg',
          outputDelayMs: voiceOutputDelayMs
        });
        emitDebug?.('chain.electron.voice.ipc.dispatched', 'electron main dispatched memory voice playback to renderer', {
          request_id: requestId,
          session_id: sessionId,
          trace_id: traceId,
          mime_type: synthesis.mimeType || 'audio/ogg',
          bytes: audioBytes.byteLength
        });
      }
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
    const providerMeta = summarizeProviderErrorMeta(err?.meta);
    logger.error?.('[desktop-live2d] voice requested process failed', {
      requestId,
      code: err?.code,
      error: err?.message || String(err),
      ...providerMeta
    });
    emitDebug?.('chain.electron.voice.failed', 'electron main voice.requested processing failed', {
      request_id: requestId,
      session_id: sessionId,
      trace_id: traceId,
      code: String(err?.code || 'TTS_PROVIDER_DOWN'),
      error: String(err?.message || 'unknown tts error'),
      ...providerMeta
    });

    rpcServerRef?.notify({
      method: 'desktop.event',
      params: {
        type: 'voice.synthesis.failed',
        timestamp: Date.now(),
        data: {
          request_id: requestId,
          code: String(err?.code || 'TTS_PROVIDER_DOWN'),
          error: String(err?.message || 'unknown tts error'),
          ...providerMeta
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
  systemPreferences = null,
  shell = null,
  projectRoot = null,
  onResizeModeChange = null,
  logger = console,
  onChatInput = null
} = {}) {
  if (!app || !BrowserWindow || !ipcMain) {
    throw new Error('startDesktopSuite requires app, BrowserWindow, and ipcMain');
  }

  const config = resolveDesktopLive2dConfig({
    projectRoot: projectRoot || undefined
  });
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
  const perceptionService = createDesktopPerceptionService({ screen, systemPreferences });
  const captureStore = createDesktopCaptureStore({
    captureDir: config.desktopCaptureDir,
    ttlMs: config.desktopCaptureTtlMs
  });
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    logger
  });
  const captureCleanupController = createCaptureCleanupController({
    captureStore,
    intervalMs: config.desktopCaptureCleanupIntervalMs,
    logger
  });

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
  let avatarWindowInteractive = false;
  const avatarWindow = createMainWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    display,
    uiConfig: config.uiConfig,
    windowMetrics,
    initialSizeOverride: persistedWindowState
  });
  const avatarWindowBounds = avatarWindow.getBounds();
  const bubbleUiConfig = config.uiConfig?.chat?.bubble || {};
  const bubbleStreamConfig = bubbleUiConfig.stream || {};
  const bubbleRuntimeConfig = {
    width: Math.max(BUBBLE_MIN_WIDTH, toPositiveInt(bubbleUiConfig.width, BUBBLE_DEFAULT_WIDTH)),
    height: Math.max(BUBBLE_MIN_HEIGHT, toPositiveInt(bubbleUiConfig.height, BUBBLE_DEFAULT_HEIGHT)),
    lineDurationMs: Math.max(400, toPositiveInt(bubbleStreamConfig.lineDurationMs, BUBBLE_DEFAULT_LINE_DURATION_MS)),
    launchIntervalMs: Math.max(80, toPositiveInt(bubbleStreamConfig.launchIntervalMs, BUBBLE_DEFAULT_LAUNCH_INTERVAL_MS))
  };

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
    display,
    bubbleWidth: bubbleRuntimeConfig.width,
    bubbleHeight: bubbleRuntimeConfig.height
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
    lines: [],
    streaming: false,
    lineCapacity: 1,
    width: bubbleRuntimeConfig.width,
    height: bubbleRuntimeConfig.height
  };
  let bubbleHideTimer = null;
  let imagePreviewWindow = null;
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

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatImageSize(sizeBytes) {
    const bytes = Math.max(0, Number(sizeBytes) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function buildImagePreviewHtml(payload) {
    const safeName = escapeHtml(payload.name || 'image');
    const safeMime = escapeHtml(payload.mimeType || 'image/*');
    const safeSize = escapeHtml(formatImageSize(payload.sizeBytes));
    const safeUrl = escapeHtml(payload.imageUrl);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeName}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #0b1220;
      color: #e5efff;
      font-family: "SF Pro Text", "PingFang SC", sans-serif;
      overflow: hidden;
    }
    .preview-root {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .preview-meta {
      flex: 0 0 auto;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      font-size: 12px;
      color: rgba(229, 239, 255, 0.88);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow: auto;
    }
    .preview-body img {
      max-width: 100%;
      max-height: 100%;
      border-radius: 8px;
      box-shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
      object-fit: contain;
      background: rgba(255, 255, 255, 0.04);
    }
  </style>
</head>
<body>
  <div class="preview-root">
    <div class="preview-meta">${safeName} · ${safeMime} · ${safeSize}</div>
    <div class="preview-body">
      <img src="${safeUrl}" alt="${safeName}" />
    </div>
  </div>
</body>
</html>`;
  }

  function ensureImagePreviewWindow() {
    if (imagePreviewWindow && !imagePreviewWindow.isDestroyed()) {
      return imagePreviewWindow;
    }
    imagePreviewWindow = new BrowserWindow({
      width: 900,
      height: 680,
      minWidth: 420,
      minHeight: 320,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0b1220',
      title: 'Image Preview',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    imagePreviewWindow.on('closed', () => {
      imagePreviewWindow = null;
    });
    return imagePreviewWindow;
  }

  async function openChatImagePreview(rawPayload) {
    const payload = normalizeChatImagePreviewPayload(rawPayload, { gatewayUrl: config.gatewayUrl });
    if (!payload) {
      return { ok: false, reason: 'invalid_payload' };
    }
    const targetWindow = ensureImagePreviewWindow();
    const html = buildImagePreviewHtml(payload);
    await targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    targetWindow.focus();
    return { ok: true };
  }

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

  function syncChatStreamToRenderer(payload = {}) {
    if (chatWindow.isDestroyed()) {
      return;
    }
    chatWindow.webContents.send(CHANNELS.chatStreamSync, payload);
  }

  function syncBubbleStateToRenderer() {
    if (bubbleWindow.isDestroyed()) {
      return;
    }
    bubbleWindow.webContents.send(CHANNELS.bubbleStateSync, {
      visible: bubbleState.visible,
      text: bubbleState.text,
      lines: bubbleState.lines,
      streaming: bubbleState.streaming,
      line_capacity: Math.max(1, Number(bubbleState.lineCapacity) || 1)
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

  function syncAvatarWindowMousePassthrough() {
    if (avatarWindow.isDestroyed() || typeof avatarWindow.setIgnoreMouseEvents !== 'function') {
      return;
    }
    const interactive = resizeModeEnabled || avatarWindowInteractive;
    avatarWindow.setIgnoreMouseEvents(!interactive, interactive ? undefined : { forward: true });
  }

  function setResizeModeEnabled(enabled) {
    resizeModeEnabled = Boolean(enabled);
    syncAvatarWindowMousePassthrough();
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
    const images = normalizeChatMessageImages(params?.images);
    if (!text && images.length === 0) {
      return { ok: false, count: chatState.messages.length };
    }
    const role = String(params?.role || fallbackRole || 'assistant');
    const message = {
      role,
      text,
      timestamp: Number.isFinite(Number(params?.timestamp)) ? Number(params.timestamp) : Date.now(),
      images
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
    bubbleState.lines = [];
    bubbleState.streaming = false;
    bubbleState.lineCapacity = 1;
    syncBubbleStateToRenderer();
    if (!bubbleWindow.isDestroyed()) {
      bubbleWindow.hide();
    }
  }

  function showBubble(params) {
    const inputLines = Array.isArray(params?.lines)
      ? params.lines
          .map((item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              return {
                id: String(item.id || ''),
                text: String(item.text || '').trim()
              };
            }
            return {
              id: '',
              text: String(item || '').trim()
            };
          })
          .filter((item) => item.text)
      : [];
    const text = inputLines.length > 0
      ? inputLines.map((item) => item.text).join('\n')
      : String(params?.text || '').trim();
    const currentBounds = !bubbleWindow.isDestroyed() ? bubbleWindow.getBounds() : null;
    bubbleState.width = Math.max(
      BUBBLE_MIN_WIDTH,
      Number(currentBounds?.width) || Number(bubbleState.width) || bubbleRuntimeConfig.width
    );
    bubbleState.height = Math.max(
      BUBBLE_MIN_HEIGHT,
      Number(currentBounds?.height) || Number(bubbleState.height) || bubbleRuntimeConfig.height
    );
    const maxVisibleLines = getBubbleVisibleLineCapacity();
    const normalizedLines = inputLines.length > 0
      ? inputLines.slice(0, maxVisibleLines)
      : buildBubbleTextLines(text, { maxLines: maxVisibleLines }).map((line, index) => ({
        id: `bubble-line-${index + 1}`,
        text: line
      }));
    if (!text && inputLines.length === 0) {
      return { ok: false };
    }
    const durationMs = Number.isFinite(Number(params?.durationMs))
      ? Math.max(500, Math.min(30000, Number(params.durationMs)))
      : 5000;
    const streaming = Boolean(params?.streaming);
    bubbleState.visible = true;
    bubbleState.text = text;
    bubbleState.lines = normalizedLines;
    bubbleState.streaming = streaming;
    bubbleState.lineCapacity = maxVisibleLines;
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

  // Streaming state for bubble (multi-slot parallel sentence playback)
  let streamingState = {
    active: false,
    sessionId: null,
    traceId: null,
    receivedText: '',
    bufferedText: '',
    sentenceQueue: [],
    visibleItems: [],
    lastUpdateTime: 0,
    lastLaunchAtMs: 0,
    avgLaunchIntervalMs: 0,
    launchTimer: null,
    drainTimer: null,
    drainDelayTimer: null,
    drainDelayApplied: false,
    everFilledCapacity: false,
    streamEnded: false,
    displayedSentences: 0,
    nextSentenceId: 1
  };

  function getBubbleVisibleLineCapacity() {
    const totalHeight = Math.max(BUBBLE_MIN_HEIGHT, Number(bubbleState.height) || bubbleRuntimeConfig.height);
    const usableHeight = Math.max(1, totalHeight - (BUBBLE_PADDING_VERTICAL_PX * 2));
    const lineHeightPx = BUBBLE_FONT_SIZE_PX * BUBBLE_LINE_HEIGHT_RATIO;
    return Math.max(1, Math.floor(usableHeight / Math.max(1, lineHeightPx)));
  }

  function getBubbleTextUnitsPerLine() {
    const totalWidth = Math.max(BUBBLE_MIN_WIDTH, Number(bubbleState.width) || bubbleRuntimeConfig.width);
    const usableWidth = Math.max(1, totalWidth - (BUBBLE_PADDING_HORIZONTAL_PX * 2));
    const unitPx = 8;
    return Math.max(BUBBLE_MIN_TEXT_UNITS_PER_LINE, Math.floor(usableWidth / unitPx));
  }

  function toDisplayUnits(char) {
    const codePoint = String(char || '').codePointAt(0) || 0;
    const isAscii = codePoint > 0 && codePoint <= 0x7f;
    return isAscii ? 1 : 2;
  }

  function splitCompletedSentences(text, { flushAll = false } = {}) {
    const source = String(text || '');
    if (!source) {
      return { sentences: [], rest: '' };
    }

    const sentences = [];
    let start = 0;
    const isTerminal = (char) => /[。！？!?；;\n]/.test(char);
    const isTrailing = (char) => /["'”’）】》」』\s]/.test(char);

    for (let i = 0; i < source.length; i += 1) {
      const current = source[i];
      if (!isTerminal(current)) {
        continue;
      }

      let end = i + 1;
      while (end < source.length && isTrailing(source[end])) {
        end += 1;
      }
      const sentence = source.slice(start, end).trim();
      if (sentence) {
        sentences.push(sentence);
      }
      start = end;
      i = end - 1;
    }

    let rest = source.slice(start);
    if (flushAll) {
      const tail = rest.trim();
      if (tail) {
        sentences.push(tail);
      }
      rest = '';
    }

    return { sentences, rest };
  }

  function chunkSentenceByLength(sentence, maxUnits = getBubbleTextUnitsPerLine()) {
    const normalized = String(sentence || '').trim();
    if (!normalized) {
      return [];
    }
    const chars = Array.from(normalized);
    if (chars.length === 0) {
      return [];
    }

    const safeMaxUnits = Math.max(BUBBLE_MIN_TEXT_UNITS_PER_LINE, Number(maxUnits) || BUBBLE_MIN_TEXT_UNITS_PER_LINE);
    let currentUnits = 0;
    let currentChunk = '';
    const chunks = [];

    for (const char of chars) {
      const units = toDisplayUnits(char);
      if (currentChunk && currentUnits + units > safeMaxUnits) {
        const trimmed = currentChunk.trim();
        if (trimmed) {
          chunks.push(trimmed);
        }
        currentChunk = char;
        currentUnits = units;
        continue;
      }
      currentChunk += char;
      currentUnits += units;
    }

    const tail = currentChunk.trim();
    if (tail) {
      chunks.push(tail);
    }

    if (chunks.length === 0) {
      return [normalized];
    }
    return chunks;
  }

  function buildBubbleTextLines(text, { maxLines = getBubbleVisibleLineCapacity() } = {}) {
    const source = String(text || '').replace(/\r/g, '').trim();
    if (!source) {
      return [];
    }
    const safeMaxLines = Math.max(1, Number(maxLines) || 1);
    const maxUnits = getBubbleTextUnitsPerLine();
    const lines = [];
    for (const segment of source.split('\n')) {
      const chunks = chunkSentenceByLength(segment, maxUnits);
      if (chunks.length > 0) {
        lines.push(...chunks);
      }
      if (lines.length >= safeMaxLines) {
        break;
      }
    }
    return lines.slice(0, safeMaxLines);
  }

  function enqueueStreamSentences(sentences = []) {
    const maxUnits = getBubbleTextUnitsPerLine();
    for (const sentence of sentences) {
      const chunks = chunkSentenceByLength(sentence, maxUnits);
      if (chunks.length > 0) {
        streamingState.sentenceQueue.push(...chunks);
      }
    }
  }

  function renderStreamingBubble() {
    if (!streamingState.active) {
      return;
    }
    const lines = streamingState.visibleItems
      .map((item) => ({
        id: item.id,
        text: item.text
      }))
      .filter((item) => item.text);
    if (lines.length === 0) {
      hideBubbleWindow();
      return;
    }
    showBubble({
      lines,
      durationMs: 30000,
      streaming: true
    });
  }

  function finishBubbleStreamingIfDone(reason = 'completed') {
    if (!streamingState.active) {
      return;
    }
    if (streamingState.sentenceQueue.length > 0 || streamingState.visibleItems.length > 0) {
      return;
    }
    if (!streamingState.streamEnded) {
      return;
    }

    const payload = {
      session_id: streamingState.sessionId,
      trace_id: streamingState.traceId,
      reason,
      accumulated_chars: streamingState.receivedText.length,
      displayed_sentences: streamingState.displayedSentences
    };

    if (streamingState.launchTimer) {
      clearInterval(streamingState.launchTimer);
      streamingState.launchTimer = null;
    }
    if (streamingState.drainTimer) {
      clearInterval(streamingState.drainTimer);
      streamingState.drainTimer = null;
    }
    if (streamingState.drainDelayTimer) {
      clearTimeout(streamingState.drainDelayTimer);
      streamingState.drainDelayTimer = null;
    }

    streamingState.active = false;
    streamingState.receivedText = '';
    streamingState.bufferedText = '';
    streamingState.sentenceQueue = [];
    streamingState.visibleItems = [];
    streamingState.lastUpdateTime = 0;
    streamingState.lastLaunchAtMs = 0;
    streamingState.avgLaunchIntervalMs = 0;
    streamingState.drainDelayApplied = false;
    streamingState.everFilledCapacity = false;
    streamingState.streamEnded = false;
    streamingState.displayedSentences = 0;
    streamingState.nextSentenceId = 1;
    hideBubbleWindow();

    emitDesktopDebug('chain.electron.bubble.streaming_finished', 'bubble streaming finished', payload);
  }

  function ensureStreamingDrainTimer() {
    if (!streamingState.active || !streamingState.streamEnded) {
      return;
    }
    if (streamingState.sentenceQueue.length > 0 || streamingState.visibleItems.length === 0) {
      finishBubbleStreamingIfDone('drain_ready_check');
      return;
    }
    if (streamingState.drainTimer) {
      return;
    }
    const visibleCapacity = getBubbleVisibleLineCapacity();
    const shouldDelayForUnfilledWindow = !streamingState.everFilledCapacity
      && streamingState.displayedSentences > 0
      && streamingState.displayedSentences < visibleCapacity;

    if (shouldDelayForUnfilledWindow && !streamingState.drainDelayApplied) {
      streamingState.drainDelayApplied = true;
      streamingState.drainDelayTimer = setTimeout(() => {
        streamingState.drainDelayTimer = null;
        ensureStreamingDrainTimer();
      }, BUBBLE_UNFILLED_DRAIN_DELAY_MS);
      emitDesktopDebug('chain.electron.bubble.streaming_drain_delayed', 'bubble streaming drain delayed for unfilled window', {
        session_id: streamingState.sessionId,
        trace_id: streamingState.traceId,
        displayed_sentences: streamingState.displayedSentences,
        visible_capacity: visibleCapacity,
        delay_ms: BUBBLE_UNFILLED_DRAIN_DELAY_MS
      });
      return;
    }
    if (streamingState.drainDelayTimer) {
      return;
    }
    const fallbackStepMs = Math.max(
      60,
      Number(bubbleRuntimeConfig.launchIntervalMs) || BUBBLE_DEFAULT_LAUNCH_INTERVAL_MS
    );
    const observedStepMs = Number(streamingState.avgLaunchIntervalMs);
    const drainStepMs = Math.max(
      120,
      Number.isFinite(observedStepMs) && observedStepMs > 0 ? Math.round(observedStepMs) : fallbackStepMs
    );
    streamingState.drainTimer = setInterval(() => {
      if (!streamingState.active) {
        clearInterval(streamingState.drainTimer);
        streamingState.drainTimer = null;
        return;
      }
      if (!streamingState.streamEnded || streamingState.sentenceQueue.length > 0) {
        clearInterval(streamingState.drainTimer);
        streamingState.drainTimer = null;
        return;
      }
      if (streamingState.visibleItems.length === 0) {
        clearInterval(streamingState.drainTimer);
        streamingState.drainTimer = null;
        finishBubbleStreamingIfDone('drain_empty');
        return;
      }
      // Drain from the bottom line first after stream end.
      streamingState.visibleItems.pop();
      renderStreamingBubble();
      if (streamingState.visibleItems.length === 0) {
        clearInterval(streamingState.drainTimer);
        streamingState.drainTimer = null;
        finishBubbleStreamingIfDone('drain_completed');
      }
    }, drainStepMs);
  }

  function launchNextStreamingSentence() {
    if (!streamingState.active) {
      return;
    }
    if (streamingState.sentenceQueue.length === 0) {
      finishBubbleStreamingIfDone('queue_dry');
      return;
    }
    const maxVisibleLines = getBubbleVisibleLineCapacity();
    if (streamingState.visibleItems.length >= maxVisibleLines) {
      streamingState.visibleItems.shift();
    }

    const text = String(streamingState.sentenceQueue.shift() || '').trim();
    if (!text) {
      return;
    }

    const item = {
      id: streamingState.nextSentenceId++,
      text
    };
    const launchedAt = Date.now();
    if (streamingState.lastLaunchAtMs > 0) {
      const launchGapMs = Math.max(20, launchedAt - streamingState.lastLaunchAtMs);
      if (streamingState.avgLaunchIntervalMs > 0) {
        streamingState.avgLaunchIntervalMs = Math.round((streamingState.avgLaunchIntervalMs * 0.7) + (launchGapMs * 0.3));
      } else {
        streamingState.avgLaunchIntervalMs = launchGapMs;
      }
    }
    streamingState.lastLaunchAtMs = launchedAt;
    streamingState.visibleItems.push(item);
    streamingState.displayedSentences += 1;
    if (streamingState.displayedSentences >= maxVisibleLines) {
      streamingState.everFilledCapacity = true;
    }
    // Render once per launch cycle to avoid visual jitter.
    renderStreamingBubble();
    emitDesktopDebug('chain.electron.bubble.streaming_sentence', 'bubble streaming sentence rendered', {
      session_id: streamingState.sessionId,
      trace_id: streamingState.traceId,
      sentence_chars: text.length,
      queue_size: streamingState.sentenceQueue.length,
      visible_count: streamingState.visibleItems.length,
      visible_capacity: maxVisibleLines,
      displayed_sentences: streamingState.displayedSentences
    });
    if (streamingState.streamEnded && streamingState.sentenceQueue.length === 0) {
      ensureStreamingDrainTimer();
    }
  }

  function ensureStreamingLaunchTimer() {
    if (!streamingState.active || streamingState.launchTimer) {
      return;
    }
    const launchIntervalMs = Math.max(60, Number(bubbleRuntimeConfig.launchIntervalMs) || BUBBLE_DEFAULT_LAUNCH_INTERVAL_MS);
    streamingState.launchTimer = setInterval(() => {
      if (!streamingState.active) {
        clearInterval(streamingState.launchTimer);
        streamingState.launchTimer = null;
        return;
      }
      launchNextStreamingSentence();
      ensureStreamingDrainTimer();
      finishBubbleStreamingIfDone('interval_tick');
    }, launchIntervalMs);
  }

  function resetBubbleStreamingState({ reason = 'reset', hideBubble = false } = {}) {
    const hadActive = streamingState.active;
    if (streamingState.launchTimer) {
      clearInterval(streamingState.launchTimer);
      streamingState.launchTimer = null;
    }
    if (streamingState.drainTimer) {
      clearInterval(streamingState.drainTimer);
      streamingState.drainTimer = null;
    }
    if (streamingState.drainDelayTimer) {
      clearTimeout(streamingState.drainDelayTimer);
      streamingState.drainDelayTimer = null;
    }

    const payload = {
      session_id: streamingState.sessionId,
      trace_id: streamingState.traceId,
      reason,
      accumulated_chars: streamingState.receivedText.length,
      displayed_sentences: streamingState.displayedSentences
    };

    streamingState.active = false;
    streamingState.receivedText = '';
    streamingState.bufferedText = '';
    streamingState.sentenceQueue = [];
    streamingState.visibleItems = [];
    streamingState.lastUpdateTime = 0;
    streamingState.lastLaunchAtMs = 0;
    streamingState.avgLaunchIntervalMs = 0;
    streamingState.drainDelayApplied = false;
    streamingState.everFilledCapacity = false;
    streamingState.streamEnded = false;
    streamingState.displayedSentences = 0;
    streamingState.nextSentenceId = 1;

    if (hideBubble) {
      hideBubbleWindow();
    }

    if (hadActive) {
      emitDesktopDebug('chain.electron.bubble.streaming_reset', 'bubble streaming reset', payload);
    }
  }

  function updateBubbleStreaming(delta) {
    const currentSessionId = streamingState.sessionId;
    const currentTraceId = streamingState.traceId;
    const textDelta = String(delta || '');
    if (!textDelta) {
      return;
    }

    if (!streamingState.active) {
      streamingState.active = true;
      streamingState.receivedText = '';
      streamingState.bufferedText = '';
      streamingState.sentenceQueue = [];
      streamingState.visibleItems = [];
      streamingState.streamEnded = false;
      streamingState.displayedSentences = 0;
      streamingState.nextSentenceId = 1;
      streamingState.lastLaunchAtMs = 0;
      streamingState.avgLaunchIntervalMs = 0;
      streamingState.drainDelayApplied = false;
      streamingState.everFilledCapacity = false;
      emitDesktopDebug('chain.electron.bubble.streaming_started', 'bubble streaming started', {
        session_id: currentSessionId,
        trace_id: currentTraceId
      });
    }

    streamingState.receivedText += textDelta;
    streamingState.bufferedText += textDelta;
    streamingState.lastUpdateTime = Date.now();

    const consumed = splitCompletedSentences(streamingState.bufferedText, { flushAll: false });
    streamingState.bufferedText = consumed.rest;
    if (consumed.sentences.length > 0) {
      enqueueStreamSentences(consumed.sentences);
      emitDesktopDebug('chain.electron.bubble.streaming_update', 'bubble streaming queued sentences', {
        session_id: currentSessionId,
        trace_id: currentTraceId,
        queued_sentences: consumed.sentences.length,
        queue_size: streamingState.sentenceQueue.length,
        accumulated_chars: streamingState.receivedText.length
      });
    }

    ensureStreamingLaunchTimer();
    if (streamingState.visibleItems.length === 0) {
      launchNextStreamingSentence();
    }
  }

  function finishBubbleStreaming(finalText) {
    if (!streamingState.active) {
      return;
    }

    const normalizedFinal = String(finalText || '');
    if (normalizedFinal && normalizedFinal.startsWith(streamingState.receivedText)) {
      const remainder = normalizedFinal.slice(streamingState.receivedText.length);
      if (remainder) {
        streamingState.receivedText += remainder;
        streamingState.bufferedText += remainder;
      }
    }

    const consumed = splitCompletedSentences(streamingState.bufferedText, { flushAll: true });
    streamingState.bufferedText = consumed.rest;
    if (consumed.sentences.length > 0) {
      enqueueStreamSentences(consumed.sentences);
    }
    streamingState.streamEnded = true;
    ensureStreamingLaunchTimer();
    if (streamingState.visibleItems.length === 0) {
      launchNextStreamingSentence();
    }
    ensureStreamingDrainTimer();
    finishBubbleStreamingIfDone('stream_end');
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

  function publishLipsyncTelemetry(payload = {}) {
    const normalized = normalizeLipsyncTelemetryPayload(payload);
    if (!normalized) {
      return;
    }
    emitDesktopDebug(`chain.lipsync.${normalized.event}`, 'renderer lipsync telemetry', {
      source_file: 'apps/desktop-live2d/renderer/bootstrap.js',
      ...normalized
    });
    rpcServerRef?.notify({
      method: 'desktop.event',
      params: {
        type: 'lipsync.telemetry',
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

  function persistDragZoneOverrides(dragZoneOverrides) {
    const nextRaw = upsertDesktopLive2dDragZoneOverrides(config.uiConfigPath, dragZoneOverrides, {
      defaults: DEFAULT_UI_CONFIG.interaction.dragZone
    });
    config.uiConfig.interaction = {
      ...(config.uiConfig.interaction || {}),
      ...(nextRaw.interaction || {})
    };
    config.uiConfig.interaction.dragZone = {
      ...DEFAULT_UI_CONFIG.interaction.dragZone,
      ...(config.uiConfig.interaction?.dragZone || {})
    };
    avatarUiConfig.interaction = config.uiConfig.interaction;
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
  const chatImagePreviewListener = (event, payload) => {
    if (chatWindow.isDestroyed() || event?.sender !== chatWindow.webContents) {
      return;
    }
    void openChatImagePreview(payload).catch((err) => {
      logger.warn?.('[desktop-live2d] open chat image preview failed', {
        error: err?.message || String(err || 'unknown error')
      });
    });
  };
  ipcMain.on(CHANNELS.chatImagePreviewOpen, chatImagePreviewListener);
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
      bubbleState.width = Math.max(BUBBLE_MIN_WIDTH, Number(metrics?.width) || bubbleRuntimeConfig.width);
      bubbleState.height = Math.max(BUBBLE_MIN_HEIGHT, Number(metrics?.height) || bubbleRuntimeConfig.height);
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
  const lipsyncTelemetryListener = createLipsyncTelemetryListener({
    window: avatarWindow,
    onTelemetry: publishLipsyncTelemetry
  });
  ipcMain.on(CHANNELS.lipsyncTelemetry, lipsyncTelemetryListener);

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
    },
    onSaveDragZoneOverrides: (dragZoneOverrides) => {
      persistDragZoneOverrides(dragZoneOverrides);
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
  const windowInteractivityListener = createWindowInteractivityListener({
    window: avatarWindow,
    isResizeModeEnabled: () => resizeModeEnabled
  });
  const avatarWindowInteractivityListener = (event, payload) => {
    const normalized = normalizeWindowInteractivityPayload(payload);
    if (!normalized || event?.sender !== avatarWindow.webContents) {
      return;
    }
    avatarWindowInteractive = normalized.interactive;
    windowInteractivityListener(event, normalized);
  };
  ipcMain.on(CHANNELS.windowInteractivity, avatarWindowInteractivityListener);

  const qwenTtsClient = new QwenTtsClient();
  const qwenTtsRealtimeClient = new QwenTtsRealtimeClient();
  const recentVoiceRequestIds = new Map();
  const VOICE_REQUEST_DEDUP_TTL_MS = 120000;

  const shouldSuppressDesktopDebug = (topic, meta = {}) => {
    const normalizedTopic = String(topic || '');
    const normalizedMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};

    if (normalizedTopic.startsWith('chain.electron.bubble.streaming_')) return true;
    if (normalizedTopic.startsWith('chain.lipsync.')) return true;
    if (normalizedTopic.includes('.lipsync')) return true;
    if (normalizedTopic === 'chain.renderer.voice_memory.audio_event') return true;

    if (normalizedTopic === 'chain.electron.notification.received') {
      const type = String(normalizedMeta.type || '');
      const eventName = String(normalizedMeta.event_name || '');
      if (type === 'message.delta') return true;
      if (type === 'runtime.event' && (eventName.startsWith('llm.stream.') || eventName.startsWith('tool_call.'))) {
        return true;
      }
    }

    return false;
  };

  const rendererConsoleListener = (_event, level, message, line, sourceId) => {
    const parsed = parseRendererDebugConsoleMessage(message);
    if (!parsed) {
      return;
    }
    mouthWaveformRecorder.record(`chain.renderer.${parsed.event}`, parsed.data || {});
    emitDesktopDebug(`chain.renderer.${parsed.event}`, 'renderer emitted debug marker', {
      level: Number.isFinite(Number(level)) ? Number(level) : null,
      source_line: Number.isFinite(Number(line)) ? Number(line) : null,
      source_id: sourceId ? String(sourceId) : null,
      ...(parsed.data || {})
    });
  };
  const mouthWaveformRecorder = createMouthWaveformRecorder({
    enabled: config.uiConfig?.debug?.waveformCapture?.enabled === true,
    outputDir: config.mouthWaveformDir,
    logger
  });
  avatarWindow.webContents.on('console-message', rendererConsoleListener);

  const gatewayRuntimeClient = new GatewayRuntimeClient({
    gatewayUrl: config.gatewayUrl,
    sessionId: 'desktop-live2d-chat',
    logger,
    onNotification: (desktopEvent) => {
      const notificationEventName = desktopEvent?.type === 'runtime.event'
        ? String(desktopEvent?.data?.event || desktopEvent?.data?.name || '')
        : null;
      emitDesktopDebug('chain.electron.notification.received', 'electron main received gateway notification', {
        type: desktopEvent?.type || null,
        session_id: desktopEvent?.data?.session_id || null,
        trace_id: desktopEvent?.data?.trace_id || null,
        event_name: notificationEventName
      });
      rpcServerRef?.notify({
        method: 'desktop.event',
        params: desktopEvent
      });

      //  2. 【核心改造】：新增这块透明透传网关逻辑！
      const bridgedEventName = String(desktopEvent?.data?.name || desktopEvent?.data?.event || '');
      if (desktopEvent.type === 'runtime.event' && bridgedEventName) {
        const eventName = bridgedEventName;
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
          const voicePayload = desktopEvent.data.data;
          const requestId = String(voicePayload?.request_id || voicePayload?.requestId || '').trim();
          if (requestId) {
            const now = Date.now();
            for (const [id, ts] of recentVoiceRequestIds.entries()) {
              if (!Number.isFinite(ts) || now - ts > VOICE_REQUEST_DEDUP_TTL_MS) {
                recentVoiceRequestIds.delete(id);
              }
            }
            const previousTimestamp = recentVoiceRequestIds.get(requestId);
            if (Number.isFinite(previousTimestamp) && now - previousTimestamp < VOICE_REQUEST_DEDUP_TTL_MS) {
              emitDesktopDebug('chain.electron.voice.duplicate_ignored', 'electron main ignored duplicated voice.requested', {
                request_id: requestId,
                duplicate_gap_ms: now - previousTimestamp
              });
              return;
            }
            recentVoiceRequestIds.set(requestId, now);
          }
          void processVoiceRequestedOnDesktop({
            eventPayload: voicePayload,
            ttsClient: qwenTtsClient,
            realtimeTtsClient: qwenTtsRealtimeClient,
            voiceConfig: config.uiConfig?.voice || {},
            avatarWindow,
            rpcServerRef,
            emitDebug: emitDesktopDebug,
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

      // Handle message.delta for streaming bubble output
      if (desktopEvent.type === 'message.delta') {
        const delta = String(desktopEvent.data?.delta || '');
        const currentSessionId = desktopEvent.data?.session_id;
        const currentTraceId = desktopEvent.data?.trace_id;

        // Reset streaming state if session/trace changed
        if (streamingState.active &&
            (streamingState.sessionId !== currentSessionId ||
             streamingState.traceId !== currentTraceId)) {
          resetBubbleStreamingState({ reason: 'session_or_trace_changed', hideBubble: true });
          syncChatStreamToRenderer({
            type: 'reset',
            sessionId: currentSessionId || null,
            traceId: currentTraceId || null
          });
        }

        streamingState.sessionId = currentSessionId;
        streamingState.traceId = currentTraceId;

        if (delta) {
          updateBubbleStreaming(delta);
          syncChatStreamToRenderer({
            type: 'delta',
            sessionId: currentSessionId || null,
            traceId: currentTraceId || null,
            delta
          });
        }
        return;
      }

      if (desktopEvent.type !== 'runtime.final') {
        return;
      }

      const output = String(desktopEvent.data?.output || '').trim();
      if (!output) {
        syncChatStreamToRenderer({
          type: 'reset',
          sessionId: desktopEvent?.data?.session_id || null,
          traceId: desktopEvent?.data?.trace_id || null
        });
        emitDesktopDebug('chain.electron.notification.final_empty', 'electron main received empty final output', {
          session_id: desktopEvent?.data?.session_id || null,
          trace_id: desktopEvent?.data?.trace_id || null
        });
        return;
      }

      syncChatStreamToRenderer({
        type: 'reset',
        sessionId: desktopEvent?.data?.session_id || null,
        traceId: desktopEvent?.data?.trace_id || null
      });
      appendChatMessage({
        role: 'assistant',
        text: output,
        timestamp: Date.now()
      }, 'assistant');

      const wasStreaming = streamingState.active;

      // Handle streaming vs non-streaming mode
      if (wasStreaming) {
        // Streaming mode: finish with final output
        finishBubbleStreaming(output);
      } else {
        // Non-streaming mode: show bubble directly
        showBubble({
          text: output,
          durationMs: bubbleRuntimeConfig.lineDurationMs
        });
      }

      emitDesktopDebug('chain.electron.ui.output_rendered', 'electron main rendered assistant output to chat+bubble', {
        session_id: desktopEvent?.data?.session_id || null,
        trace_id: desktopEvent?.data?.trace_id || null,
        output_chars: output.length,
        was_streaming: wasStreaming
      });
    }
  });
  function emitDesktopDebug(topic, msg, meta = {}) {
    if (shouldSuppressDesktopDebug(topic, meta)) {
      return;
    }
    void gatewayRuntimeClient.emitDebug(topic, msg, {
      source_file: 'apps/desktop-live2d/main/desktopSuite.js',
      ...(meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {})
    });
  }
  const initialSessionId = createDesktopSessionId();
  gatewayRuntimeClient.setSessionId(initialSessionId);
  emitDesktopDebug('chain.electron.session.initialized', 'electron main initialized session id', {
    session_id: initialSessionId
  });
  try {
    await gatewayRuntimeClient.ensureSession({ sessionId: initialSessionId, permissionLevel: 'high' });
    logger.info?.('[desktop-live2d] gateway_session_bootstrap_ok', { sessionId: initialSessionId });
    emitDesktopDebug('chain.electron.session.bootstrap_ok', 'electron main ensured initial session', {
      session_id: initialSessionId,
      permission_level: 'high'
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
      const text = String(payload?.text || '').trim();
      const inputImages = Array.isArray(payload?.input_images) ? payload.input_images : [];
      const isNewSession = isNewSessionCommand(text);
      const imageLabel = inputImages.length > 1 ? `[Images x${inputImages.length}]` : '[Image]';
      const userDisplayText = text && inputImages.length > 0
        ? `${text}\n${imageLabel}`
        : (text || (inputImages.length > 0 ? imageLabel : ''));
      emitDesktopDebug('chain.electron.chat_input.received', 'electron main received chat input', {
        session_id: gatewayRuntimeClient.getSessionId(),
        input_chars: text.length,
        input_images: inputImages.length,
        is_new_session_command: isNewSession
      });
      if (typeof onChatInput === 'function') {
        onChatInput(payload);
      }
      appendChatMessage({
        role: 'user',
        text: userDisplayText,
        timestamp: payload.timestamp,
        images: inputImages
      }, 'user');

      if (isNewSession) {
        emitDesktopDebug('chain.electron.session.new_command', 'electron main handling /new session command', {
          previous_session_id: gatewayRuntimeClient.getSessionId()
        });
        void gatewayRuntimeClient.createAndUseNewSession({ permissionLevel: 'high' }).then((sessionId) => {
          logger.info?.('[desktop-live2d] gateway_session_switched', { sessionId });
          emitDesktopDebug('chain.electron.session.switched', 'electron main switched to new session', {
            session_id: sessionId,
            permission_level: 'high'
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
        input_chars: text.length,
        input_images: inputImages.length
      });
      void gatewayRuntimeClient.runInput({ input: text, inputImages }).catch((err) => {
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
  syncAvatarWindowMousePassthrough();
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
      avatarWindow,
      perceptionService,
      captureStore,
      captureService
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
      'desktop.perception.displays.list',
      'desktop.capture.screen',
      'desktop.capture.region',
      'desktop.capture.get',
      'desktop.capture.delete',
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
    ipcMain.off(CHANNELS.chatImagePreviewOpen, chatImagePreviewListener);
    ipcMain.off(CHANNELS.modelBoundsUpdate, modelBoundsListener);
    ipcMain.off(CHANNELS.bubbleMetricsUpdate, bubbleMetricsListener);
    ipcMain.off(CHANNELS.actionTelemetry, actionTelemetryListener);
    ipcMain.off(CHANNELS.lipsyncTelemetry, lipsyncTelemetryListener);
    ipcMain.off(CHANNELS.windowControl, windowControlListener);
    ipcMain.off(CHANNELS.windowResizeRequest, windowResizeListener);
    ipcMain.off(CHANNELS.windowInteractivity, avatarWindowInteractivityListener);
    ipcMain.off(CHANNELS.chatInputSubmit, chatInputListener);
    avatarWindow.webContents.off('console-message', rendererConsoleListener);
    mouthWaveformRecorder.dispose();
    captureCleanupController.stop();

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
    if (imagePreviewWindow && !imagePreviewWindow.isDestroyed()) {
      imagePreviewWindow.destroy();
      imagePreviewWindow = null;
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

function normalizeChatInputImages(rawInputImages) {
  if (rawInputImages === undefined || rawInputImages === null) {
    return [];
  }
  if (!Array.isArray(rawInputImages)) {
    return null;
  }
  const normalized = [];
  for (const image of rawInputImages) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      continue;
    }
    const dataUrl = String(image.data_url || image.dataUrl || '').trim();
    if (!dataUrl || !/^data:image\//i.test(dataUrl)) {
      continue;
    }
    const mimeType = String(image.mime_type || image.mimeType || '').trim() || 'image/*';
    normalized.push({
      client_id: String(image.client_id || image.clientId || '').trim() || `img-${randomUUID().slice(0, 8)}`,
      name: String(image.name || 'image').trim() || 'image',
      mime_type: mimeType,
      size_bytes: Math.max(0, Number(image.size_bytes ?? image.sizeBytes) || 0),
      data_url: dataUrl
    });
    if (normalized.length >= 4) {
      break;
    }
  }
  return normalized;
}

function normalizeChatMessageImages(rawImages) {
  if (!Array.isArray(rawImages)) {
    return [];
  }

  const normalized = [];
  for (const image of rawImages) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      continue;
    }
    const clientId = String(image.client_id || image.clientId || '').trim();
    const name = String(image.name || 'image').trim() || 'image';
    const mimeType = String(image.mime_type || image.mimeType || '').trim() || 'image/*';
    const sizeBytes = Math.max(0, Number(image.size_bytes ?? image.sizeBytes) || 0);
    const sourceUrl = String(image.url || '').trim();
    const previewUrl = String(image.preview_url || image.previewUrl || sourceUrl).trim();
    const rawDataUrl = String(image.data_url || image.dataUrl || '').trim();
    const dataUrl = /^data:image\//i.test(rawDataUrl)
      ? rawDataUrl
      : (/^data:image\//i.test(previewUrl) ? previewUrl : '');
    normalized.push({
      clientId,
      name,
      mimeType,
      sizeBytes,
      url: sourceUrl,
      previewUrl: previewUrl || sourceUrl || dataUrl,
      dataUrl
    });
    if (normalized.length >= 8) {
      break;
    }
  }
  return normalized;
}

function resolveChatImagePreviewUrl(rawUrl, gatewayUrl) {
  const source = String(rawUrl || '').trim();
  if (!source) {
    return '';
  }
  if (/^data:image\//i.test(source) || /^https?:\/\//i.test(source) || /^file:\/\//i.test(source)) {
    return source;
  }
  if (source.startsWith('/')) {
    try {
      const resolved = new URL(source, gatewayUrl || '').toString();
      if (/^https?:\/\//i.test(resolved)) {
        return resolved;
      }
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeChatImagePreviewPayload(payload, { gatewayUrl } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const preferredSource = payload.url || payload.previewUrl || payload.preview_url || payload.dataUrl || payload.data_url;
  const imageUrl = resolveChatImagePreviewUrl(preferredSource, gatewayUrl);
  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,
    name: String(payload.name || 'image').trim() || 'image',
    mimeType: String(payload.mimeType || payload.mime_type || '').trim() || 'image/*',
    sizeBytes: Math.max(0, Number(payload.sizeBytes ?? payload.size_bytes) || 0)
  };
}

function normalizeChatInputPayload(payload) {
  const text = String(payload?.text || '').trim();
  const inputImages = normalizeChatInputImages(payload?.input_images ?? payload?.inputImages);
  if (inputImages === null) {
    return null;
  }
  if (!text && inputImages.length === 0) {
    return null;
  }

  const role = String(payload?.role || 'user').trim();
  const allowedRoles = new Set(['user', 'assistant', 'system', 'tool']);
  return {
    role: allowedRoles.has(role) ? role : 'user',
    text,
    input_images: inputImages,
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
      inputImages: normalized.input_images.length,
      source: normalized.source
    });
    if (typeof onChatInput === 'function') {
      onChatInput(normalized);
    }
  };
}

function createCaptureCleanupController({
  captureStore = null,
  intervalMs = 60 * 1000,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => Date.now()
} = {}) {
  if (!captureStore || typeof captureStore.cleanupExpiredCaptures !== 'function') {
    return {
      runOnce() {
        return { ok: false, deleted_count: 0, deleted_capture_ids: [] };
      },
      stop() {}
    };
  }

  function runOnce(referenceNow = now()) {
    const result = captureStore.cleanupExpiredCaptures(referenceNow);
    if (result.deleted_count > 0) {
      logger.info?.('[desktop-perception] cleaned expired captures', {
        deleted_count: result.deleted_count,
        deleted_capture_ids: result.deleted_capture_ids
      });
    }
    return result;
  }

  const timer = setIntervalFn(() => {
    runOnce();
  }, Math.max(1000, Number(intervalMs) || 60 * 1000));

  return {
    runOnce,
    stop() {
      clearIntervalFn(timer);
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
  avatarWindow = null,
  perceptionService = null,
  captureStore = null,
  captureService = null
}) {
  console.log(`[Desktop RPC] Received method: ${request.method}`, request.params);

  if (request.method === 'desktop.perception.displays.list') {
    return {
      displays: typeof perceptionService?.listDisplays === 'function'
        ? perceptionService.listDisplays()
        : []
    };
  }

  if (request.method === 'desktop.perception.capabilities') {
    return typeof perceptionService?.getCapabilities === 'function'
      ? perceptionService.getCapabilities()
      : {
          platform: process.platform,
          displays_available: false,
          screen_capture: false,
          region_capture: false,
          reason: 'desktop perception service unavailable'
        };
  }

  if (request.method === 'desktop.perception.permissions') {
    return typeof perceptionService?.getPermissions === 'function'
      ? perceptionService.getPermissions()
      : {
          platform: process.platform,
          displays_available: false,
          screen_capture: {
            status: 'unknown',
            requires_permission: process.platform === 'darwin',
            reason: 'desktop perception service unavailable'
          }
        };
  }

  if (request.method === 'desktop.capture.screen') {
    if (!captureService || typeof captureService.captureScreen !== 'function') {
      return { ok: false, error: 'desktop capture service unavailable' };
    }
    return captureService.captureScreen(request.params || {});
  }

  if (request.method === 'desktop.capture.region') {
    if (!captureService || typeof captureService.captureRegion !== 'function') {
      return { ok: false, error: 'desktop capture service unavailable' };
    }
    return captureService.captureRegion(request.params || {});
  }

  if (request.method === 'desktop.capture.get') {
    if (!captureStore || typeof captureStore.getCaptureRecord !== 'function') {
      return null;
    }
    const captureId = request.params?.captureId || request.params?.capture_id || '';
    return captureStore.getCaptureRecord(captureId);
  }

  if (request.method === 'desktop.capture.delete') {
    if (!captureStore || typeof captureStore.deleteCaptureRecord !== 'function') {
      return { ok: false, deleted: false };
    }
    const captureId = request.params?.captureId || request.params?.capture_id || '';
    return captureStore.deleteCaptureRecord(captureId);
  }

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
    if (resolved.method.startsWith('desktop.')) {
      const result = await handleDesktopRpcRequest({
        request: {
          method: resolved.method,
          params: resolved.params
        },
        bridge,
        rendererTimeoutMs,
        setChatPanelVisible,
        appendChatMessage,
        clearChatMessages,
        showBubble,
        avatarWindow,
        perceptionService,
        captureStore,
        captureService
      });
      return {
        ok: true,
        tool: resolved.toolName,
        result
      };
    }
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
  if (typeof win.setIgnoreMouseEvents === 'function') {
    win.setIgnoreMouseEvents(true, { forward: true });
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

function createBubbleWindow({
  BrowserWindow,
  preloadPath,
  avatarBounds,
  display,
  bubbleWidth = BUBBLE_DEFAULT_WIDTH,
  bubbleHeight = BUBBLE_DEFAULT_HEIGHT
}) {
  const bounds = computeBubbleWindowBounds({
    avatarBounds,
    bubbleWidth,
    bubbleHeight,
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
  normalizeChatMessageImages,
  normalizeChatImagePreviewPayload,
  normalizeWindowDragPayload,
  normalizeWindowControlPayload,
  normalizeChatPanelVisibilityPayload,
  normalizeChatPanelTogglePayload,
  normalizeModelBoundsPayload,
  normalizeBubbleMetricsPayload,
  normalizeActionTelemetryPayload,
  normalizeWindowResizePayload,
  normalizeWindowInteractivityPayload,
  createWindowDragListener,
  createWindowControlListener,
  createChatPanelVisibilityListener,
  buildWindowStatePayload,
  createWindowResizeListener,
  createWindowInteractivityListener,
  normalizePersistedWindowState,
  loadPersistedWindowState,
  writePersistedWindowState,
  createChatPanelToggleListener,
  createModelBoundsListener,
  createBubbleMetricsListener,
  createActionTelemetryListener,
  createChatInputListener,
  createCaptureCleanupController,
  forwardLive2dActionEvent,
  handleDesktopRpcRequest,
  isNewSessionCommand,
  createChatWindow,
  createBubbleWindow,
  computeChatWindowBounds,
  computeBubbleWindowBounds,
  computeFittedAvatarWindowBounds
};
