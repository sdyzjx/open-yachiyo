const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const { getFreePort } = require('../helpers/net');
const { waitFor } = require('../helpers/wait');

test('TC-COMP-001 paired phone chat executes a pi plugin tool and receives each delta once', { timeout: 45000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-e2e-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'config'), { recursive: true });
  const requests = [];
  const llm = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const last = body.messages.at(-1);
      const tool = body.tools?.find((item) => item.function.description === 'Companion integration echo');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({
        id: 'companion-response', object: 'chat.completion.chunk', model: 'mock',
        choices: [{ index: 0, delta, finish_reason: finish }]
      })}\n\n`);
      if (last.role === 'tool') {
        send({ role: 'assistant', content: '手机插件已完成' });
        send({}, 'stop');
      } else if (tool) {
        send({ role: 'assistant', tool_calls: [{ index: 0, id: 'companion-call', type: 'function',
          function: { name: tool.function.name, arguments: JSON.stringify({ text: 'hello phone' }) } }] });
        send({}, 'tool_calls');
      } else {
        send({ role: 'assistant', content: 'PLUGIN_TOOL_MISSING' });
        send({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    });
  });
  llm.listen(0, '127.0.0.1');
  await once(llm, 'listening');
  t.after(() => new Promise((resolve) => llm.close(resolve)));
  fs.writeFileSync(path.join(home, 'config/providers.yaml'), JSON.stringify({
    active_provider: 'mock', providers: { mock: { type: 'openai_compatible',
      base_url: `http://127.0.0.1:${llm.address().port}`, model: 'mock', api_key: 'offline-test', timeout_ms: 5000 } }
  }));
  fs.writeFileSync(path.join(home, 'config/device-hub.yaml'), 'pairing_token: companion-test-token\n');
  const port = await getFreePort();
  const child = spawn(process.execPath, ['apps/gateway/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PORT: String(port), YACHIYO_HOME: home,
      PROVIDER_CONFIG_PATH: path.join(home, 'config/providers.yaml'),
      SESSION_STORE_DIR: path.join(home, 'data/sessions'),
      PI_SESSION_STORE_DIR: path.join(home, 'data/pi-sessions'),
      SESSION_WORKSPACES_DIR: path.join(home, 'data/workspaces'),
      LONG_TERM_MEMORY_DIR: path.join(home, 'data/memory'),
      PERSONA_PROFILE_PATH: path.join(home, 'persona/profile.yaml'),
      AGENT_CORE: 'pi', YACHIYO_DISCOVERY_ENABLED: 'false', RUNTIME_MAX_STEP: '4' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 2000);
    await stopped;
    clearTimeout(force);
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs}`);
    try { return (await fetch(`${base}/health`)).ok; } catch { return false; }
  }, { timeoutMs: 15000 });
  const phone = new WebSocket(`ws://127.0.0.1:${port}/ws/device?token=companion-test-token`);
  t.after(() => phone.terminate());
  const frames = [];
  const calls = [];
  const send = (type, data, more = {}) => phone.send(JSON.stringify({ v: 1, type, data, ts: Date.now(), ...more }));
  phone.on('message', (raw) => {
    const frame = JSON.parse(raw);
    frames.push(frame);
    if (frame.type === 'rpc.req') {
      calls.push(frame.data);
      send('rpc.res', { result: { echoed: frame.data.params.text } }, { id: frame.id });
    }
    if (frame.type === 'event' && frame.topic === 'avatar.transfer.prepare') {
      send('pub', { transfer_id: frame.data.transfer_id }, { topic: 'avatar.transfer.ready' });
    }
    if (frame.type === 'event' && frame.topic === 'avatar.transfer.enter') {
      send('pub', { transfer_id: frame.data.transfer_id }, { topic: 'avatar.transfer.entered' });
    }
  });
  await once(phone, 'open');
  send('hello', { device_id: 'companion-phone', device_type: 'android', name: 'Integration phone', alias: 'integration_phone' });
  await waitFor(() => frames.some((m) => m.type === 'welcome'));
  send('sub', { topics: ['chat.*', 'task.update', 'avatar.*'] });
  send('rpc.register', { methods: [{ name: 'plugin.integration.echo', description: 'Companion integration echo',
    expose_as_tool: true, params_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] });
  send('ping', {});
  await waitFor(() => frames.some((m) => m.type === 'pong'));
  const transfer = await fetch(`${base}/api/device/avatar/transfer`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'companion-phone' }) });
  assert.equal(transfer.status, 200);
  assert.equal((await transfer.json()).host, 'companion-phone');
  send('pub', { text: '请调用手机插件' }, { topic: 'chat.input' });
  const final = await waitFor(() => {
    const error = frames.find((m) => m.type === 'error');
    if (error) throw new Error(`Device error: ${JSON.stringify(error.data)}`);
    return frames.find((m) => m.topic === 'chat.final');
  }, { timeoutMs: 15000 });
  assert.equal(final.data.output, '手机插件已完成');
  assert.deepEqual(calls.map((call) => ({ method: call.method, params: call.params })),
    [{ method: 'plugin.integration.echo', params: { text: 'hello phone' } }]);
  assert.equal(frames.filter((m) => m.topic === 'chat.delta').map((m) => m.data.delta).join(''), '手机插件已完成');
  assert.equal(frames.filter((m) => m.topic === 'chat.final').length, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].messages.some((m) => m.role === 'tool' && /hello phone/.test(m.content)));
  assert.ok(requests[0].tools.every((tool) => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.function.name)));
  assert.ok(fs.readdirSync(path.join(home, 'data/pi-sessions')).length > 0);
});
