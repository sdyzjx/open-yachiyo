const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  syncProvidersMissingDefaults,
  syncToolsMissingDefaults
} = require('../../apps/gateway/configSync');

test('syncProvidersMissingDefaults keeps custom providers map intact and fills active_provider', () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'providers-sync-')), 'providers.yaml');
  fs.writeFileSync(configPath, `providers:
  custom_llm:
    type: openai_compatible
    base_url: https://example.com/v1
    model: demo-model
    api_key_env: DEMO_API_KEY
`, 'utf8');

  const result = syncProvidersMissingDefaults(configPath);

  assert.equal(result.nextRaw.active_provider, 'custom_llm');
  assert.ok(result.addedPaths.includes('active_provider'));
  assert.ok(!result.nextRaw.providers.openai);
  assert.ok(!result.nextRaw.providers.qwen3_tts);
  assert.equal(result.nextRaw.providers.custom_llm.model, 'demo-model');
});

test('syncToolsMissingDefaults fills policy and exec without overwriting existing tools array', () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-sync-')), 'tools.yaml');
  fs.writeFileSync(configPath, `version: 1
tools:
  - name: custom.echo
    type: local
    adapter: builtin.echo
    description: custom echo
    side_effect_level: none
    input_schema:
      type: object
      properties:
        text: { type: string }
      required: [text]
      additionalProperties: false
`, 'utf8');

  const result = syncToolsMissingDefaults(configPath);

  assert.equal(result.nextRaw.tools.length, 1);
  assert.equal(result.nextRaw.tools[0].name, 'custom.echo');
  assert.ok(result.addedPaths.includes('policy'));
  assert.ok(result.addedPaths.includes('exec'));
});
