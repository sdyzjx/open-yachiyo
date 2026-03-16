const { PROJECT_ROOT } = require('./constants');

function resolveDesktopPathRoots({
  isPackaged = false,
  appPath = PROJECT_ROOT,
  fallbackAssetRoot = PROJECT_ROOT
} = {}) {
  if (isPackaged) {
    return {
      assetRoot: appPath,
      workspaceRoot: null
    };
  }

  return {
    assetRoot: fallbackAssetRoot,
    workspaceRoot: fallbackAssetRoot
  };
}

module.exports = {
  resolveDesktopPathRoots
};
