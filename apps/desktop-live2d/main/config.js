const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getRuntimePaths } = require('../../runtime/skills/runtimePaths');

const {
  PROJECT_ROOT,
  MODEL_ASSET_RELATIVE_DIR,
  MODEL_JSON_NAME,
  DEFAULT_RPC_PORT,
  DEFAULT_RENDERER_TIMEOUT_MS
} = require('./constants');
const { DEFAULT_UI_CONFIG } = require('../shared/defaultUiConfig');

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveDesktopLive2dConfig({ env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  const runtimePaths = getRuntimePaths({ env });
  const gatewayPort = toPositiveInt(env.PORT, 3000);
  const gatewayUrl = env.DESKTOP_GATEWAY_URL || `http://127.0.0.1:${gatewayPort}`;
  const rpcPort = toPositiveInt(env.DESKTOP_LIVE2D_RPC_PORT, DEFAULT_RPC_PORT);
  const hasRpcToken = typeof env.DESKTOP_LIVE2D_RPC_TOKEN === 'string' && env.DESKTOP_LIVE2D_RPC_TOKEN.trim().length > 0;
  const rpcToken = hasRpcToken ? env.DESKTOP_LIVE2D_RPC_TOKEN : randomUUID();
  if (!hasRpcToken && env === process.env) {
    // Keep runtime live2d adapter and desktop rpc server on the same token when token is auto-generated.
    process.env.DESKTOP_LIVE2D_RPC_TOKEN = rpcToken;
  }
  const rendererTimeoutMs = toPositiveInt(env.DESKTOP_LIVE2D_RENDERER_TIMEOUT_MS, DEFAULT_RENDERER_TIMEOUT_MS);
  const uiConfigPath = path.resolve(
    env.DESKTOP_LIVE2D_CONFIG_PATH || path.join(runtimePaths.configDir, 'desktop-live2d.json')
  );
  const uiConfig = loadDesktopLive2dUiConfig(uiConfigPath, {
    templatePath: path.resolve(projectRoot, 'config', 'desktop-live2d.json')
  });

  return {
    projectRoot,
    modelDir: path.join(projectRoot, MODEL_ASSET_RELATIVE_DIR),
    modelJsonName: MODEL_JSON_NAME,
    modelRelativePath: toPortablePath(path.join('..', '..', '..', MODEL_ASSET_RELATIVE_DIR, MODEL_JSON_NAME)),
    runtimeSummaryPath: path.resolve(
      env.DESKTOP_LIVE2D_RUNTIME_SUMMARY_PATH || path.join(runtimePaths.dataDir, 'desktop-live2d', 'runtime-summary.json')
    ),
    windowStatePath: path.resolve(
      env.DESKTOP_LIVE2D_WINDOW_STATE_PATH || path.join(runtimePaths.dataDir, 'desktop-live2d', 'window-state.json')
    ),
    importBackupRoot: path.resolve(
      env.DESKTOP_LIVE2D_BACKUP_ROOT || path.join(runtimePaths.dataDir, 'backups', 'live2d')
    ),
    rpcHost: '127.0.0.1',
    rpcPort,
    rpcToken,
    rendererTimeoutMs,
    uiConfigPath,
    uiConfig,
    gatewayExternal: env.DESKTOP_EXTERNAL_GATEWAY === '1',
    gatewayHost: env.HOST || '127.0.0.1',
    gatewayPort,
    gatewayUrl
  };
}

function loadDesktopLive2dUiConfig(configPath, { templatePath } = {}) {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (templatePath && fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, configPath);
    }
  }

  if (!fs.existsSync(configPath)) {
    return JSON.parse(JSON.stringify(DEFAULT_UI_CONFIG));
  }

  const raw = parseJsonWithComments(fs.readFileSync(configPath, 'utf8'));
  return normalizeUiConfig(raw);
}

