const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProviderConfigStore, validateConfig } = require('../../apps/runtime/config/providerConfigStore');

function createTempPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-store-'));
  return { dir, configPath: path.join(dir, 'providers.yaml') };
}

test('ProviderConfigStore creates default config on first load', () => {
  const { configPath } = createTempPath();
  const store = new ProviderConfigStore({ configPath });

  const config = store.load();
  assert.equal(config.active_provider, 'openai');
  assert.ok(config.providers.openai);
  assert.equal(fs.existsSync(configPath), true);
});

test('ProviderConfigStore saveRawYaml persists and loads config', () => {
  const { configPath } = createTempPath();
  const store = new ProviderConfigStore({ configPath });

  const raw = [
    'active_provider: mock',
    'providers:',
    '  mock:',
    '    type: openai_compatible',
    '    display_name: Mock',
    '    base_url: http://127.0.0.1:4100',
    '    model: mock-model',
    '    api_key: test-key',
    '    timeout_ms: 1000'
  ].join('\n');

  store.saveRawYaml(raw);
  const loaded = store.load();
  assert.equal(loaded.active_provider, 'mock');
  assert.equal(loaded.providers.mock.model, 'mock-model');
});

test('validateConfig rejects invalid provider map', () => {
  assert.throws(() => {
    validateConfig({ active_provider: 'x', providers: {} });
  }, /providers must be a non-empty map/);

  assert.throws(() => {
    validateConfig({
      active_provider: 'x',
      providers: {
        x: {
          type: 'openai_compatible',
          base_url: 'http://example.com',
          model: 'm'
        }
      }
    });
  }, /must define api_key or api_key_env/);
});

test('validateConfig accepts optional responses routing config for openai providers', () => {
  const config = {
    active_provider: 'qwen',
    providers: {
      qwen: {
        type: 'openai_compatible',
        display_name: 'Qwen',
        base_url: 'https://example.com/v1',
        model: 'qwen3.5-plus',
        api_key: 'test-key',
        llm_endpoint_mode: 'auto',
        responses: {
          enabled: true,
          fallback_to_chat: true,
          fallback_policy: 'unsupported_only',
          model_allowlist: ['qwen3.5-plus'],
          session_cache: {
            enabled: true,
            header_name: 'x-dashscope-session-cache',
            model_allowlist: ['qwen3.5-plus', 'qwen3.5-flash']
          }
        }
      }
    }
  };

  assert.doesNotThrow(() => validateConfig(config));
});

test('validateConfig rejects invalid responses routing config', () => {
  assert.throws(() => {
    validateConfig({
      active_provider: 'qwen',
      providers: {
        qwen: {
          type: 'openai_compatible',
          display_name: 'Qwen',
          base_url: 'https://example.com/v1',
          model: 'qwen3.5-plus',
          api_key: 'test-key',
          llm_endpoint_mode: 'bogus'
        }
      }
    });
  }, /llm_endpoint_mode must be one of/);

  assert.throws(() => {
    validateConfig({
      active_provider: 'qwen',
      providers: {
        qwen: {
          type: 'openai_compatible',
          display_name: 'Qwen',
          base_url: 'https://example.com/v1',
          model: 'qwen3.5-plus',
          api_key: 'test-key',
          responses: {
            enabled: true,
            fallback_policy: 'never',
            session_cache: {
              model_allowlist: ['qwen3.5-plus']
            }
          }
        }
      }
    });
  }, /responses.fallback_policy must be one of/);

  assert.throws(() => {
    validateConfig({
      active_provider: 'qwen',
      providers: {
        qwen: {
          type: 'openai_compatible',
          display_name: 'Qwen',
          base_url: 'https://example.com/v1',
          model: 'qwen3.5-plus',
          api_key: 'test-key',
          responses: {
            model_allowlist: ['qwen3.5-plus', ''],
            session_cache: {
              model_allowlist: ['qwen3.5-plus']
            }
          }
        }
      }
    });
  }, /responses.model_allowlist must contain non-empty strings/);

  assert.throws(() => {
    validateConfig({
      active_provider: 'qwen',
      providers: {
        qwen: {
          type: 'openai_compatible',
          display_name: 'Qwen',
          base_url: 'https://example.com/v1',
          model: 'qwen3.5-plus',
          api_key: 'test-key',
          responses: {
            session_cache: {
              model_allowlist: ['qwen3.5-plus', '']
            }
          }
        }
      }
    });
  }, /model_allowlist must contain non-empty strings/);
});
