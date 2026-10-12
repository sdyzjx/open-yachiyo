const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const YAML = require('yaml');

const { ToolingError, ErrorCode } = require('../errors');
const {
  ACTION_EVENT_NAME,
  normalizeLive2dActionMessage
} = require('../../../desktop-live2d/shared/live2dActionMessage');

const DEFAULT_RPC_HOST = '127.0.0.1';
const DEFAULT_RPC_PORT = 17373;
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_ACTION_COOLDOWN_MS = 250;
const DEFAULT_ACTION_DURATION_SEC_BY_TYPE = Object.freeze({
  expression: 1.4,
  motion: 1.8,
  gesture: 2.2,
  emote: 2.0,
  react: 2.4
});

const DEFAULT_PRESET_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'config', 'live2d-presets.yaml');
const TEMPLATE_PRESET_PATH = DEFAULT_PRESET_PATH;

function normalizeRpcUrl({ host = DEFAULT_RPC_HOST, port = DEFAULT_RPC_PORT, token = '' } = {}) {
  const safeHost = String(host || DEFAULT_RPC_HOST).trim() || DEFAULT_RPC_HOST;
  const safePort = Number(port) > 0 ? Number(port) : DEFAULT_RPC_PORT;
  const url = new URL(`ws://${safeHost}:${safePort}`);
  if (token) {
    url.searchParams.set('token', String(token));
  }
  return url.toString();
}

function buildRequestId(traceId) {
  const trace = String(traceId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  return trace ? `live2d-${trace}-${suffix}` : `live2d-${suffix}`;
}

function mapRpcCodeToToolingCode(rpcCode) {
  const code = Number(rpcCode);
  if (code === -32602) return ErrorCode.VALIDATION_ERROR;
  if (code === -32006) return ErrorCode.PERMISSION_DENIED;
  if (code === -32003) return ErrorCode.TIMEOUT;
  return ErrorCode.RUNTIME_ERROR;
}

function sanitizeRpcParams(params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'live2d tool args must be an object');
  }

  const cloned = { ...params };
  delete cloned.timeoutMs;
  return cloned;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function ensurePresetFileExists(presetPath = DEFAULT_PRESET_PATH) {
  if (fs.existsSync(presetPath)) return presetPath;
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  if (fs.existsSync(TEMPLATE_PRESET_PATH)) {
    fs.copyFileSync(TEMPLATE_PRESET_PATH, presetPath);
    return presetPath;
  }
  throw new ToolingError(ErrorCode.CONFIG_ERROR, `live2d preset template missing: ${TEMPLATE_PRESET_PATH}`);
}

function loadLive2dPresetConfig(presetPath = DEFAULT_PRESET_PATH) {
  const filePath = ensurePresetFileExists(presetPath);
  const raw = YAML.parse(fs.readFileSync(filePath, 'utf8')) || {};
  return normalizeLive2dPresetConfig(raw);
}

function normalizeLive2dPresetConfig(config = {}) {
  const normalized = {
    version: Number(config.version || 1),
    emote: config.emote && typeof config.emote === 'object' ? config.emote : {},
    gesture: config.gesture && typeof config.gesture === 'object' ? config.gesture : {},
    react: config.react && typeof config.react === 'object' ? config.react : {}
  };
  return normalized;
}

function invokeLive2dRpc({ method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env, WebSocketImpl = WebSocket, traceId = null } = {}) {
  if (!method) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'live2d rpc method is required');
  }

  const hub = require('../../../gateway/deviceHub').getDeviceHub();
  if (hub.getAvatarHost() !== 'desktop') {
    return hub.invoke(hub.getAvatarHost(), method, sanitizeRpcParams(params), { timeoutMs }).catch((err) => {
      throw new ToolingError(mapRpcCodeToToolingCode(err.code), err.message, { rpcError: { code: err.code }, method, trace_id: traceId });
    });
  }

  const rpcUrl = normalizeRpcUrl({
    host: env.DESKTOP_LIVE2D_RPC_HOST || DEFAULT_RPC_HOST,
    port: env.DESKTOP_LIVE2D_RPC_PORT || DEFAULT_RPC_PORT,
    token: env.DESKTOP_LIVE2D_RPC_TOKEN || ''
  });

  const requestId = buildRequestId(traceId);
  const payload = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params: sanitizeRpcParams(params)
  };

  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(rpcUrl);
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      reject(new ToolingError(ErrorCode.TIMEOUT, `live2d rpc timeout after ${timeoutMs}ms`, {
        request_id: requestId,
        method,
        trace_id: traceId || null
      }));
    }, Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      fn(value);
    };

    ws.on('open', () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (message?.id !== requestId) return;

      if (message.error) {
        finish(
          reject,
          new ToolingError(
            mapRpcCodeToToolingCode(message.error.code),
            `live2d rpc error(${message.error.code}): ${message.error.message || 'unknown error'}`,
            {
              request_id: requestId,
              method,
              trace_id: traceId || null,
              rpcError: message.error
            }
          )
        );
        return;
      }

      finish(resolve, message.result || null);
    });

    ws.on('error', (err) => {
      finish(
        reject,
        new ToolingError(ErrorCode.RUNTIME_ERROR, `live2d rpc connection failed: ${err.message || String(err)}`, {
          request_id: requestId,
          method,
          trace_id: traceId || null
        })
      );
    });

    ws.on('close', () => {
      if (!settled) {
        finish(
          reject,
          new ToolingError(ErrorCode.RUNTIME_ERROR, 'live2d rpc connection closed before response', {
            request_id: requestId,
            method,
            trace_id: traceId || null
          })
        );
      }
    });
  });
}

