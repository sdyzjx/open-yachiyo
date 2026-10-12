const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { loadModelCatalog } = require('../../runtime/config/modelCatalog');
const { resolveYachiyoHome } = require('../../runtime/skills/runtimePaths');
const { fault } = require('./hub');

function loadAsrProvider() {
  const file = process.env.PROVIDER_CONFIG_PATH || path.join(resolveYachiyoHome(), 'config/providers.yaml');
  if (!fs.existsSync(file)) return null;
  // A read-only store also supports the pre-WS2 provider validator (which rejects asr_*).
  const store = { load: () => YAML.parse(fs.readFileSync(file, 'utf8')) || {} };
  return loadModelCatalog({ store }).asr;
}

function createAsrService({ getProvider = loadAsrProvider, fetchImpl = fetch, fallback } = {}) {
  return async ({ wav, file, lang = 'auto', device }) => {
    const provider = getProvider();
    if (!provider) {
      if (!fallback) throw fault(-32601, 'ASR provider unavailable');
      const result = await fallback({ audioRef: file, format: 'wav', lang }, device);
      const value = typeof result === 'string' ? JSON.parse(result) : result;
      if (!value?.text?.trim()) throw fault(-32602, 'Empty ASR transcript');
      return value;
    }
    const base = String(provider.base_url || '').replace(/\/$/, '');
    const key = provider.api_key || process.env[provider.api_key_env] || '';
    const headers = { ...provider.headers, ...(key ? { authorization: `Bearer ${key}` } : {}) };
    let endpoint; let body;
    if (provider.type === 'asr_openai_compatible') {
      endpoint = `${base}/audio/transcriptions`;
      body = new FormData();
      body.append('file', new Blob([wav], { type: 'audio/wav' }), 'input.wav');
      body.append('model', provider.model || provider.asr_model || 'whisper-1');
      if (lang !== 'auto') body.append('language', lang);
    } else if (provider.type === 'asr_dashscope') {
      // Qwen ASR supports inline WAV via the OpenAI-compatible multimodal endpoint.
      endpoint = `${base.replace(/\/api\/v1$/, '/compatible-mode/v1')}/chat/completions`;
      headers['content-type'] = 'application/json';
      body = JSON.stringify({ model: provider.model || provider.asr_model || 'qwen3-asr-flash', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } }] }], stream: false, asr_options: { enable_itn: false, ...(lang !== 'auto' ? { language: lang === 'zh' ? 'Chinese' : 'English' } : {}) } });
    } else throw fault(-32602, 'Unsupported ASR provider');
    const response = await fetchImpl(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(Number(provider.timeout_ms) || 60000) });
    if (!response.ok) throw fault(-32600, `ASR HTTP ${response.status}`);
    const result = await response.json();
    const text = result.text || result.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw fault(-32602, 'Empty ASR transcript');
    return { text: text.trim() };
  };
}
module.exports = { createAsrService, loadAsrProvider };