function parseJsonWithComments(input) {
  return JSON.parse(stripJsonComments(String(input || '')));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let stringQuote = '';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === '\\') {
        escaped = true;
        continue;
      }
      if (current === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if ((current === '"' || current === '\'' || current === '`')) {
      inString = true;
      stringQuote = current;
      output += current;
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function normalizeUiConfig(raw) {
  const rawVoice = isPlainObject(raw?.voice) ? raw.voice : {};
  const rawRealtimeVoice = isPlainObject(rawVoice.realtime) ? rawVoice.realtime : {};
  const merged = {
    window: {
      ...DEFAULT_UI_CONFIG.window,
      ...(raw?.window || {}),
      placement: {
        ...DEFAULT_UI_CONFIG.window.placement,
        ...(raw?.window?.placement || {})
      }
    },
    render: {
      ...DEFAULT_UI_CONFIG.render,
      ...(raw?.render || {})
    },
    layout: {
      ...DEFAULT_UI_CONFIG.layout,
      ...(raw?.layout || {})
    },
    chat: {
      panel: {
        ...DEFAULT_UI_CONFIG.chat.panel,
        ...(raw?.chat?.panel || {})
      },
      bubble: {
        ...DEFAULT_UI_CONFIG.chat.bubble,
        ...(raw?.chat?.bubble || {}),
        stream: {
          ...DEFAULT_UI_CONFIG.chat.bubble.stream,
          ...(
            raw?.chat?.bubble?.stream
            && typeof raw.chat.bubble.stream === 'object'
            && !Array.isArray(raw.chat.bubble.stream)
              ? raw.chat.bubble.stream
              : {}
          )
        }
      }
    },
    debug: {
      ...DEFAULT_UI_CONFIG.debug,
      ...(raw?.debug || {}),
      mouthTuner: {
        ...DEFAULT_UI_CONFIG.debug.mouthTuner,
        ...(raw?.debug?.mouthTuner || {})
      }
    },
    actionQueue: {
      ...DEFAULT_UI_CONFIG.actionQueue,
      ...(raw?.actionQueue || {}),
      idleAction: {
        ...DEFAULT_UI_CONFIG.actionQueue.idleAction,
        ...(raw?.actionQueue?.idleAction || {}),
        args: {
          ...DEFAULT_UI_CONFIG.actionQueue.idleAction.args,
          ...(raw?.actionQueue?.idleAction?.args || {})
        }
      }
    },
    voice: {
      ...DEFAULT_UI_CONFIG.voice,
      ...rawVoice,
      realtime: {
        ...DEFAULT_UI_CONFIG.voice.realtime,
        ...rawRealtimeVoice
      }
    }
  };

  merged.window.width = toPositiveInt(merged.window.width, DEFAULT_UI_CONFIG.window.width);
  merged.window.height = toPositiveInt(merged.window.height, DEFAULT_UI_CONFIG.window.height);
  merged.window.minWidth = toPositiveInt(merged.window.minWidth, DEFAULT_UI_CONFIG.window.minWidth);
  merged.window.minHeight = toPositiveInt(merged.window.minHeight, DEFAULT_UI_CONFIG.window.minHeight);
  merged.window.maxWidth = toPositiveInt(merged.window.maxWidth, DEFAULT_UI_CONFIG.window.maxWidth);
  merged.window.maxHeight = toPositiveInt(merged.window.maxHeight, DEFAULT_UI_CONFIG.window.maxHeight);
  merged.window.compactWhenChatHidden = merged.window.compactWhenChatHidden !== false;
  merged.window.compactWidth = toPositiveInt(merged.window.compactWidth, DEFAULT_UI_CONFIG.window.compactWidth);
  merged.window.compactHeight = toPositiveInt(merged.window.compactHeight, DEFAULT_UI_CONFIG.window.compactHeight);
  merged.window.placement.anchor = String(merged.window.placement.anchor || 'bottom-right');
  merged.window.placement.marginRight = toPositiveInt(merged.window.placement.marginRight, DEFAULT_UI_CONFIG.window.placement.marginRight);
  merged.window.placement.marginBottom = toPositiveInt(merged.window.placement.marginBottom, DEFAULT_UI_CONFIG.window.placement.marginBottom);

  merged.render.resolutionScale = toFiniteNumber(merged.render.resolutionScale, DEFAULT_UI_CONFIG.render.resolutionScale);
  merged.render.maxDevicePixelRatio = toFiniteNumber(merged.render.maxDevicePixelRatio, DEFAULT_UI_CONFIG.render.maxDevicePixelRatio);
  merged.render.antialias = Boolean(merged.render.antialias);

  const layoutDefaults = DEFAULT_UI_CONFIG.layout;
  for (const key of Object.keys(layoutDefaults)) {
    if (key === 'lockScaleOnResize' || key === 'lockPositionOnResize') {
      merged.layout[key] = merged.layout[key] !== false;
      continue;
    }
    merged.layout[key] = toFiniteNumber(merged.layout[key], layoutDefaults[key]);
  }

  merged.chat.panel.enabled = Boolean(merged.chat.panel.enabled);
  merged.chat.panel.defaultVisible = Boolean(merged.chat.panel.defaultVisible);
  merged.chat.panel.width = toPositiveInt(merged.chat.panel.width, DEFAULT_UI_CONFIG.chat.panel.width);
  merged.chat.panel.height = toPositiveInt(merged.chat.panel.height, DEFAULT_UI_CONFIG.chat.panel.height);
  merged.chat.panel.maxMessages = toPositiveInt(merged.chat.panel.maxMessages, DEFAULT_UI_CONFIG.chat.panel.maxMessages);
  merged.chat.panel.inputEnabled = Boolean(merged.chat.panel.inputEnabled);
  merged.chat.bubble.mirrorToPanel = Boolean(merged.chat.bubble.mirrorToPanel);
  merged.chat.bubble.width = toPositiveInt(merged.chat.bubble.width, DEFAULT_UI_CONFIG.chat.bubble.width);
  merged.chat.bubble.height = toPositiveInt(merged.chat.bubble.height, DEFAULT_UI_CONFIG.chat.bubble.height);
  merged.chat.bubble.stream.lineDurationMs = toPositiveInt(
    merged.chat.bubble.stream.lineDurationMs,
    DEFAULT_UI_CONFIG.chat.bubble.stream.lineDurationMs
  );
  merged.chat.bubble.stream.launchIntervalMs = toPositiveInt(
    merged.chat.bubble.stream.launchIntervalMs,
    DEFAULT_UI_CONFIG.chat.bubble.stream.launchIntervalMs
  );
  merged.debug.mouthTuner.visible = Boolean(merged.debug.mouthTuner.visible);
  merged.debug.mouthTuner.enabled = Boolean(merged.debug.mouthTuner.enabled);

  merged.actionQueue.maxQueueSize = toPositiveInt(
    merged.actionQueue.maxQueueSize,
    DEFAULT_UI_CONFIG.actionQueue.maxQueueSize
  );
  const overflowPolicy = String(merged.actionQueue.overflowPolicy || '').trim().toLowerCase();
  merged.actionQueue.overflowPolicy = ['drop_oldest', 'drop_newest', 'reject'].includes(overflowPolicy)
    ? overflowPolicy
    : DEFAULT_UI_CONFIG.actionQueue.overflowPolicy;
  merged.actionQueue.idleFallbackEnabled = merged.actionQueue.idleFallbackEnabled !== false;
  merged.actionQueue.idleAction.type = String(merged.actionQueue.idleAction.type || 'motion').trim().toLowerCase() || 'motion';
  merged.actionQueue.idleAction.name = String(merged.actionQueue.idleAction.name || '').trim()
    || DEFAULT_UI_CONFIG.actionQueue.idleAction.name;
  merged.actionQueue.idleAction.args = (
    merged.actionQueue.idleAction.args && typeof merged.actionQueue.idleAction.args === 'object' && !Array.isArray(merged.actionQueue.idleAction.args)
      ? merged.actionQueue.idleAction.args
      : {}
  );
  if (merged.actionQueue.idleAction.type === 'motion') {
    merged.actionQueue.idleAction.args.group = String(
      merged.actionQueue.idleAction.args.group || merged.actionQueue.idleAction.name || 'Idle'
    ).trim() || 'Idle';
    if (Object.prototype.hasOwnProperty.call(merged.actionQueue.idleAction.args, 'index')) {
      const parsed = Number(merged.actionQueue.idleAction.args.index);
      if (Number.isInteger(parsed) && parsed >= 0) {
        merged.actionQueue.idleAction.args.index = parsed;
      } else {
        delete merged.actionQueue.idleAction.args.index;
      }
    }
  } else if (merged.actionQueue.idleAction.type === 'expression') {
    merged.actionQueue.idleAction.args = {};
  }

  const voicePath = String(merged.voice.path || '').trim();
  merged.voice.path = ['electron_native', 'runtime_legacy'].includes(voicePath)
    ? voicePath
    : DEFAULT_UI_CONFIG.voice.path;

  const voiceTransport = String(merged.voice.transport || '').trim();
  merged.voice.transport = ['non_streaming', 'realtime'].includes(voiceTransport)
    ? voiceTransport
    : DEFAULT_UI_CONFIG.voice.transport;

  const fallbackOnRealtimeError = Object.prototype.hasOwnProperty.call(rawVoice, 'fallback_on_realtime_error')
    ? rawVoice.fallback_on_realtime_error
    : merged.voice.fallbackOnRealtimeError;
  merged.voice.fallbackOnRealtimeError = fallbackOnRealtimeError !== false;

  const prebufferMs = Object.prototype.hasOwnProperty.call(rawRealtimeVoice, 'prebuffer_ms')
    ? rawRealtimeVoice.prebuffer_ms
    : merged.voice.realtime.prebufferMs;
  merged.voice.realtime.prebufferMs = toPositiveInt(prebufferMs, DEFAULT_UI_CONFIG.voice.realtime.prebufferMs);

  const idleTimeoutMs = Object.prototype.hasOwnProperty.call(rawRealtimeVoice, 'idle_timeout_ms')
    ? rawRealtimeVoice.idle_timeout_ms
    : merged.voice.realtime.idleTimeoutMs;
  merged.voice.realtime.idleTimeoutMs = toPositiveInt(
    idleTimeoutMs,
    DEFAULT_UI_CONFIG.voice.realtime.idleTimeoutMs
  );

  return merged;
}

function roundLayoutOverrideValue(key, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (key === 'offsetX' || key === 'offsetY') {
    return Math.round(parsed);
  }
  if (key === 'scaleMultiplier') {
    return Math.round(parsed * 1000) / 1000;
  }
  return parsed;
}

function upsertDesktopLive2dLayoutOverrides(configPath, overrides = {}, { defaults = DEFAULT_UI_CONFIG.layout } = {}) {
  const currentRaw = fs.existsSync(configPath)
    ? parseJsonWithComments(fs.readFileSync(configPath, 'utf8'))
    : {};
  const nextRaw = isPlainObject(currentRaw) ? { ...currentRaw } : {};
  const nextLayout = isPlainObject(nextRaw.layout) ? { ...nextRaw.layout } : {};

  for (const key of ['offsetX', 'offsetY', 'scaleMultiplier']) {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
      continue;
    }
    const rounded = roundLayoutOverrideValue(key, overrides[key]);
    if (rounded === null) {
      continue;
    }
    const defaultValue = roundLayoutOverrideValue(key, defaults[key]);
    if (rounded === defaultValue) {
      delete nextLayout[key];
    } else {
      nextLayout[key] = rounded;
    }
  }

  if (Object.keys(nextLayout).length === 0) {
    delete nextRaw.layout;
  } else {
    nextRaw.layout = nextLayout;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, serializeDesktopLive2dUiConfig(nextRaw), 'utf8');
  return nextRaw;
}

function serializeDesktopLive2dUiConfig(raw = {}) {
  const safe = isPlainObject(raw) ? raw : {};
  const orderedKeys = [];
  const preferredOrder = ['window', 'layout', 'render', 'chat', 'actionQueue'];

  for (const key of preferredOrder) {
    if (isPlainObject(safe[key])) {
      orderedKeys.push(key);
    }
  }
  for (const key of Object.keys(safe)) {
    if (!orderedKeys.includes(key) && safe[key] !== undefined) {
      orderedKeys.push(key);
    }
  }

  if (orderedKeys.length === 0) {
    return '{\n}\n';
  }

  const comments = {
    window: 'Window overrides. Delete any field here to fall back to shared defaults.',
    layout: 'Layout tuner overrides. These are the direct controls for avatar placement.'
  };

  const sections = orderedKeys.map((key) => {
    const value = safe[key];
    const valueLines = JSON.stringify(value, null, 2).split('\n');
    const lines = [];
    if (comments[key]) {
      lines.push(`  // ${comments[key]}`);
    }
    lines.push(`  "${key}": ${valueLines[0]}`);
    for (const line of valueLines.slice(1)) {
      lines.push(`  ${line}`);
    }
    return lines.join('\n');
  });

  return `{\n${sections.join(',\n')}\n}\n`;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join('/');
}

module.exports = {
  resolveDesktopLive2dConfig,
  loadDesktopLive2dUiConfig,
  normalizeUiConfig,
  parseJsonWithComments,
  upsertDesktopLive2dLayoutOverrides,
  serializeDesktopLive2dUiConfig,
  stripJsonComments,
  toPositiveInt,
  DEFAULT_UI_CONFIG
};