function createActionQueue() {
  const state = new Map();

  function getBucket(key) {
    if (!state.has(key)) {
      state.set(key, { tail: Promise.resolve(), pending: 0 });
    }
    return state.get(key);
  }

  async function run(key, task, policy = 'enqueue') {
    const bucket = getBucket(key);

    if (policy === 'drop_if_busy' && bucket.pending > 0) {
      throw new ToolingError(ErrorCode.RUNTIME_ERROR, `live2d action queue busy for ${key}`);
    }

    bucket.pending += 1;
    const runTask = async () => {
      try {
        return await task();
      } finally {
        bucket.pending = Math.max(0, bucket.pending - 1);
      }
    };

    const wrapped = bucket.tail.then(runTask, runTask);
    bucket.tail = wrapped.catch(() => undefined);
    return wrapped;
  }

  return { run };
}

function toActionStep(step) {
  if (!step || typeof step !== 'object') {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'react step must be an object');
  }

  if (step.type === 'wait') {
    return { type: 'wait', ms: Math.max(0, Number(step.ms) || 0) };
  }

  if (step.type === 'expression') {
    return { type: 'rpc', method: 'model.expression.set', params: { name: String(step.name || '') }, isAction: true };
  }

  if (step.type === 'motion') {
    const params = { group: String(step.group || '') };
    if (step.index != null) params.index = Number(step.index);
    return { type: 'rpc', method: 'model.motion.play', params, isAction: true };
  }

  if (step.type === 'param_batch') {
    return { type: 'rpc', method: 'model.param.batchSet', params: { updates: Array.isArray(step.updates) ? step.updates : [] }, isAction: false };
  }

  throw new ToolingError(ErrorCode.VALIDATION_ERROR, `unsupported react step type: ${step.type}`);
}

function resolveEmotePlan(args, presetConfig) {
  const emotion = String(args.emotion || '').trim();
  const intensity = String(args.intensity || 'medium').trim();
  if (!emotion) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'live2d.emote requires non-empty emotion');
  }
  const emotionDef = presetConfig.emote?.[emotion];
  const picked = emotionDef?.[intensity] || emotionDef?.medium || null;
  if (!picked) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `live2d.emote preset not found: ${emotion}/${intensity}`);
  }

  const steps = [];
  if (picked.expression) {
    steps.push({ type: 'rpc', method: 'model.expression.set', params: { name: String(picked.expression) }, isAction: true });
  }
  if (Array.isArray(picked.params) && picked.params.length > 0) {
    steps.push({ type: 'rpc', method: 'model.param.batchSet', params: { updates: picked.params }, isAction: false });
  }
  return steps;
}

function resolveGesturePlan(args, presetConfig) {
  const type = String(args.type || '').trim();
  if (!type) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'live2d.gesture requires non-empty type');
  }
  const def = presetConfig.gesture?.[type];
  if (!def) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `live2d.gesture preset not found: ${type}`);
  }

  const steps = [];
  if (def.expression) {
    steps.push({ type: 'rpc', method: 'model.expression.set', params: { name: String(def.expression) }, isAction: true });
  }
  if (def.motion && def.motion.group) {
    const params = { group: String(def.motion.group) };
    if (def.motion.index != null) params.index = Number(def.motion.index);
    steps.push({ type: 'rpc', method: 'model.motion.play', params, isAction: true });
  }
  return steps;
}

