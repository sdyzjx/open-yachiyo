const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { QwenTtsClient } = require('../../apps/desktop-live2d/main/voice/qwenTtsClient');

function setupProviderConfig() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tts-client-'));
  const configPath = path.join(tmpDir, 'providers.yaml');
  fs.writeFileSync(
    configPath,
    [
      'active_provider: qwen35_plus',
      'providers:',
      '  qwen35_plus:',
      '    type: openai_compatible',
      '    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1',
      '    model: qwen3.5-plus',
      '    api_key_env: DASHSCOPE_API_KEY',
      '  qwen3_tts:',
      '    type: tts_dashscope',
      '    tts_model: qwen3-tts-vc-2026-01-22',
      '    tts_voice: qwen-tts-vc-yachiyo',
      '    base_url: https://dashscope.aliyuncs.com/api/v1',
      '    api_key_env: DASHSCOPE_API_KEY'
    ].join('\n'),
    'utf8'
  );
  return { tmpDir, configPath };
}

test('qwen tts client synthesizes non-streaming and returns audio url', async () => {
  const { configPath } = setupProviderConfig();
  const prevConfigPath = process.env.PROVIDER_CONFIG_PATH;
  const prevApiKey = process.env.DASHSCOPE_API_KEY;
  process.env.PROVIDER_CONFIG_PATH = configPath;
  process.env.DASHSCOPE_API_KEY = 'sk-test';

  const calls = [];
  const client = new QwenTtsClient({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            output: {
              audio: {
                url: 'https://example.com/audio.ogg'
              }
            }
          });
        }
      };
    }
  });

  try {
    const result = await client.synthesizeNonStreaming({ text: '你好，月读。' });
    assert.equal(result.audioUrl, 'https://example.com/audio.ogg');
    assert.equal(result.model, 'qwen3-tts-vc-2026-01-22');
    assert.equal(result.voice, 'qwen-tts-vc-yachiyo');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.includes('/services/aigc/multimodal-generation/generation'), true);
  } finally {
    if (prevConfigPath !== undefined) process.env.PROVIDER_CONFIG_PATH = prevConfigPath;
    else delete process.env.PROVIDER_CONFIG_PATH;
    if (prevApiKey !== undefined) process.env.DASHSCOPE_API_KEY = prevApiKey;
    else delete process.env.DASHSCOPE_API_KEY;
  }
});

test('qwen tts client fetchAudioBuffer reads binary payload', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const client = new QwenTtsClient({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async arrayBuffer() {
        return bytes.buffer;
      }
    })
  });

  const buf = await client.fetchAudioBuffer({ audioUrl: 'https://example.com/audio.ogg' });
  assert.equal(Buffer.isBuffer(buf), true);
  assert.deepEqual([...buf], [1, 2, 3, 4]);
});

test('TC-VOC-021 desktop wrapper returns a data URL for providers without remote audio URLs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tts-oai-'));
  const configPath = path.join(tmpDir, 'providers.yaml');
  fs.writeFileSync(configPath, [
    'version: 2', 'active_model: c/m', 'voice: { active_tts: oai }', 'providers:',
    '  c: { type: openai_compatible, base_url: "https://x/v1", model: m, api_key: k }',
    '  oai: { type: tts_openai_compatible, base_url: "https://o/v1", api_key: k, tts_model: tts-1, tts_voice: alloy, format: mp3 }'
  ].join('\n'));
  const { ProviderConfigStore } = require('../../apps/runtime/config/providerConfigStore');
  const client = new QwenTtsClient({
    store: new ProviderConfigStore({ configPath }),
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Map(), async arrayBuffer() { return Uint8Array.from([9, 8, 7]).buffer; } })
  });
  const result = await client.synthesizeNonStreaming({ text: 'hi' });
  assert.match(result.audioUrl, /^data:audio\/mpeg;base64,/);
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.deepEqual([...(await client.fetchAudioBuffer({ audioUrl: result.audioUrl }))], [9, 8, 7]);
  assert.equal(client.describeActive().supportsRealtime, false);
});
