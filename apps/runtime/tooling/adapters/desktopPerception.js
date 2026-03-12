const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');

const { ProviderConfigStore } = require('../../config/providerConfigStore');
const { LlmProviderManager } = require('../../config/llmProviderManager');
const { ToolingError, ErrorCode } = require('../errors');

const DEFAULT_RPC_HOST = '127.0.0.1';
const DEFAULT_RPC_PORT = 17373;
const DEFAULT_TIMEOUT_MS = 4000;

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
  return trace ? `desktop-${trace}-${suffix}` : `desktop-${suffix}`;
}

function mapRpcCodeToToolingCode(rpcCode) {
  const code = Number(rpcCode);
  if (code === -32602) return ErrorCode.VALIDATION_ERROR;
  if (code === -32006 || code === -32005) return ErrorCode.PERMISSION_DENIED;
  if (code === -32003) return ErrorCode.TIMEOUT;
  return ErrorCode.RUNTIME_ERROR;
}

function sanitizeRpcParams(params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'desktop perception tool args must be an object');
  }
  const cloned = { ...params };
  delete cloned.timeoutMs;
  return cloned;
}

function invokeDesktopRpc({
  method,
  params = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  WebSocketImpl = WebSocket,
  traceId = null
} = {}) {
  if (!method) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'desktop rpc method is required');
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
      reject(new ToolingError(ErrorCode.TIMEOUT, `desktop rpc timeout after ${timeoutMs}ms`, {
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
            `desktop rpc error(${message.error.code}): ${message.error.message || 'unknown error'}`,
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
        new ToolingError(ErrorCode.RUNTIME_ERROR, `desktop rpc connection failed: ${err.message || String(err)}`, {
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
          new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop rpc connection closed before response', {
            request_id: requestId,
            method,
            trace_id: traceId || null
          })
        );
      }
    });
  });
}

function stringifyResult(value) {
  return JSON.stringify(value == null ? {} : value);
}

function createDefaultProviderSummaryLoader() {
  let manager = null;
  return () => {
    if (!manager) {
      manager = new LlmProviderManager({ store: new ProviderConfigStore() });
    }
    return manager.getConfigSummary();
  };
}

function buildAdapter(method, invokeRpc = invokeDesktopRpc) {
  return async (args = {}, context = {}) => {
    const result = await invokeRpc({
      method,
      params: args,
      traceId: context.trace_id || null
    });
    return stringifyResult(result);
  };
}

function createDesktopPerceptionAdapters({
  invokeRpc = invokeDesktopRpc,
  getLlmProviderSummary = createDefaultProviderSummaryLoader()
} = {}) {
  return {
    'desktop.perception.capabilities': async (args = {}, context = {}) => {
      const result = await invokeRpc({
        method: 'desktop.perception.capabilities',
        params: args,
        traceId: context.trace_id || null
      });
      const llmProvider = await Promise.resolve(getLlmProviderSummary());
      const hasApiKey = Boolean(llmProvider?.has_api_key);
      const screenCapture = Boolean(result?.screen_capture);
      const merged = {
        ...(result && typeof result === 'object' ? result : {}),
        desktop_inspect: screenCapture && hasApiKey,
        llm_provider: {
          active_provider: llmProvider?.active_provider || null,
          active_model: llmProvider?.active_model || null,
          has_api_key: hasApiKey
        }
      };
      if (!merged.reason && !merged.desktop_inspect && hasApiKey === false) {
        merged.reason = 'active LLM provider has no API key';
      }
      return stringifyResult(merged);
    },
    'desktop.displays.list': buildAdapter('desktop.perception.displays.list', invokeRpc),
    'desktop.windows.list': buildAdapter('desktop.perception.windows.list', invokeRpc),
    'desktop.capture.screen': buildAdapter('desktop.capture.screen', invokeRpc),
    'desktop.capture.region': buildAdapter('desktop.capture.region', invokeRpc),
    'desktop.capture.window': buildAdapter('desktop.capture.window', invokeRpc),
    'desktop.capture.delete': buildAdapter('desktop.capture.delete', invokeRpc)
  };
}

const adapters = createDesktopPerceptionAdapters();

module.exports = {
  ...adapters,
  __internal: {
    invokeDesktopRpc,
    normalizeRpcUrl,
    buildRequestId,
    mapRpcCodeToToolingCode,
    sanitizeRpcParams,
    createDefaultProviderSummaryLoader,
    createDesktopPerceptionAdapters
  }
};