function resolveReactPlan(args, presetConfig) {
  const intent = String(args.intent || '').trim();
  if (!intent) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'live2d.react requires non-empty intent');
  }
  const def = presetConfig.react?.[intent];
  if (!Array.isArray(def) || def.length === 0) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `live2d.react preset not found: ${intent}`);
  }
  return def.map(toActionStep);
}

function parseActionDurationSec(args = {}, actionType = 'expression') {
  const rawDuration = Object.prototype.hasOwnProperty.call(args, 'duration_sec')
    ? args.duration_sec
    : args.durationSec;
  if (rawDuration == null) {
    return DEFAULT_ACTION_DURATION_SEC_BY_TYPE[actionType] || DEFAULT_ACTION_DURATION_SEC_BY_TYPE.expression;
  }
  return Number(rawDuration);
}

function resolveActionQueuePolicy(args = {}) {
  return args.queue_policy || args.queuePolicy || 'append';
}

function resolveActionId(args = {}, traceId = null) {
  return args.action_id || args.actionId || buildRequestId(traceId);
}

function buildLive2dActionEventPayload({ method, args = {}, traceId = null } = {}) {
  let action = null;
  let actionType = 'expression';

  if (method === 'model.expression.set') {
    action = {
      type: 'expression',
      name: String(args.name || ''),
      args: {}
    };
    actionType = 'expression';
  } else if (method === 'model.motion.play') {
    const nextArgs = {
      group: String(args.group || '')
    };
    if (Object.prototype.hasOwnProperty.call(args, 'index')) {
      nextArgs.index = args.index;
    }
    action = {
      type: 'motion',
      name: String(args.group || ''),
      args: nextArgs
    };
    actionType = 'motion';
  }

  if (!action) {
    return null;
  }

  const normalized = normalizeLive2dActionMessage({
    action_id: resolveActionId(args, traceId),
    action,
    duration_sec: parseActionDurationSec(args, actionType),
    queue_policy: resolveActionQueuePolicy(args)
  });

  if (!normalized.ok) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, normalized.error);
  }

  return normalized.value;
}

function resolveSemanticActionName(actionType, args = {}) {
  if (actionType === 'emote') {
    return String(args.emotion || args.name || '').trim();
  }
  if (actionType === 'gesture') {
    return String(args.type || args.name || '').trim();
  }
  if (actionType === 'react') {
    return String(args.intent || args.name || '').trim();
  }
  return String(args.name || '').trim();
}

function resolveSemanticActionArgs(actionType, args = {}) {
  if (actionType === 'emote') {
    return {
      emotion: String(args.emotion || '').trim(),
      intensity: String(args.intensity || 'medium').trim()
    };
  }
  if (actionType === 'gesture') {
    return {
      type: String(args.type || '').trim()
    };
  }
  if (actionType === 'react') {
    return {
      intent: String(args.intent || '').trim()
    };
  }
  return {};
}

function buildSemanticActionEventPayload({
  actionType,
  args = {},
  traceId = null,
  validatePreset = null
} = {}) {
  const type = String(actionType || '').trim().toLowerCase();
  if (!['emote', 'gesture', 'react'].includes(type)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `unsupported semantic action type: ${type || '<empty>'}`);
  }

  if (typeof validatePreset === 'function') {
    validatePreset();
  }

  const actionName = resolveSemanticActionName(type, args);
  const actionArgs = resolveSemanticActionArgs(type, args);
  const normalized = normalizeLive2dActionMessage({
    action_id: resolveActionId(args, traceId),
    action: {
      type,
      name: actionName,
      args: actionArgs
    },
    duration_sec: parseActionDurationSec(args, type),
    queue_policy: resolveActionQueuePolicy(args)
  });

  if (!normalized.ok) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, normalized.error);
  }

  return normalized.value;
}

