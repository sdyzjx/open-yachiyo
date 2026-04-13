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
      '    tts_model: qwen3-tts-instruct-flash',
      '    tts_voice: Cherry',
      '    tts_instructions: speak slower and flatter',
      '    tts_optimize_instructions: true',
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
    assert.equal(result.model, 'qwen3-tts-instruct-flash');
    assert.equal(result.voice, 'Cherry');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.includes('/services/aigc/multimodal-generation/generation'), true);
    const requestBody = JSON.parse(String(calls[0].options.body || '{}'));
    assert.equal(requestBody.instructions, 'speak slower and flatter');
    assert.equal(requestBody.optimize_instructions, true);
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
