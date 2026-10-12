const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProviderConfigStore } = require('../../../apps/runtime/config/providerConfigStore');
const { loadModelCatalog } = require('../../../apps/runtime/config/modelCatalog');

function storeWith(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, yaml, 'utf8');
  return new ProviderConfigStore({ configPath });
}

test('loadModelCatalog maps v1 providers to descriptors and picks active', () => {
  const catalog = loadModelCatalog({ store: storeWith(`
active_provider: ds
providers:
  ds:
    type: openai_compatible
    base_url: https://api.deepseek.com/v1/
    model: deepseek-chat
    api_key: sk-test
  tts:
    type: tts_dashscope
    tts_model: m
    tts_voice: v
    base_url: https://x
    api_key_env: X
`) });
  assert.equal(catalog.active.ref, 'ds/deepseek-chat');
  assert.equal(catalog.active.api, 'openai-completions');
  assert.equal(catalog.active.base_url, 'https://api.deepseek.com/v1');
  assert.equal(catalog.active.api_key, 'sk-test');
  assert.deepEqual(catalog.enabled.map((m) => m.ref), ['ds/deepseek-chat']);
  assert.equal(catalog.forRole('vision').ref, 'ds/deepseek-chat');
  assert.equal(catalog.tts.key, 'tts');
  assert.equal(catalog.models.length, 1);
});

test('getDeviceHub returns a null hub until a real hub is installed', async () => {
  const { getDeviceHub, setDeviceHub } = require('../../../apps/gateway/deviceHub');
  const hub = getDeviceHub();
  assert.equal(hub.enabled, false);
  assert.deepEqual(hub.listToolMethods(), []);
  await assert.rejects(hub.invoke('x', 'device.vibrate'), (err) => err.code === -32010);
  setDeviceHub(null);
  assert.equal(getDeviceHub().getAvatarHost(), 'desktop');
});
