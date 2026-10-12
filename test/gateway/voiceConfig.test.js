const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { ProviderConfigStore } = require('../../apps/runtime/config/providerConfigStore');
const { LlmProviderManager } = require('../../apps/runtime/config/llmProviderManager');
const { createVoiceConfigRouter } = require('../../apps/gateway/routes/voiceConfig');
const { configLoopbackOnly } = require('../../apps/gateway/deviceHub/accessControl');

const YAML_TEXT = `
active_model: ds/deepseek-chat
providers:
  ds: { preset: deepseek, api_key: sk-CHAT-SECRET }
  qwen_tts:
    type: tts_dashscope
    base_url: https://dash.example.invalid/api/v1
    api_key: sk-TTS-SECRET
    tts_model: qwen3-tts-flash
    tts_voice: Cherry
  aliyun_asr:
    type: asr_dashscope
    base_url: https://dash.example.invalid/api/v1
    api_key: sk-ASR-SECRET
    model: paraformer-v2
`;

async function setup(t, { fetchImpl, remoteAddress, desktopJson, voiceRuntime = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-cfg-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, YAML_TEXT);
  let desktopLive2dConfigPath = null;
  if (desktopJson) {
    desktopLive2dConfigPath = path.join(dir, 'desktop-live2d.json');
    fs.writeFileSync(desktopLive2dConfigPath, desktopJson);
  }
  const llmManager = new LlmProviderManager({ store: new ProviderConfigStore({ configPath }) });
  const commits = [];
  const app = express();
  app.use(express.json());
  app.use('/api/config', configLoopbackOnly);
  app.use(createVoiceConfigRouter({ llmManager, commitConfigChange: (f) => commits.push(f), desktopLive2dConfigPath, fetchImpl, voiceRuntime }));
  const server = http.createServer(app);
  if (remoteAddress) {
    server.prependListener('request', (req) => Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: remoteAddress }));
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, buf, json: type.includes('json') ? JSON.parse(buf.toString()) : null };
  };
  return { call, configPath, commits };
}

test('TC-CFG-010 GET /api/config/voice returns redacted voice providers, active keys and desktop path', async (t) => {
  const f = await setup(t, { desktopJson: '{ // comment\n "voice": { "path": "runtime_legacy", "transport": "realtime" } }' });
  const r = await f.call('GET', '/api/config/voice');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.active_tts, 'qwen_tts');
  assert.equal(d.active_asr, 'aliyun_asr');
  assert.deepEqual(d.desktop, { path: 'runtime_legacy', transport: 'realtime' });
  assert.deepEqual(d.providers.map((p) => p.key).sort(), ['aliyun_asr', 'qwen_tts']);
  assert.equal(JSON.stringify(r.json).includes('SECRET'), false);
  const tts = d.providers.find((p) => p.key === 'qwen_tts');
  assert.equal(tts.has_api_key, true);
  assert.equal(tts.tts_voice, 'Cherry');
  assert.equal(tts.supports_realtime, true);
  assert.equal(d.providers.find((p) => p.key === 'aliyun_asr').model, 'paraformer-v2');
});

test('TC-CFG-011 voice selection validates provider kinds and persists voice.active_*', async (t) => {
  const f = await setup(t);
  assert.equal((await f.call('PUT', '/api/config/voice/selection', { active_tts: 'ds' })).status, 400);
  assert.equal((await f.call('PUT', '/api/config/voice/selection', { active_tts: 'aliyun_asr' })).status, 400);
  assert.equal((await f.call('PUT', '/api/config/voice/selection', { active_asr: 'nope' })).status, 400);
  assert.deepEqual(f.commits, []);
  const ok = await f.call('PUT', '/api/config/voice/selection', { active_tts: 'qwen_tts', active_asr: 'aliyun_asr' });
  assert.equal(ok.status, 200);
  assert.match(fs.readFileSync(f.configPath, 'utf8'), /active_tts: qwen_tts/);
  assert.deepEqual(f.commits, ['providers.yaml']);
});

