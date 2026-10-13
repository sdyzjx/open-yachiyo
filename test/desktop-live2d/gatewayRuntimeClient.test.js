const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');

const { getFreePort } = require('../helpers/net');
const {
  createDesktopSessionId,
  toGatewayWsUrl,
  mapGatewayMessageToDesktopEvent,
  GatewayRuntimeClient
} = require('../../apps/desktop-live2d/main/gatewayRuntimeClient');

test('createDesktopSessionId returns desktop-prefixed unique id', () => {
  const a = createDesktopSessionId();
  const b = createDesktopSessionId();
  assert.match(a, /^desktop-\d{14}-[a-f0-9]{8}$/);
  assert.notEqual(a, b);
});

test('toGatewayWsUrl converts http(s) gateway URLs to ws path', () => {
  assert.equal(
    toGatewayWsUrl('http://127.0.0.1:3000'),
    'ws://127.0.0.1:3000/ws'
  );
  assert.equal(
    toGatewayWsUrl('https://example.com/base/'),
    'wss://example.com/base/ws'
  );
  assert.equal(
    toGatewayWsUrl('http://127.0.0.1:3000/ws'),
    'ws://127.0.0.1:3000/ws'
  );
});

test('mapGatewayMessageToDesktopEvent maps runtime notifications', () => {
  const mapped = mapGatewayMessageToDesktopEvent({
    jsonrpc: '2.0',
    method: 'runtime.final',
    params: { output: 'done' }
  });
  assert.equal(mapped.type, 'runtime.final');
  assert.equal(mapped.data.output, 'done');

  const mappedDelta = mapGatewayMessageToDesktopEvent({
    jsonrpc: '2.0',
    method: 'message.delta',
    params: { delta: 'part-1' }
  });
  assert.equal(mappedDelta.type, 'message.delta');
  assert.equal(mappedDelta.data.delta, 'part-1');

  const mappedLegacyDelta = mapGatewayMessageToDesktopEvent({
    type: 'delta',
    delta: 'legacy-part'
  });
  assert.equal(mappedLegacyDelta.type, 'legacy.delta');
  assert.equal(mappedLegacyDelta.data.delta, 'legacy-part');
});

test('GatewayRuntimeClient forwards runtime notifications and resolves rpc result', async () => {
  const port = await getFreePort();
  const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/ws' });
  let capturedRequest = null;

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      capturedRequest = request;
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'runtime.start',
        params: { session_id: 'desktop-live2d-chat' }
      }));
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'runtime.event',
        params: { event: 'plan', payload: { step: 1 } }
      }));
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'message.delta',
        params: { delta: 'assistant-' }
      }));
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'runtime.final',
        params: { output: 'assistant-final' }
      }));
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { output: 'assistant-final', state: 'DONE' }
      }));
    });
  });

  try {
    const events = [];
    const client = new GatewayRuntimeClient({
      gatewayUrl: `http://127.0.0.1:${port}`,
      sessionId: 'desktop-live2d-chat',
      onNotification: (event) => events.push(event)
    });

    const result = await client.runInput({ input: 'hello from panel', modelRef: 'qwen/qwen3.8-omni-flash' });

    assert.equal(result.output, 'assistant-final');
    assert.equal(capturedRequest.params.model_ref, 'qwen/qwen3.8-omni-flash');
    assert.equal(events.length, 4);
    assert.equal(events[0].type, 'runtime.start');
    assert.equal(events[1].type, 'runtime.event');
    assert.equal(events[2].type, 'message.delta');
    assert.equal(events[3].type, 'runtime.final');
  } finally {
    await new Promise((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GatewayRuntimeClient runInput supports image-only runtime requests', async () => {
  const port = await getFreePort();
  const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/ws' });
  let capturedRequest = null;

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      capturedRequest = JSON.parse(String(raw));
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: capturedRequest.id,
        result: { ok: true }
      }));
    });
  });

  try {
    const client = new GatewayRuntimeClient({
      gatewayUrl: `http://127.0.0.1:${port}`,
      sessionId: 'desktop-live2d-chat'
    });

    const result = await client.runInput({
      input: '   ',
      inputImages: [{
        client_id: 'img-1',
        name: 'test.png',
        mime_type: 'image/png',
        size_bytes: 8,
        data_url: 'data:image/png;base64,AAAA'
      }]
    });

    assert.equal(result.ok, true);
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.method, 'runtime.run');
    assert.equal(capturedRequest.params.session_id, 'desktop-live2d-chat');
    assert.equal(capturedRequest.params.input, undefined);
    assert.equal(Array.isArray(capturedRequest.params.input_images), true);
    assert.equal(capturedRequest.params.input_images.length, 1);
    assert.equal(capturedRequest.params.input_images[0].mime_type, 'image/png');
  } finally {
    await new Promise((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GatewayRuntimeClient rejects when gateway returns rpc error', async () => {
  const port = await getFreePort();
  const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: 'runtime failed' }
      }));
    });
  });

  try {
    const client = new GatewayRuntimeClient({
      gatewayUrl: `http://127.0.0.1:${port}`,
      sessionId: 'desktop-live2d-chat'
    });

    await assert.rejects(
      () => client.runInput({ input: 'hello from panel' }),
      /runtime failed/i
    );
  } finally {
    await new Promise((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GatewayRuntimeClient ensureSession uses gateway settings api and set/get session id', async () => {
  const calls = [];
  const client = new GatewayRuntimeClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    sessionId: 's-1',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }
  });

  assert.equal(client.getSessionId(), 's-1');
  client.setSessionId('s-2');
  assert.equal(client.getSessionId(), 's-2');

  await client.ensureSession({ permissionLevel: 'high' });

  const settingsCalls = calls.filter((call) => /\/api\/sessions\/s-2\/settings$/.test(call.url));
  assert.equal(settingsCalls.length, 1);
  const body = JSON.parse(String(settingsCalls[0].options.body || '{}'));
  assert.equal(body.settings.permission_level, 'high');
});

