const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const WebSocket = require('ws');

const { ToolingError, ErrorCode } = require('../errors');

const DEFAULT_RPC_HOST = '127.0.0.1';
const DEFAULT_RPC_PORT = 17373;
const DEFAULT_TIMEOUT_MS = 4000;
const ALLOWED_MUSIC_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.webm']);

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
  const suffix = require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 12);
  return trace ? `music-${trace}-${suffix}` : `music-${suffix}`;
}

function mapRpcCodeToToolingCode(rpcError) {
  const code = Number(rpcError?.code ?? rpcError);
  if (code === -32602) return ErrorCode.VALIDATION_ERROR;
  if (code === -32006) return ErrorCode.PERMISSION_DENIED;
  if (code === -32003) return ErrorCode.TIMEOUT;
  return ErrorCode.RUNTIME_ERROR;
}

function sanitizeRpcParams(params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'music tool args must be an object');
  }

  const cloned = { ...params };
  delete cloned.timeoutMs;
  return cloned;
}

function normalizeVolume(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
}

function resolveWorkspaceRoot(context = {}) {
  const root = String(context.workspaceRoot || context.workspace_root || process.cwd() || '').trim();
  if (!root) {
    throw new ToolingError(ErrorCode.CONFIG_ERROR, 'workspace root is required for music playback');
  }
  return path.resolve(root);
}

function ensureRelativeMusicInput(input) {
  const value = String(input || '').trim();
  if (!value) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'music path is required');
  }
  if (/^file:\/\//i.test(value) || path.isAbsolute(value)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'music path must be relative to workspace root');
  }
  return value;
}

function resolveMusicPath(rawPath, workspaceRoot) {
  const input = String(rawPath || '').trim();
  if (!input) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'music path is required');
  }

  const resolvedWorkspaceRoot = path.resolve(workspaceRoot || process.cwd());
  let absolutePath;
  if (/^file:\/\//i.test(input)) {
    absolutePath = path.resolve(fileURLToPath(new URL(input)));
  } else if (path.isAbsolute(input)) {
    absolutePath = path.resolve(input);
  } else {
    absolutePath = path.resolve(resolvedWorkspaceRoot, input);
  }

  const normalizedRoot = resolvedWorkspaceRoot.endsWith(path.sep)
    ? resolvedWorkspaceRoot
    : `${resolvedWorkspaceRoot}${path.sep}`;
  if (absolutePath !== resolvedWorkspaceRoot && !absolutePath.startsWith(normalizedRoot)) {
    throw new ToolingError(ErrorCode.PERMISSION_DENIED, 'music path escapes workspace');
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (!ALLOWED_MUSIC_EXTENSIONS.has(ext)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `unsupported music file extension: ${ext || '<empty>'}`);
  }

  if (!fs.existsSync(absolutePath)) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `music file not found: ${input}`);
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `music path is not a file: ${input}`);
  }

  return absolutePath;
}

function normalizeMusicPlayArgs(args = {}, context = {}) {
  const workspaceRoot = resolveWorkspaceRoot(context);
  const rawPath = ensureRelativeMusicInput(args.path
    ?? args.filePath
    ?? args.file_path
    ?? args.audioPath
    ?? args.audio_path
    ?? args.audioRef
    ?? args.audio_ref);
  const absolutePath = resolveMusicPath(rawPath, workspaceRoot);

  return {
    workspaceRoot,
    path: absolutePath,
    audio_url: pathToFileURL(absolutePath).toString(),
    volume: normalizeVolume(args.volume, 1),
    loop: args.loop === true,
    trackLabel: String(args.trackLabel || args.track_label || path.basename(absolutePath)).trim() || path.basename(absolutePath)
  };
}

function invokeMusicRpc({
  method,
  params = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  WebSocketImpl = WebSocket,
  traceId = null
} = {}) {
  if (!method) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'music rpc method is required');
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
      reject(new ToolingError(ErrorCode.TIMEOUT, `music rpc timeout after ${timeoutMs}ms`, {
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
            mapRpcCodeToToolingCode(message.error),
            `music rpc error(${message.error.code}): ${message.error.message || 'unknown error'}`,
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
        new ToolingError(ErrorCode.RUNTIME_ERROR, `music rpc connection failed: ${err.message || String(err)}`, {
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
          new ToolingError(ErrorCode.RUNTIME_ERROR, 'music rpc connection closed before response', {
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

function buildMusicAdapter(method, invokeRpc = invokeMusicRpc) {
  return async (args = {}, context = {}) => {
    const result = await invokeRpc({
      method,
      params: args,
      traceId: context.trace_id || null
    });
    return stringifyResult(result);
  };
}

function createMusicAdapters({
  invokeRpc = invokeMusicRpc
} = {}) {
  const adapters = {
    'music.play': async (args = {}, context = {}) => {
      const normalized = normalizeMusicPlayArgs(args, context);
      const result = await invokeRpc({
        method: 'desktop.music.play',
        params: {
          path: normalized.path,
          volume: normalized.volume,
          loop: normalized.loop,
          trackLabel: normalized.trackLabel
        },
        traceId: context.trace_id || null
      });
      return stringifyResult(result);
    },
    'music.pause': buildMusicAdapter('desktop.music.pause', invokeRpc),
    'music.resume': buildMusicAdapter('desktop.music.resume', invokeRpc),
    'music.stop': buildMusicAdapter('desktop.music.stop', invokeRpc),
    'music.state.get': buildMusicAdapter('desktop.music.state.get', invokeRpc)
  };
  return {
    ...adapters,
    'desktop.music.play': adapters['music.play'],
    'desktop.music.pause': adapters['music.pause'],
    'desktop.music.resume': adapters['music.resume'],
    'desktop.music.stop': adapters['music.stop'],
    'desktop.music.state.get': adapters['music.state.get']
  };
}

const musicAdapters = createMusicAdapters();

module.exports = {
  ...musicAdapters,
  __internal: {
    ALLOWED_MUSIC_EXTENSIONS,
    buildRequestId,
    createMusicAdapters,
    invokeMusicRpc,
    mapRpcCodeToToolingCode,
    normalizeMusicPlayArgs,
    normalizeRpcUrl,
    normalizeVolume,
    ensureRelativeMusicInput,
    resolveMusicPath,
    resolveWorkspaceRoot,
    sanitizeRpcParams
  }
};
