const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

function waitForPort(child, output, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`gateway did not listen: ${output()}`)), timeoutMs);
    const inspect = () => {
      const match = output().match(/Debug web: http:\/\/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off('data', inspect);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', inspect);
    inspect();
  });
}

function waitForWelcome(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Device Hub welcome timed out')), 5000);
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type !== 'welcome') return;
      clearTimeout(timer);
      resolve(message);
    });
  });
}

test('Gateway PORT=0 reports the actual port and SIGTERM closes an online device socket', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-shutdown-'));
  fs.mkdirSync(path.join(home, 'config'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config/device-hub.yaml'), 'pairing_token: shutdown-token\nheartbeat_ms: 1000\n', { mode: 0o600 });

  let logs = '';
  const child = spawn(process.execPath, ['apps/gateway/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      AGENT_CORE: 'legacy',
      YACHIYO_HOME: home,
      YACHIYO_DISCOVERY_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(home, { recursive: true, force: true });
  });

  const port = await waitForPort(child, () => logs);
  assert.ok(port > 0 && port <= 65535);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/device?token=shutdown-token`);
  await once(ws, 'open');
  const welcome = waitForWelcome(ws);
  ws.send(JSON.stringify({
    v: 1,
    type: 'hello',
    data: { device_id: 'shutdown-phone', device_type: 'android', name: 'Shutdown phone', mode: 'normal' },
    ts: Date.now()
  }));
  await welcome;

  const socketClosed = once(ws, 'close');
  const processExited = once(child, 'exit');
  child.kill('SIGTERM');
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`gateway shutdown timed out: ${logs}`)), 3000);
  });
  const [[code, signal]] = await Promise.race([
    Promise.all([processExited, socketClosed]),
    timeoutPromise
  ]).finally(() => clearTimeout(timeout));
  assert.equal(code, 0);
  assert.equal(signal, null);
});