function createLive2dAdapters({
  invokeRpc = invokeLive2dRpc,
  now = () => Date.now(),
  sleepFn = sleep,
  actionCooldownMs = Math.max(0, Number(process.env.LIVE2D_ACTION_COOLDOWN_MS || DEFAULT_ACTION_COOLDOWN_MS)),
  actionQueuePolicy = String(process.env.LIVE2D_ACTION_QUEUE_POLICY || 'enqueue').trim() || 'enqueue',
  presetConfig = loadLive2dPresetConfig(process.env.LIVE2D_PRESETS_PATH || DEFAULT_PRESET_PATH)
} = {}) {
  const actionQueue = createActionQueue();
  const lastActionAt = new Map();

  async function runRpcStep({ method, params, isAction, timeoutMs, traceId, sessionKey }) {
    if (isAction && actionCooldownMs > 0) {
      const prev = Number(lastActionAt.get(sessionKey) || 0);
      const waitMs = prev + actionCooldownMs - Number(now());
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    }

    const result = await invokeRpc({
      method,
      params,
      timeoutMs,
      env: process.env,
      traceId
    });

    if (isAction) {
      lastActionAt.set(sessionKey, Number(now()));
    }

    return result;
  }

  function withLive2dMethod(method, { isAction = false } = {}) {
    return async (args = {}, context = {}) => {
      const timeoutMs = Math.max(500, Number(args.timeoutMs || context.timeoutMs || DEFAULT_TIMEOUT_MS));
      const traceId = context.trace_id || null;
      const sessionKey = String(context.session_id || 'global');
      const actionEventPayload = isAction
        ? buildLive2dActionEventPayload({ method, args, traceId })
        : null;

      const executeOnce = async () => {
        if (actionEventPayload && typeof context.publishEvent === 'function') {
          context.publishEvent(ACTION_EVENT_NAME, actionEventPayload);
          return JSON.stringify({
            ok: true,
            mode: 'event',
            topic: ACTION_EVENT_NAME,
            action_id: actionEventPayload.action_id
          });
        }

        const result = await runRpcStep({
          method,
          params: args,
          isAction,
          timeoutMs,
          traceId,
          sessionKey
        });
        return JSON.stringify({ ok: true, method, result });
      };

      if (!isAction) {
        return executeOnce();
      }

      return actionQueue.run(sessionKey, executeOnce, actionQueuePolicy);
    };
  }

  function withSemanticTool(name, resolver) {
    return async (args = {}, context = {}) => {
      const timeoutMs = Math.max(500, Number(args.timeoutMs || context.timeoutMs || DEFAULT_TIMEOUT_MS));
      const traceId = context.trace_id || null;
      const sessionKey = String(context.session_id || 'global');
      const actionType = String(name || '').replace(/^live2d\./, '').trim();
      const steps = resolver(args, presetConfig);
      const semanticEventPayload = buildSemanticActionEventPayload({
        actionType,
        args,
        traceId
      });

      const executePlan = async () => {
        if (typeof context.publishEvent === 'function') {
          context.publishEvent(ACTION_EVENT_NAME, semanticEventPayload);
          return JSON.stringify({
            ok: true,
            mode: 'event',
            topic: ACTION_EVENT_NAME,
            action_id: semanticEventPayload.action_id
          });
        }

        const trace = [];
        for (const step of steps) {
          if (step.type === 'wait') {
            await sleepFn(step.ms);
            trace.push({ type: 'wait', ms: step.ms });
            continue;
          }
          const result = await runRpcStep({
            method: step.method,
            params: step.params,
            isAction: step.isAction,
            timeoutMs,
            traceId,
            sessionKey
          });
          trace.push({ type: 'rpc', method: step.method, result });
        }
        return JSON.stringify({ ok: true, tool: name, steps: trace.length, trace });
      };

      return actionQueue.run(sessionKey, executePlan, actionQueuePolicy);
    };
  }

  return {
    'live2d.param.set': withLive2dMethod('model.param.set', { isAction: false }),
    'live2d.param.batch_set': withLive2dMethod('model.param.batchSet', { isAction: false }),
    'live2d.motion.play': withLive2dMethod('model.motion.play', { isAction: true }),
    'live2d.expression.set': withLive2dMethod('model.expression.set', { isAction: true }),
    'live2d.emote': withSemanticTool('live2d.emote', resolveEmotePlan),
    'live2d.gesture': withSemanticTool('live2d.gesture', resolveGesturePlan),
    'live2d.react': withSemanticTool('live2d.react', resolveReactPlan),
    __internal: {
      invokeRpc,
      actionQueue,
      lastActionAt,
      actionCooldownMs,
      actionQueuePolicy,
      presetConfig
    }
  };
}

const live2dAdapters = createLive2dAdapters();

module.exports = {
  ...live2dAdapters,
  __internal: {
    invokeLive2dRpc,
    normalizeRpcUrl,
    buildRequestId,
    mapRpcCodeToToolingCode,
    sanitizeRpcParams,
    createActionQueue,
    createLive2dAdapters,
    resolveEmotePlan,
    resolveGesturePlan,
    resolveReactPlan,
    buildLive2dActionEventPayload,
    buildSemanticActionEventPayload,
    toActionStep,
    loadLive2dPresetConfig,
    normalizeLive2dPresetConfig,
    ...live2dAdapters.__internal
  }
};
