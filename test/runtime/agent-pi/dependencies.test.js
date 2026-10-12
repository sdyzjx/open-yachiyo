const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('TC-PI-001 pi dependency versions are exact and installed', () => {
  const root = path.resolve(__dirname, '../../..');
  const manifest = require('../../../package.json');
  for (const name of ['pi-coding-agent', 'pi-ai', 'pi-agent-core']) {
    const id = `@earendil-works/${name}`;
    assert.equal(manifest.dependencies[id], '1.1.0');
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', id, 'package.json')));
    assert.equal(installed.version, manifest.dependencies[id]);
    assert.equal(installed.type, 'module');
  }
});
