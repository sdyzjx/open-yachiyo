const http = require('node:http');
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const { once } = require('node:events');
const { attachDeviceHub } = require('../../../apps/gateway/deviceHub');

async function fixture(t, options = {}) {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => ws.send('legacy'));
  const hub = attachDeviceHub({ server, app, wss, config: { pairing_token: 'test-token', heartbeat_ms: 10000, ...options.config }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    hub.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function client(id, extra = {}) {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/device?token=test-token`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const i = waiters.findIndex((w) => w.predicate(msg));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg); else inbox.push(msg);
    });
    const next = (predicate = () => true) => {
      const i = inbox.findIndex(predicate);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Missing frame for ${id}`)), 2000);
        waiters.push({ predicate, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
      });
    };
    const send = (type, data, more = {}) => ws.send(JSON.stringify({ v: 1, type, data, ts: Date.now(), ...more }));
    await once(ws, 'open');
    send('hello', { device_id: id, device_type: 'android', name: id, ...extra });
    const welcome = await next((m) => m.type === 'welcome');
    return { ws, next, send, welcome, inbox, async sync() { send('ping', {}); await next((m) => m.type === 'pong'); } };
  }
  return { app, server, hub, base, client };
}
module.exports = { fixture };
