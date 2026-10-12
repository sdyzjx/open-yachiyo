const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createTtsClient, createAsrClient, describeVoiceConfig } = require('../../../apps/runtime/voice');

async function mockServer(t, handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
    calls.push(call);
    handler(call, res, server);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}

const cfgWith = (providers, voice) => ({ version: 2, active_model: 'chat/m', ...(voice ? { voice } : {}), providers: { chat: { type: 'openai_compatible', base_url: 'https://x/v1', model: 'm', api_key: 'k' }, ...providers } });
const store = (cfg) => ({ load: () => cfg });

test('TC-VOC-010 tts_dashscope synthesizes via URL + download and reports realtime support', async (t) => {
  const audio = Buffer.from('ogg-bytes');
  const m = await mockServer(t, (call, res, server) => {
    if (call.url.startsWith('/api/v1/services')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: { audio: { url: `http://127.0.0.1:${server.address().port}/a.mp3` } } }));
    } else res.end(audio);
  });
  const cfg = cfgWith({ qwen_tts: { type: 'tts_dashscope', base_url: `${m.base}/api/v1`, api_key: 'sk-secret', tts_model: 'qwen3-tts-flash', tts_voice: 'Cherry', tts_realtime_model: 'rt-model' } });
  const tts = createTtsClient({ store: store(cfg) });
  assert.equal(tts.providerKey, 'qwen_tts'); assert.equal(tts.type, 'tts_dashscope'); assert.equal(tts.supportsRealtime, true);
  const out = await tts.synthesize({ text: ' 你好 ' });
  assert.deepEqual(out.buffer, audio); assert.equal(out.mime, 'audio/mpeg'); assert.equal(out.model, 'qwen3-tts-flash'); assert.equal(out.voice, 'Cherry');
  const sent = JSON.parse(m.calls[0].body);
  assert.deepEqual(sent, { model: 'qwen3-tts-flash', input: { text: '你好', voice: 'Cherry', language_type: 'Chinese' } });
  assert.equal(m.calls[0].headers.authorization, 'Bearer sk-secret');
  assert.equal((await tts.synthesize({ text: 'x', voice: 'Ethan', model: 'other' })).voice, 'Ethan');
  await assert.rejects(tts.synthesize({ text: '  ' }), (e) => e.code === 'TTS_INVALID_PARAMS');
});

test('TC-VOC-011 tts_dashscope without realtime model does not support realtime; http errors are mapped', async (t) => {
  const m = await mockServer(t, (call, res) => { res.statusCode = 401; res.end('{"message":"bad key"}'); });
  const cfg = cfgWith({ q: { type: 'tts_dashscope', base_url: `${m.base}/api/v1`, api_key: 'k', tts_model: 'a', tts_voice: 'v' } });
  const tts = createTtsClient({ store: store(cfg) });
  assert.equal(tts.supportsRealtime, false);
  await assert.rejects(tts.synthesize({ text: 'hi' }), (e) => e.code === 'TTS_PROVIDER_AUTH_FAILED' && e.meta.status === 401);
});

test('TC-VOC-012 tts_openai_compatible posts /audio/speech and returns bytes + mime', async (t) => {
  const m = await mockServer(t, (call, res) => { res.setHeader('content-type', 'audio/wav'); res.end(Buffer.from('RIFFdata')); });
  const cfg = cfgWith({ o: { type: 'tts_openai_compatible', base_url: `${m.base}/v1/`, api_key: 'sk-o', tts_model: 'gpt-4o-mini-tts', tts_voice: 'alloy', format: 'wav' } });
  const tts = createTtsClient({ store: store(cfg) });
  assert.equal(tts.supportsRealtime, false);
  const out = await tts.synthesize({ text: 'hello' });
  assert.equal(out.buffer.toString(), 'RIFFdata'); assert.equal(out.mime, 'audio/wav');
  assert.equal(m.calls[0].method, 'POST'); assert.equal(m.calls[0].url, '/v1/audio/speech');
  assert.equal(m.calls[0].headers.authorization, 'Bearer sk-o');
  assert.deepEqual(JSON.parse(m.calls[0].body), { model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'hello', response_format: 'wav' });
});

