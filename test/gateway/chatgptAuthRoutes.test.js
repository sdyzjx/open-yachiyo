const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createChatGPTAuthRouter } = require('../../apps/gateway/routes/chatgptAuth');

async function listen(app, remoteAddress) {
  const server = http.createServer(app);
  if (remoteAddress) {
    server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', {
      configurable: true, value: remoteAddress
    }));
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function rawRequest(url, { method = 'GET', headers = {}, body = '' } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: target.hostname, port: target.port, path: target.pathname, method,
      headers: { ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...headers }
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function serviceFixture() {
  const calls = [];
  return {
    calls,
    status: () => ({ connected: false, profiles: [], pending: null, error: null }),
    start: async (args) => { calls.push(['start', args]); return { authorization_url: 'https://auth.openai.com/test', attempt_id: 'a1' }; },
    cancel: (id) => calls.push(['cancel', id]),
    signOut: async (args) => { calls.push(['signout', args]); return { revoked: true }; },
    refreshModels: async (args) => { calls.push(['refresh', args]); return [{ slug: 'gpt-test', display_name: 'GPT Test' }]; }
  };
}

test('TC-LLM-037 local routes use envelopes and never add credential fields', async (t) => {
  const service = serviceFixture();
  const app = express();
  app.use(express.json());
  app.use(createChatGPTAuthRouter({ service }));
  const { server, base } = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const status = await fetch(`${base}/api/chatgpt/status`).then((response) => response.json());
  assert.deepEqual(status, { ok: true, data: { connected: false, profiles: [], pending: null, error: null } });
  assert.doesNotMatch(JSON.stringify(status), /access_token|refresh_token|id_token/);
  const started = await fetch(`${base}/api/chatgpt/auth/start`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ profile_id: 'p1' })
  }).then((response) => response.json());
  assert.equal(started.data.authorization_url, 'https://auth.openai.com/test');
  assert.deepEqual(service.calls[0], ['start', { profileId: 'p1' }]);
});

test('TC-LLM-038 browser mutation guard rejects cross-site and DNS-rebound requests', async (t) => {
  const service = serviceFixture();
  const app = express();
  app.use(express.json());
  app.use(createChatGPTAuthRouter({ service }));
  const { server, base } = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `${base}/api/chatgpt/auth/start`;
  const body = JSON.stringify({});
  const cases = [
    { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    { origin: 'null', 'sec-fetch-site': 'cross-site' },
    { origin: base, 'sec-fetch-site': 'cross-site' },
    { host: `evil.example:${new URL(base).port}`, origin: `http://evil.example:${new URL(base).port}`, 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }
  ];
  for (const headers of cases) {
    const response = await rawRequest(endpoint, { method: 'POST', headers, body });
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  assert.deepEqual(service.calls, []);

  const sameOrigin = await rawRequest(endpoint, {
    method: 'POST', headers: { origin: base, 'sec-fetch-site': 'same-origin' }, body
  });
  assert.equal(sameOrigin.status, 200);
  const trustedNonBrowser = await rawRequest(`${base}/api/chatgpt/auth/cancel`, {
    method: 'POST', body: JSON.stringify({ attempt_id: 'a1' })
  });
  assert.equal(trustedNonBrowser.status, 200);
  assert.deepEqual(service.calls.map((call) => call[0]), ['start', 'cancel']);
});

test('TC-LLM-038 ChatGPT routes reject paired/LAN clients before service access', async (t) => {
  const service = serviceFixture();
  const app = express();
  app.use(express.json());
  app.use(createChatGPTAuthRouter({ service }));
  const { server, base } = await listen(app, '192.0.2.10');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/api/chatgpt/status`, { headers: {
    authorization: 'Bearer pairing-token', 'x-forwarded-for': '127.0.0.1'
  } });
  assert.equal(response.status, 403);
  assert.deepEqual(service.calls, []);
});

test('TC-LLM-038 IPv4-mapped loopback is local without consulting proxy headers', async (t) => {
  const service = serviceFixture();
  const app = express();
  app.use(express.json());
  app.use(createChatGPTAuthRouter({ service }));
  const { server, base } = await listen(app, '::ffff:127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/api/chatgpt/status`, { headers: { 'x-forwarded-for': '192.0.2.10' } });
  assert.equal(response.status, 200);
  assert.deepEqual(service.calls, []);
});