test('TC-CFG-012 voice provider PUT is a patch and DELETE cleans selection', async (t) => {
  const f = await setup(t);
  const stored = () => fs.readFileSync(f.configPath, 'utf8');
  let r = await f.call('PUT', '/api/config/voice/providers/qwen_tts', { tts_voice: 'Ethan', api_key: '' });
  assert.equal(r.status, 200);
  assert.match(stored(), /tts_voice: Ethan/);
  assert.ok(stored().includes('sk-TTS-SECRET'));
  assert.ok(stored().includes('qwen3-tts-flash'));
  r = await f.call('PUT', '/api/config/voice/providers/aliyun_asr', { model: 'paraformer-v3' });
  assert.equal(r.status, 200);
  assert.equal(stored().includes('asr_model'), false);
  assert.match(stored(), /model: paraformer-v3/);
  // chat providers cannot be edited through the voice route; unknown types rejected
  assert.equal((await f.call('PUT', '/api/config/voice/providers/ds', { display_name: 'x' })).status, 400);
  assert.equal((await f.call('PUT', '/api/config/voice/providers/new_one', { type: 'openai_compatible', base_url: 'http://x' })).status, 400);
  assert.equal((await f.call('PUT', '/api/config/voice/selection', { active_tts: 'qwen_tts' })).status, 200);
  r = await f.call('DELETE', '/api/config/voice/providers/qwen_tts');
  assert.equal(r.status, 200);
  assert.equal(stored().includes('active_tts'), false);
  assert.equal((await f.call('DELETE', '/api/config/voice/providers/ds')).status, 400);
  assert.equal((await f.call('DELETE', '/api/config/voice/providers/missing')).status, 404);
});

test('TC-CFG-013 test-tts returns audio from a mocked provider and redacts failures', async (t) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/generation')) {
      return new Response(JSON.stringify({ output: { audio: { url: 'https://cdn.example.invalid/a.wav' } } }), { status: 200 });
    }
    if (url === 'https://cdn.example.invalid/a.wav') return new Response(Buffer.from('RIFFxxxx'), { status: 200 });
    return new Response('upstream says sk-TTS-SECRET', { status: 401 });
  };
  const f = await setup(t, { fetchImpl });
  const r = await f.call('POST', '/api/config/voice/test-tts', { text: '你好' });
  assert.equal(r.status, 200);
  assert.equal(r.type, 'audio/wav');
  assert.equal(r.buf.toString(), 'RIFFxxxx');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model, 'qwen3-tts-flash');
  assert.equal(sent.input.voice, 'Cherry');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-TTS-SECRET');

  assert.equal((await f.call('POST', '/api/config/voice/test-tts', { text: '' })).status, 400);
  assert.equal((await f.call('POST', '/api/config/voice/test-tts', { text: 'x'.repeat(400) })).status, 400);
  assert.equal((await f.call('POST', '/api/config/voice/test-tts', { text: 'hi', key: 'aliyun_asr' })).status, 400);
});

test('TC-CFG-014 test-tts prefers the voice runtime (createTtsClient) when present', async (t) => {
  let seenView = null;
  const voiceRuntime = {
    createTtsClient: ({ store }) => {
      seenView = store.load();
      return { synthesize: async ({ text }) => ({ buffer: Buffer.from(`audio:${text}`), mime: 'audio/mpeg' }) };
    }
  };
  const f = await setup(t, { voiceRuntime });
  const r = await f.call('POST', '/api/config/voice/test-tts', { text: 'hello', key: 'qwen_tts' });
  assert.equal(r.status, 200);
  assert.equal(r.type, 'audio/mpeg');
  assert.equal(r.buf.toString(), 'audio:hello');
  assert.equal(seenView.voice.active_tts, 'qwen_tts');
});

test('TC-CFG-015 voice routes are loopback-only', async (t) => {
  const f = await setup(t, { remoteAddress: '192.0.2.10' });
  assert.equal((await f.call('GET', '/api/config/voice')).status, 403);
  assert.equal((await f.call('PUT', '/api/config/voice/selection', { active_tts: 'qwen_tts' })).status, 403);
  assert.equal((await f.call('POST', '/api/config/voice/test-tts', { text: 'x' })).status, 403);
});