test('TC-VOC-013 provider selection, explicit key and missing config errors', async () => {
  const providers = {
    a: { type: 'tts_dashscope', base_url: 'https://d/api/v1', api_key: 'k', tts_model: 'm', tts_voice: 'v' },
    b: { type: 'tts_openai_compatible', base_url: 'https://o/v1', api_key: 'k', tts_model: 'm', tts_voice: 'v' }
  };
  assert.equal(createTtsClient({ store: store(cfgWith(providers)) }).providerKey, 'a');
  assert.equal(createTtsClient({ store: store(cfgWith(providers, { active_tts: 'b' })) }).providerKey, 'b');
  assert.equal(createTtsClient({ store: store(cfgWith(providers, { active_tts: 'b' })), providerKey: 'a' }).providerKey, 'a');
  assert.throws(() => createTtsClient({ store: store(cfgWith(providers)), providerKey: 'chat' }), (e) => e.code === 'TTS_CONFIG_MISSING');
  assert.throws(() => createTtsClient({ store: store(cfgWith({})) }), (e) => e.code === 'TTS_CONFIG_MISSING' && /no tts provider/.test(e.message));
  const nokey = { a: { ...providers.a, api_key: undefined, api_key_env: 'VOC_TEST_UNSET_KEY' } };
  assert.throws(() => createTtsClient({ store: store(cfgWith(nokey)) }), (e) => e.code === 'TTS_CONFIG_MISSING' && /api key is missing/.test(e.message));
});

test('TC-VOC-014 asr_openai_compatible sends multipart to /audio/transcriptions', async (t) => {
  const m = await mockServer(t, (call, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: ' hi there ' })); });
  const cfg = cfgWith({ asr: { type: 'asr_openai_compatible', base_url: `${m.base}/v1`, api_key: 'k', model: 'whisper-1' } });
  const wav = Buffer.from('WAVBYTES');
  const out = await createAsrClient({ store: store(cfg) }).transcribe({ buffer: wav, mime: 'audio/wav', lang: 'zh' });
  assert.equal(out.text, 'hi there');
  assert.equal(m.calls[0].url, '/v1/audio/transcriptions'); assert.match(m.calls[0].headers['content-type'], /multipart\/form-data/);
  assert.ok(m.calls[0].body.includes(wav)); assert.ok(m.calls[0].body.includes('whisper-1')); assert.ok(m.calls[0].body.includes('zh'));
});

test('TC-VOC-015 asr_dashscope uses inline audio, legacy asr_model, and maps errors', async () => {
  let sent; let status = 200; let content = 'recognized';
  const fetchImpl = async (url, o) => { sent = { url, body: JSON.parse(o.body), headers: o.headers }; return { ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }] }) }; };
  const cfg = cfgWith({ asr: { type: 'asr_dashscope', base_url: 'https://mock.invalid/api/v1', api_key: 'k', asr_model: 'legacy-model' } });
  const asr = createAsrClient({ store: store(cfg), fetchImpl });
  assert.equal(asr.type, 'asr_dashscope');
  assert.equal((await asr.transcribe({ buffer: Buffer.from('x'), lang: 'zh' })).text, 'recognized');
  assert.equal(sent.url, 'https://mock.invalid/compatible-mode/v1/chat/completions');
  assert.equal(sent.body.model, 'legacy-model'); assert.equal(sent.body.asr_options.language, 'Chinese');
  assert.match(sent.body.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
  content = '  '; await assert.rejects(asr.transcribe({ buffer: Buffer.from('x') }), (e) => e.code === 'ASR_EMPTY');
  status = 500; await assert.rejects(asr.transcribe({ buffer: Buffer.from('x') }), (e) => e.code === 'ASR_HTTP_ERROR');
  assert.throws(() => createAsrClient({ store: store(cfgWith({})) }), (e) => e.code === 'ASR_CONFIG_MISSING');
});

test('TC-VOC-016 describeVoiceConfig is secret-free', () => {
  const cfg = cfgWith({
    a: { type: 'tts_dashscope', base_url: 'https://d/api/v1', api_key: 'SUPER-SECRET', tts_model: 'm', tts_voice: 'v', tts_realtime_model: 'rt', headers: { 'x-token': 'HDR-SECRET' } },
    b: { type: 'tts_openai_compatible', base_url: 'https://o/v1', api_key_env: 'VOC_TEST_UNSET_KEY', tts_model: 'm', tts_voice: 'v', requires_api_key: false },
    asr: { type: 'asr_dashscope', base_url: 'https://d/api/v1', api_key: 'ASR-SECRET', asr_model: 'p' }
  }, { active_tts: 'b' });
  const snap = describeVoiceConfig({ store: store(cfg) });
  const text = JSON.stringify(snap);
  assert.ok(!/SECRET/.test(text));
  assert.equal(snap.active_tts, 'b'); assert.equal(snap.active_asr, 'asr');
  const a = snap.providers.find((p) => p.key === 'a');
  assert.equal(a.has_api_key, true); assert.equal(a.supports_realtime, true); assert.equal(a.has_custom_headers, true);
  assert.equal(snap.providers.find((p) => p.key === 'b').has_api_key, false);
  assert.equal(snap.providers.find((p) => p.key === 'asr').model, 'p');
  assert.equal(snap.providers.some((p) => p.key === 'chat'), false);
});
