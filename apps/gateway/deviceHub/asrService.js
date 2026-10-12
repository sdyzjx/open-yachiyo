const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { loadModelCatalog } = require('../../runtime/config/modelCatalog');
const { resolveYachiyoHome } = require('../../runtime/skills/runtimePaths');
const { buildAsrClient } = require('../../runtime/voice/asr');
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
    try {
      return await buildAsrClient({ provider, fetchImpl }).transcribe({ buffer: wav, mime: 'audio/wav', lang });
    } catch (err) {
      if (err.code === 'ASR_HTTP_ERROR') throw fault(-32600, err.message);
      if (err.code === 'ASR_EMPTY') throw fault(-32602, err.message);
      if (err.code === 'ASR_CONFIG_MISSING') throw fault(-32602, 'Unsupported ASR provider');
      throw err;
    }
  };
}
module.exports = { createAsrService, loadAsrProvider };
