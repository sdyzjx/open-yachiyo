const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');

const desktopPerceptionAdapters = require('../../apps/runtime/tooling/adapters/desktopPerception');

const {
  invokeDesktopRpc,
  normalizeRpcUrl,
  buildRequestId,
  mapRpcCodeToToolingCode,
  sanitizeRpcParams,
  createDesktopPerceptionAdapters
} = desktopPerceptionAdapters.__internal;

async function createWsServer() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  return { wss, port: wss.address().port };
}

test('desktop perception normalizeRpcUrl builds ws url with token', () => {
  const url = normalizeRpcUrl({ host: '127.0.0.1', port: 17373, token: 'abc' });
  assert.equal(url, 'ws://127.0.0.1:17373/?token=abc');
});

test('desktop perception buildRequestId embeds trace id prefix', () => {
  const id = buildRequestId('trace-desktop');
  assert.match(id, /^desktop-trace-desktop-/);
});

test('desktop perception rpc code mapping matches tooling semantics', () => {
  assert.equal(mapRpcCodeToToolingCode(-32602), 'VALIDATION_ERROR');
  assert.equal(mapRpcCodeToToolingCode(-32006), 'PERMISSION_DENIED');
  assert.equal(mapRpcCodeToToolingCode(-32003), 'TIMEOUT');
  assert.equal(mapRpcCodeToToolingCode(-32001), 'RUNTIME_ERROR');
});

test('desktop perception sanitizeRpcParams strips timeoutMs and validates object', () => {
  const out = sanitizeRpcParams({ display_id: 'display:1', timeoutMs: 1200 });
  assert.equal(out.display_id, 'display:1');
  assert.equal(Object.hasOwn(out, 'timeoutMs'), false);
  assert.throws(() => sanitizeRpcParams([]), /must be an object/i);
});

test('invokeDesktopRpc returns rpc result payload', async (t) => {
  const token = 'desktop-token-1';
  const { wss, port } = await createWsServer();
  t.after(async () => {
    await new Promise((resolve) => wss.close(resolve));
  });

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url || '/', 'ws://localhost');
    if (url.searchParams.get('token') !== token) {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws.on('message', (raw) => {
      const req = JSON.parse(String(raw));
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          capture_id: 'cap_test_1',
          display_id: req.params.display_id || 'display:1'
        }
      }));
    });
  });

  const result = await invokeDesktopRpc({
    method: 'desktop.capture.screen',
    params: { display_id: 'display:2' },
    env: {
      DESKTOP_LIVE2D_RPC_HOST: '127.0.0.1',
      DESKTOP_LIVE2D_RPC_PORT: String(port),
      DESKTOP_LIVE2D_RPC_TOKEN: token
    },
    traceId: 'trace-desktop-1'
  });

  assert.equal(result.capture_id, 'cap_test_1');
  assert.equal(result.display_id, 'display:2');
});

test('desktop perception adapters return JSON strings from runtime tools', async (t) => {
  const token = 'desktop-token-2';
  const { wss, port } = await createWsServer();
  t.after(async () => {
    await new Promise((resolve) => wss.close(resolve));
  });

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url || '/', 'ws://localhost');
    if (url.searchParams.get('token') !== token) {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws.on('message', (raw) => {
      const req = JSON.parse(String(raw));
      if (req.method === 'desktop.perception.displays.list') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { displays: [{ id: 'display:1', primary: true }] }
        }));
        return;
      }
      if (req.method === 'desktop.perception.windows.list') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { windows: [{ source_id: 'window:42:0', title: 'Browser' }] }
        }));
        return;
      }
      if (req.method === 'desktop.capture.desktop') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { capture_id: 'cap-desktop-1', display_ids: ['display:1', 'display:2'] }
        }));
        return;
      }
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: { ok: true, deleted: true, capture_id: req.params.capture_id }
      }));
    });
  });

  const oldEnv = {
    DESKTOP_LIVE2D_RPC_HOST: process.env.DESKTOP_LIVE2D_RPC_HOST,
    DESKTOP_LIVE2D_RPC_PORT: process.env.DESKTOP_LIVE2D_RPC_PORT,
    DESKTOP_LIVE2D_RPC_TOKEN: process.env.DESKTOP_LIVE2D_RPC_TOKEN
  };
  process.env.DESKTOP_LIVE2D_RPC_HOST = '127.0.0.1';
  process.env.DESKTOP_LIVE2D_RPC_PORT = String(port);
  process.env.DESKTOP_LIVE2D_RPC_TOKEN = token;
  t.after(() => {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const displays = await desktopPerceptionAdapters['desktop.displays.list']({}, { trace_id: 'trace-a' });
  const windows = await desktopPerceptionAdapters['desktop.windows.list']({}, { trace_id: 'trace-w' });
  const desktopCapture = await desktopPerceptionAdapters['desktop.capture.desktop']({}, { trace_id: 'trace-desktop' });
  const deleted = await desktopPerceptionAdapters['desktop.capture.delete']({ capture_id: 'cap-a' }, { trace_id: 'trace-b' });

  assert.deepEqual(JSON.parse(displays), { displays: [{ id: 'display:1', primary: true }] });
  assert.deepEqual(JSON.parse(windows), { windows: [{ source_id: 'window:42:0', title: 'Browser' }] });
  assert.deepEqual(JSON.parse(desktopCapture), { capture_id: 'cap-desktop-1', display_ids: ['display:1', 'display:2'] });
  assert.deepEqual(JSON.parse(deleted), { ok: true, deleted: true, capture_id: 'cap-a' });
});

test('desktop perception capabilities adapter merges LLM provider readiness', async () => {
  const adapters = createDesktopPerceptionAdapters({
    invokeRpc: async ({ method }) => {
      assert.equal(method, 'desktop.perception.capabilities');
      return {
        platform: 'darwin',
        displays_available: true,
        screen_capture: true,
        region_capture: true,
        reason: null
      };
    },
    getLlmProviderSummary: async () => ({
      active_provider: 'qwen35_plus',
      active_model: 'qwen3.5-flash',
      has_api_key: true
    })
  });

  const payload = await adapters['desktop.perception.capabilities']({}, { trace_id: 'trace-cap' });
  const parsed = JSON.parse(payload);

  assert.equal(parsed.screen_capture, true);
  assert.equal(parsed.desktop_inspect, true);
  assert.equal(parsed.llm_provider.active_provider, 'qwen35_plus');
});

test('invokeDesktopRpc maps rpc errors to tooling errors', async (t) => {
  const token = 'desktop-token-3';
  const { wss, port } = await createWsServer();
  t.after(async () => {
    await new Promise((resolve) => wss.close(resolve));
  });

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url || '/', 'ws://localhost');
    if (url.searchParams.get('token') !== token) {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws.on('message', (raw) => {
      const req = JSON.parse(String(raw));
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'invalid params' }
      }));
    });
  });

  await assert.rejects(
    invokeDesktopRpc({
      method: 'desktop.capture.region',
      params: { x: 0 },
      env: {
        DESKTOP_LIVE2D_RPC_HOST: '127.0.0.1',
        DESKTOP_LIVE2D_RPC_PORT: String(port),
        DESKTOP_LIVE2D_RPC_TOKEN: token
      },
      traceId: 'trace-desktop-err'
    }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.details.trace_id, 'trace-desktop-err');
      return true;
    }
  );
});