test('GatewayRuntimeClient createAndUseNewSession switches session id and boots settings', async () => {
  const calls = [];
  const client = new GatewayRuntimeClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    sessionId: 'desktop-live2d',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }
  });

  const nextSessionId = await client.createAndUseNewSession({ permissionLevel: 'low' });
  assert.match(nextSessionId, /^desktop-\d{14}-[a-f0-9]{8}$/);
  assert.equal(client.getSessionId(), nextSessionId);
  const settingsCalls = calls.filter((call) => new RegExp(`/api/sessions/${nextSessionId}/settings$`).test(call.url));
  assert.equal(settingsCalls.length, 1);
  const body = JSON.parse(String(settingsCalls[0].options.body || '{}'));
  assert.equal(body.settings.permission_level, 'low');
});

test('GatewayRuntimeClient scopes approval controls to its active session', async () => {
  const calls = [];
  const client = new GatewayRuntimeClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    sessionId: 'desktop-session-a',
    fetchImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), method: options.method || 'GET', body });
      if (String(url).includes('/api/approvals?')) {
        return { ok: true, status: 200, async json() { return { ok: true, data: [{ approval_id: 'apr-1' }] }; } };
      }
      if (String(url).includes('/api/approvals/apr-1/decision')) {
        return { ok: true, status: 200, async json() { return { ok: true, data: { approved: body.approved } }; } };
      }
      return { ok: true, status: 200, async json() { return { ok: true, data: { approval_mode: body?.settings?.approval_mode || 'manual' } }; } };
    }
  });

  assert.equal((await client.getSessionSettings()).approval_mode, 'manual');
  assert.equal((await client.updateApprovalMode('auto_approve')).approval_mode, 'auto_approve');
  assert.deepEqual(await client.listPendingApprovals(), [{ approval_id: 'apr-1' }]);
  assert.equal((await client.decideApproval({ approvalId: 'apr-1', approved: true })).approved, true);
  assert.throws(() => client.updateApprovalMode('unsafe'), /manual\|auto_approve\|full_access/);
  assert.throws(() => client.decideApproval({ approvalId: '', approved: true }), /required/);

  assert.ok(calls.every((call) => call.url.includes('desktop-session-a') || call.body?.session_id === 'desktop-session-a'));
  assert.equal(calls.find((call) => call.method === 'PUT').body.settings.approval_mode, 'auto_approve');
  assert.equal(calls.find((call) => call.method === 'POST').body.scope, 'once');
});

test('GatewayRuntimeClient setSessionId rejects empty value', () => {
  const client = new GatewayRuntimeClient({
    gatewayUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => ({ ok: true, async json() { return { ok: true }; } })
  });
  assert.throws(() => client.setSessionId('  '), /sessionId must be non-empty/);
});
