'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.resolve(__dirname, '../../apps/android/app/src/main/assets/web');
const settingsHtml = fs.readFileSync(path.join(webRoot, 'settings.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(webRoot, 'js/settings.js'), 'utf8');

test('Android settings remain client-only and expose no model configuration API', () => {
  assert.doesNotMatch(settingsHtml, /settingsModels|模型选择|供应商|API\s*key/i);
  assert.doesNotMatch(settingsJs, /\/api\/config\/models|active_model|enabled_models|has_api_key|provider/i);
  assert.match(settingsJs, /hubConnect/);
  assert.match(settingsJs, /pickBackground/);
  assert.match(settingsJs, /pickPluginPackage/);
});
