const test = require('node:test');
const assert = require('node:assert/strict');

const { PROJECT_ROOT } = require('../../apps/desktop-live2d/main/constants');
const { resolveDesktopPathRoots } = require('../../apps/desktop-live2d/main/desktopPathRoots');

test('resolveDesktopPathRoots uses workspace roots during development', () => {
  const roots = resolveDesktopPathRoots({
    isPackaged: false,
    appPath: '/Applications/Open Yachiyo.app/Contents/Resources/app.asar'
  });

  assert.equal(roots.assetRoot, PROJECT_ROOT);
  assert.equal(roots.workspaceRoot, PROJECT_ROOT);
});

test('resolveDesktopPathRoots uses app path for packaged assets', () => {
  const roots = resolveDesktopPathRoots({
    isPackaged: true,
    appPath: '/Applications/Open Yachiyo.app/Contents/Resources/app.asar'
  });

  assert.equal(roots.assetRoot, '/Applications/Open Yachiyo.app/Contents/Resources/app.asar');
  assert.equal(roots.workspaceRoot, null);
});
