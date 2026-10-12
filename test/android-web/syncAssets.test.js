'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseArgs, resolveRequest, TEXTURE_SIZES, SHARED_FILES } = require('../../scripts/android-sync-assets');

test('parseArgs reads serve/port/model flags', () => {
  const opts = parseArgs(['--serve', '--port', '9000', '--model', 'x', '--skip-model']);
  assert.equal(opts.serve, true);
  assert.equal(opts.port, 9000);
  assert.equal(opts.model, 'x');
  assert.equal(opts.skipModel, true);
  assert.equal(parseArgs([]).port, 8790);
});

test('texture tiers are 4096 and 2048', () => {
  assert.deepEqual(TEXTURE_SIZES, [4096, 2048]);
});

test('every shared module exists in the desktop sources', () => {
  const fs = require('node:fs');
  for (const [from] of SHARED_FILES) {
    assert.ok(fs.existsSync(path.join(__dirname, '../..', from)), from);
  }
});

test('dev server maps /sdk/ to web/sdk and /web/ to assets root (C6)', () => {
  assert.match(resolveRequest('/sdk/yachiyo-plugin-sdk.js'), /assets\/web\/sdk\/yachiyo-plugin-sdk\.js$/);
  assert.match(resolveRequest('/web/index.html'), /assets\/web\/index\.html$/);
  assert.match(resolveRequest('/generated/manifest.json'), /assets\/generated\/manifest\.json$/);
});
