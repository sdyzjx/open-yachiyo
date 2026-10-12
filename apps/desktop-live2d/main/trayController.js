const fs = require('node:fs');
const path = require('node:path');

const { buildMenuTemplate } = require('./shellModel');

const TRAY_TOOLTIP = 'Yachiyo 八千代';
// macOS needs a "Template" PNG (black + alpha, 16/32 px); other platforms use the app icons.
const TRAY_ICON_RELATIVE_PATHS_DARWIN = [path.join('assets', 'tray', 'yachiyoTemplate.png')];
const TRAY_ICON_RELATIVE_PATHS_OTHER = [
  path.join('assets', 'icon.ico'),
  path.join('assets', 'icon-transparent.png'),
  path.join('assets', 'icon.png')
];
const TRAY_ICON_RELATIVE_PATHS = TRAY_ICON_RELATIVE_PATHS_DARWIN;
const TRAY_ICON_RELATIVE_PATH = TRAY_ICON_RELATIVE_PATHS[0];
// 32 px template icon embedded as a last resort, so the menu-bar item can never end up invisible
// because an asset was missing from the package.
const EMBEDDED_TEMPLATE_ICON_2X_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABhUlEQVR4nGNgGAX0ARwD7YB+IGYZKMsdgPg/EJdQahAPEHtADUphIM5HGkD8HOqA31DHkAx0gHg+EH+HGnQYiEWI0GeDZDkMg8xIIdZiUMLpZoC4HGYAyHIeAvoEgHg6msXoeDcQK+AzRAJqGbKm11BxYgDIEZNxWL4diFXwaQb58DQWjUQHHRIoQDODqNwwG4vlIN+Tm5ebGRA+JwgcsFgOwvPJtBwEQD6+DMQyxCjejcMBORQ4AATwxjmyIlyp1oNCBxAF0BMMMnahhwOwJT5KcgDJYD8eB0wfaAc8pocDNuNxAAgH0NoB3QQccJuBcD1AEfAh4AAQXkxLB4CK2vdEOAKUIGnWuuknwgEgfByIDYgwD1QrOpDiAJCG10Q6AlbBJDBAWj6wUAFV2R5Qz4DM0iHFASBATFogFleQajkM4CuWicX95FoOAwkMiHYgKRjUhGug1HIYAMUtrioaGz7PAGmMUh2AUjwoSC9jsRRUQIEqMgdaWIwNgFK7AhQPeJdr6AMASGLqxZE2bfUAAAAASUVORK5CYII=';

function iconCandidates(platform) {
  return platform === 'darwin' ? TRAY_ICON_RELATIVE_PATHS_DARWIN : TRAY_ICON_RELATIVE_PATHS_OTHER;
}

function resolveTrayIconPath({ projectRoot = process.cwd(), platform = process.platform } = {}) {
  const candidateRoots = [
    projectRoot,
    process.resourcesPath,
    path.join(process.resourcesPath || '', 'app.asar')
  ].filter(Boolean);

  for (const root of candidateRoots) {
    for (const relativePath of iconCandidates(platform)) {
      const candidate = path.resolve(root, relativePath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return path.resolve(projectRoot, iconCandidates(platform)[0]);
}

function isUsableImage(image) {
  return Boolean(image) && typeof image.isEmpty === 'function' && !image.isEmpty();
}

function createTrayImage({ nativeImage, iconPath, size = 18, platform = process.platform } = {}) {
  if (!nativeImage) {
    return null;
  }

  let icon = typeof nativeImage.createFromPath === 'function' ? nativeImage.createFromPath(iconPath) : null;
  if (!isUsableImage(icon) && platform === 'darwin' && typeof nativeImage.createFromBuffer === 'function') {
    icon = nativeImage.createFromBuffer(Buffer.from(EMBEDDED_TEMPLATE_ICON_2X_BASE64, 'base64'), { scaleFactor: 2 });
  }
  if (!isUsableImage(icon)) {
    return null;
  }

  // The template PNGs are already 16 px (+@2x); resizing would blur them and drop the @2x pairing.
  let image = icon;
  if (platform !== 'darwin' && typeof icon.resize === 'function') {
    image = icon.resize({ width: size, height: size, quality: 'best' });
  }
  if (platform === 'darwin' && typeof image.setTemplateImage === 'function') {
    image.setTemplateImage(true);
  }
  return image;
}

/**
 * Menu-bar (system tray) item. The menu is rebuilt from the shared shell state on every refresh
 * so enable/disable always matches reality; left and right click open the same menu.
 */
function createTrayController({
  Tray,
  Menu,
  nativeImage,
  projectRoot = process.cwd(),
  platform = process.platform,
  tooltip = TRAY_TOOLTIP,
  getShellState,
  actions = {}
} = {}) {
  if (typeof Tray !== 'function' || !Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new Error('createTrayController requires Electron Tray/Menu');
  }
  if (typeof getShellState !== 'function') {
    throw new Error('createTrayController requires getShellState');
  }

  const iconPath = resolveTrayIconPath({ projectRoot, platform });
  const icon = createTrayImage({ nativeImage, iconPath, platform });
  if (!icon) {
    throw new Error(`Tray icon is unavailable: ${iconPath}`);
  }
  const tray = new Tray(icon);
  if (typeof tray.setToolTip === 'function') {
    tray.setToolTip(tooltip);
  }

  let menu = null;
  function refresh() {
    menu = Menu.buildFromTemplate(buildMenuTemplate(getShellState(), actions, 'tray'));
    if (typeof tray.setContextMenu === 'function') {
      tray.setContextMenu(menu);
    }
    return menu;
  }
  refresh();

  // macOS opens the context menu for both buttons by itself. Elsewhere a left click would do
  // nothing with setContextMenu alone, so pop the same menu explicitly (right click is native).
  if (platform !== 'darwin' && typeof tray.on === 'function') {
    tray.on('click', () => {
      refresh();
      tray.popUpContextMenu?.(menu);
    });
  }

  return {
    tray,
    get menu() {
      return menu;
    },
    iconPath,
    refresh,
    destroy() {
      if (typeof tray?.destroy === 'function') {
        tray.destroy();
      }
    }
  };
}

module.exports = {
  TRAY_TOOLTIP,
  TRAY_ICON_RELATIVE_PATH,
  TRAY_ICON_RELATIVE_PATHS,
  resolveTrayIconPath,
  createTrayImage,
  createTrayController
};
