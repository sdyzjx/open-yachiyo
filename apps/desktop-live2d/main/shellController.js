'use strict';

const { createTrayController } = require('./trayController');
const { computeShellState, buildMenuTemplate, resolveActivateAction } = require('./shellModel');

// macOS fires "activate" once while the app is still launching; that is not a Dock click.
const ACTIVATE_STARTUP_GRACE_MS = 2500;

/**
 * Owns every native entry point of the desktop shell: menu-bar item, Dock menu, Dock click and the
 * character's right-click menu. All of them render from one shell state, so they cannot disagree.
 */
function createShellController({
  app,
  Tray,
  Menu,
  nativeImage,
  projectRoot,
  platform = process.platform,
  getInputs,
  actions = {},
  now = () => Date.now(),
  logger = console
} = {}) {
  if (typeof getInputs !== 'function') {
    throw new Error('createShellController requires getInputs');
  }

  const startedAt = now();
  const getShellState = () => computeShellState(getInputs());
  let tray = null;
  let destroyed = false;

  if (platform === 'darwin') {
    // The Dock icon is always present, also while only the transparent avatar window exists.
    try {
      app?.dock?.show?.();
    } catch (err) {
      logger.warn?.('[desktop-shell] dock.show failed', err?.message || err);
    }
  }

  try {
    tray = createTrayController({ Tray, Menu, nativeImage, projectRoot, platform, getShellState, actions });
  } catch (err) {
    // A missing menu-bar item must be loud: it is the primary entry point.
    logger.error?.('[desktop-shell] tray creation failed', err?.message || err);
  }

  function refreshDock() {
    if (platform !== 'darwin' || !app?.dock?.setMenu) return;
    app.dock.setMenu(Menu.buildFromTemplate(buildMenuTemplate(getShellState(), actions, 'dock')));
  }

  function refresh() {
    if (destroyed) return;
    try {
      tray?.refresh();
      refreshDock();
    } catch (err) {
      logger.warn?.('[desktop-shell] refresh failed', err?.message || err);
    }
  }
  refresh();

  function popupAvatarMenu(window) {
    const menu = Menu.buildFromTemplate(buildMenuTemplate(getShellState(), actions, 'avatar'));
    menu.popup(window ? { window } : undefined);
    return menu;
  }

  /** Dock click / second launch: chat when the avatar is on the desktop and visible, else settings. */
  function handleActivate({ force = false } = {}) {
    if (destroyed) return null;
    if (!force && now() - startedAt < ACTIVATE_STARTUP_GRACE_MS) return null;
    const action = resolveActivateAction(getShellState());
    actions[action]?.();
    return action;
  }

  return {
    get tray() { return tray; },
    refresh,
    popupAvatarMenu,
    handleActivate,
    getShellState,
    destroy() {
      destroyed = true;
      tray?.destroy();
      tray = null;
    }
  };
}

module.exports = { ACTIVATE_STARTUP_GRACE_MS, createShellController };
