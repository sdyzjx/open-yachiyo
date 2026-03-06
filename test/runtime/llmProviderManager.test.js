const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProviderConfigStore } = require('../../apps/runtime/config/providerConfigStore');
const { LlmProviderManager } = require('../../apps/runtime/config/llmProviderManager');

function createManagerWithConfig(rawYaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-manager-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, rawYaml, 'utf8');

  const store = new ProviderConfigStore({ configPath });
  return { manager: new LlmProviderManager({ store }), dir };
}

test('LlmProviderManager resolves api key from env and caches reasoner', () => {
  const previous = process.env.TEST_DASHSCOPE_KEY;
  process.env.TEST_DASHSCOPE_KEY = 'env-key-1';

  try {
    const { manager } = createManagerWithConfig([
      'active_provider: qwen',
      'providers:',
      '  qwen:',
      '    type: openai_compatible',
      '    display_name: Qwen',
      '    base_url: http://127.0.0.1:4100',
      '    model: qwen3.5-plus',
      '    api_key_env: TEST_DASHSCOPE_KEY'
    ].join('\n'));

    const summary = manager.getConfigSummary();
    assert.equal(summary.active_provider, 'qwen');
    assert.equal(summary.has_api_key, true);

    const first = manager.getReasoner();
    const second = manager.getReasoner();
    assert.equal(first, second);
  } finally {
    if (previous === undefined) delete process.env.TEST_DASHSCOPE_KEY;
    else process.env.TEST_DASHSCOPE_KEY = previous;
  }
});

test('LlmProviderManager saveConfig invalidates reasoner cache', () => {
  const { manager } = createManagerWithConfig([
    'active_provider: x',
    'providers:',
    '  x:',
    '    type: openai_compatible',
    '    display_name: X',
    '    base_url: http://127.0.0.1:4100',
    '    model: m1',
    '    api_key: key-1'
  ].join('\n'));

  const reasoner1 = manager.getReasoner();

  manager.saveConfig({
    active_provider: 'x',
    providers: {
      x: {
        type: 'openai_compatible',
        display_name: 'X',
        base_url: 'http://127.0.0.1:4100',
        model: 'm2',
        api_key: 'key-1'
      }
    }
  });

  const reasoner2 = manager.getReasoner();
  assert.notEqual(reasoner1, reasoner2);
  assert.equal(manager.getConfigSummary().active_model, 'm2');
});

test('LlmProviderManager passes retry settings to reasoner from provider config', () => {
  const { manager } = createManagerWithConfig([
    'active_provider: y',
    'providers:',
    '  y:',
    '    type: openai_compatible',
    '    display_name: Y',
    '    base_url: http://127.0.0.1:4100',
    '    model: m-retry',
    '    api_key: key-1',
    '    max_retries: 4',
    '    retry_delay_ms: 120'
  ].join('\n'));

  const reasoner = manager.getReasoner();
  assert.equal(reasoner.chatReasoner.maxRetries, 4);
  assert.equal(reasoner.chatReasoner.retryDelayMs, 120);
  assert.equal(reasoner.responsesReasoner.maxRetries, 4);
  assert.equal(reasoner.responsesReasoner.retryDelayMs, 120);
});

test('LlmProviderManager builds stacked reasoner with routing config', () => {
  const { manager } = createManagerWithConfig([
    'active_provider: qwen',
    'providers:',
    '  qwen:',
    '    type: openai_compatible',
    '    display_name: Qwen',
    '    base_url: http://127.0.0.1:4100',
    '    model: qwen3.5-plus',
    '    api_key: key-1',
    '    llm_endpoint_mode: auto',
    '    responses:',
    '      enabled: true',
    '      fallback_to_chat: true',
    '      fallback_policy: unsupported_only',
    '      model_allowlist:',
    '        - qwen3.5-plus',
    '      session_cache:',
    '        enabled: true',
    '        header_name: x-dashscope-session-cache',
    '        model_allowlist:',
    '          - qwen3.5-plus'
  ].join('\n'));

  const reasoner = manager.getReasoner();
  assert.equal(reasoner.endpointMode, 'auto');
  assert.equal(reasoner.responsesConfig.enabled, true);
  assert.deepEqual(reasoner.responsesConfig.model_allowlist, ['qwen3.5-plus']);
  assert.equal(reasoner.responsesConfig.session_cache.enabled, true);
});
