const fs = require('node:fs');
const path = require('node:path');

const TRAY_TOOLTIP = 'Yachiyo Desktop Pet';
const TRAY_ICON_RELATIVE_PATHS = [
  path.join('assets', 'icon.ico'),
  path.join('assets', 'icon.png')
];

function resolveTrayIconPath({ projectRoot = process.cwd() } = {}) {
  const candidateRoots = [
    projectRoot,
    process.resourcesPath,
    path.join(process.resourcesPath || '', 'app.asar')
  ].filter(Boolean);

  for (const root of candidateRoots) {
    for (const relativePath of TRAY_ICON_RELATIVE_PATHS) {
      const candidate = path.resolve(root, relativePath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return path.resolve(projectRoot, TRAY_ICON_RELATIVE_PATHS[0]);
}

function createTrayImage({ nativeImage, iconPath, size = 18 } = {}) {
  if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
    return null;
  }

  const icon = nativeImage.createFromPath(iconPath);
  if (!icon || typeof icon.isEmpty !== 'function' || icon.isEmpty()) {
    return null;
  }

  if (typeof icon.resize !== 'function') {
    return icon;
  }

  return icon.resize({
    width: size,
    height: size,
    quality: 'best'
  });
}

function createTrayController({
  Tray,
  Menu,
  nativeImage,
  projectRoot = process.cwd(),
  tooltip = TRAY_TOOLTIP,
  onShow = null,
  onHide = null,
  onToggleResizeMode = null,
  isResizeModeEnabled = null,
  onQuit = null
} = {}) {
  if (typeof Tray !== 'function' || !Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new Error('createTrayController requires Electron Tray/Menu');
  }

  const iconPath = resolveTrayIconPath({ projectRoot });
  const icon = createTrayImage({ nativeImage, iconPath });
  const tray = new Tray(icon || nativeImage?.createEmpty?.());

  if (typeof tray.setToolTip === 'function') {
    tray.setToolTip(tooltip);
  }

  let resizeModeEnabled = typeof isResizeModeEnabled === 'function'
    ? Boolean(isResizeModeEnabled())
    : false;

  function buildMenu() {
    return Menu.buildFromTemplate([
      {
        label: 'Show Pet',
        click: () => {
          if (typeof onShow === 'function') {
            void onShow();
          }
        }
      },
      {
        label: 'Hide Pet',
        click: () => {
          if (typeof onHide === 'function') {
            onHide();
          }
        }
      },
      {
        label: 'Resize Mode',
        type: 'checkbox',
        checked: resizeModeEnabled,
        click: (menuItem) => {
          resizeModeEnabled = Boolean(menuItem?.checked);
          if (typeof onToggleResizeMode === 'function') {
            onToggleResizeMode(resizeModeEnabled);
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        click: () => {
          if (typeof onQuit === 'function') {
            onQuit();
          }
        }
      }
    ]);
  }

  let menu = buildMenu();

  if (typeof tray.setContextMenu === 'function') {
    tray.setContextMenu(menu);
  }

  if (typeof tray.on === 'function') {
    tray.on('click', () => {
      if (typeof onShow === 'function') {
        void onShow();
      }
    });
  }

  return {
    tray,
    get menu() {
      return menu;
    },
    iconPath,
    setResizeModeEnabled(enabled) {
      resizeModeEnabled = Boolean(enabled);
      menu = buildMenu();
      if (typeof tray.setContextMenu === 'function') {
        tray.setContextMenu(menu);
      }
    },
    destroy() {
      if (typeof tray?.destroy === 'function') {
        tray.destroy();
      }
    }
  };
}

module.exports = {
  TRAY_TOOLTIP,
  TRAY_ICON_RELATIVE_PATHS,
  resolveTrayIconPath,
  createTrayImage,
  createTrayController
};
