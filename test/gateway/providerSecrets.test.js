const test = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const {
  redactProviderConfig,
  redactProviderYaml,
  restoreProviderSecrets,
  restoreProviderYaml
} = require('../../apps/gateway/providerSecrets');

const config = {
  active_provider: 'demo',
  providers: {
    demo: {
      type: 'openai_compatible',
      base_url: 'https://example.invalid/v1',
      model: 'demo',
      api_key: 'sk-inline-secret',
      api_key_env: 'DEMO_API_KEY',
      headers: { Authorization: 'Bearer header-secret', 'X-Trace': 'visible' }
    }
  }
};

test('Provider config and raw YAML redact credentials without losing status', () => {
  const previous = process.env.DEMO_API_KEY;
  process.env.DEMO_API_KEY = 'env-secret';
  try {
    const redacted = redactProviderConfig(config);
    assert.equal(redacted.providers.demo.api_key, '');
    assert.equal(redacted.providers.demo.headers.Authorization, '');
    assert.equal(redacted.providers.demo.headers['X-Trace'], 'visible');
    assert.equal(redacted.providers.demo.api_key_env, 'DEMO_API_KEY');
    assert.equal(redacted.providers.demo.has_api_key, true);

    const yaml = redactProviderYaml(YAML.stringify(config));
    assert.equal(yaml.includes('sk-inline-secret'), false);
    assert.equal(yaml.includes('header-secret'), false);
  } finally {
    if (previous === undefined) delete process.env.DEMO_API_KEY;
    else process.env.DEMO_API_KEY = previous;
  }
});

test('Legacy provider writes preserve redacted credentials and accept replacements', () => {
  const next = redactProviderConfig(config);
  next.providers.demo.display_name = 'Changed';
  delete next.providers.demo.headers;
  const restored = restoreProviderSecrets(next, config);
  assert.equal(restored.providers.demo.api_key, 'sk-inline-secret');
  assert.equal(restored.providers.demo.headers.Authorization, 'Bearer header-secret');
  assert.equal(restored.providers.demo.has_api_key, undefined);
  assert.equal(restored.providers.demo.display_name, 'Changed');

  next.providers.demo.api_key = 'sk-new';
  next.providers.demo.headers = { Authorization: 'Bearer new' };
  const replaced = restoreProviderSecrets(next, config);
  assert.equal(replaced.providers.demo.api_key, 'sk-new');
  assert.equal(replaced.providers.demo.headers.Authorization, 'Bearer new');

  const yaml = restoreProviderYaml(redactProviderYaml(YAML.stringify(config)), config);
  const parsed = YAML.parse(yaml);
  assert.equal(parsed.providers.demo.api_key, 'sk-inline-secret');
  assert.equal(parsed.providers.demo.headers.Authorization, 'Bearer header-secret');
});
