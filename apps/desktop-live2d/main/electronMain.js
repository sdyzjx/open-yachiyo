const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require('electron');

const { startDesktopSuite } = require('./desktopSuite');
const { createTrayController } = require('./trayController');
const { resolveDesktopPathRoots } = require('./desktopPathRoots');

const ONBOARDING_CHECK_INTERVAL_MS = 2500;
const HTTP_TIMEOUT_MS = 5000;

let suite = null;
let trayController = null;
let shuttingDown = false;
let bootstrapPromise = null;
let onboardingWindow = null;
let onboardingCheckTimer = null;
let onboardingCheckInFlight = false;
let onboardingRequired = false;
let openPathHandlerRegistered = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function toOnboardingUrl(gatewayUrl) {
  return new URL('/onboarding.html', gatewayUrl).toString();
}

async function fetchOnboardingState(gatewayUrl) {
  const url = new URL('/api/onboarding/state', gatewayUrl).toString();
  const response = await withTimeout(fetch(url), HTTP_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`onboarding state request failed: ${response.status}`);
  }
  return response.json();
}

async function isOnboardingCompleted(gatewayUrl) {
  try {
    const payload = await fetchOnboardingState(gatewayUrl);
    return Boolean(payload?.ok && payload?.data?.done === true);
  } catch (err) {
    console.warn('[desktop-live2d] onboarding state check failed, fallback to onboarding', err?.message || err);
    return false;
  }
}

function clearOnboardingPoller() {
  if (onboardingCheckTimer) {
    clearInterval(onboardingCheckTimer);
    onboardingCheckTimer = null;
  }
}

function createOnboardingWindow(gatewayUrl) {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    onboardingWindow.focus();
    return onboardingWindow;
  }

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Yachiyo Onboarding',
    webPreferences: {
      preload: path.join(__dirname, 'onboardingPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    onboardingWindow = null;
  });
  win.loadURL(toOnboardingUrl(gatewayUrl));

  onboardingWindow = win;
  return win;
}

function ensureDesktopOpenPathHandler() {
  if (openPathHandlerRegistered) {
    return;
  }

  ipcMain.handle('desktop:openPath', async (_event, targetPath) => {
    try {
      const resolved = String(targetPath || '').trim();
      if (!resolved) return { ok: false, error: 'path is required' };
      const result = await shell.openPath(resolved);
      if (result) return { ok: false, error: result };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  openPathHandlerRegistered = true;
}

function closeOnboardingWindow() {
  if (!onboardingWindow || onboardingWindow.isDestroyed()) {
    onboardingWindow = null;
    return;
  }
  onboardingWindow.close();
  onboardingWindow = null;
}

function enterOnboardingMode(gatewayUrl) {
  onboardingRequired = true;
  hidePetWindow();
  createOnboardingWindow(gatewayUrl);

  if (onboardingCheckTimer) {
    return;
  }

  onboardingCheckTimer = setInterval(async () => {
    if (shuttingDown || onboardingCheckInFlight) {
      return;
    }

    onboardingCheckInFlight = true;
    try {
      const completed = await isOnboardingCompleted(gatewayUrl);
      if (completed) {
        onboardingRequired = false;
        clearOnboardingPoller();
        closeOnboardingWindow();
        showPetWindow();
      }
    } finally {
      onboardingCheckInFlight = false;
    }
  }, ONBOARDING_CHECK_INTERVAL_MS);
}

async function bootstrap() {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    if (suite?.window && !suite.window.isDestroyed()) {
      return suite;
    }

    const roots = resolveDesktopPathRoots({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath()
    });

    suite = await startDesktopSuite({
      app,
      BrowserWindow,
      ipcMain,
      screen,
      shell,
      assetRoot: roots.assetRoot,
      workspaceRoot: roots.workspaceRoot,
      onResizeModeChange: (enabled) => {
        trayController?.setResizeModeEnabled(enabled);
      },
      logger: console
    });

    if (!trayController) {
      trayController = createTrayController({
        Tray,
        Menu,
        nativeImage,
        projectRoot: suite?.config?.assetRoot || roots.assetRoot,
        onShow: () => {
          showPetWindow();
        },
        onHide: () => {
          hidePetWindow();
        },
        onToggleResizeMode: (enabled) => {
          const nextEnabled = suite?.setResizeModeEnabled
            ? suite.setResizeModeEnabled(enabled)
            : Boolean(enabled);
          trayController?.setResizeModeEnabled(nextEnabled);
        },
        isResizeModeEnabled: () => suite?.isResizeModeEnabled?.() || false,
        onQuit: () => {
          app.quit();
        }
      });
    } else if (suite?.isResizeModeEnabled) {
      trayController.setResizeModeEnabled(suite.isResizeModeEnabled());
    }

    console.log('[desktop-live2d] up', {
      rpcUrl: suite.summary.rpcUrl,
      gatewayUrl: suite.summary.gatewayUrl
    });

    const completed = await isOnboardingCompleted(suite.summary.gatewayUrl);
    if (!completed) {
      enterOnboardingMode(suite.summary.gatewayUrl);
    } else {
      showPetWindow();
    }

    return suite;
  })();

  try {
    await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

function hidePetWindow() {
  if (suite?.hidePetWindows) {
    suite.hidePetWindows();
    return;
  }
  if (suite?.window && !suite.window.isDestroyed()) {
    suite.window.hide();
  }
}

function showPetWindow() {
  if (onboardingRequired) {
    if (suite?.summary?.gatewayUrl) {
      createOnboardingWindow(suite.summary.gatewayUrl);
    }
    return;
  }

  if (suite?.showPetWindows) {
    suite.showPetWindows();
    return;
  }
  if (suite?.window && !suite.window.isDestroyed()) {
    suite.window.show();
    suite.window.focus();
    return;
  }
  void bootstrap().catch((err) => {
    console.error('[desktop-live2d] tray show failed', err);
  });
}

async function teardown() {
  if (shuttingDown) return;
  shuttingDown = true;

  clearOnboardingPoller();
  closeOnboardingWindow();

  if (trayController) {
    trayController.destroy();
    trayController = null;
  }
  if (suite) {
    await suite.stop();
    suite = null;
  }
}

app.whenReady().then(bootstrap).catch(async (err) => {
  console.error('[desktop-live2d] bootstrap failed', err);
  await teardown();
  app.quit();
});

app.on('before-quit', async () => {
  await teardown();
});

app.whenReady().then(() => {
  ensureDesktopOpenPathHandler();
}).catch(() => {
  // bootstrap path already handles fatal startup errors
});

app.on('window-all-closed', () => {
  // Keep gateway/runtime alive when pet window is intentionally hidden or closed.
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    showPetWindow();
    return;
  }
  showPetWindow();
});

app.on('second-instance', () => {
  if (onboardingRequired && onboardingWindow && !onboardingWindow.isDestroyed()) {
    if (onboardingWindow.isMinimized?.()) {
      onboardingWindow.restore();
    }
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }

  if (suite?.window && !suite.window.isDestroyed()) {
    if (suite.window.isMinimized?.()) {
      suite.window.restore();
    }
    showPetWindow();
    return;
  }

  void bootstrap().then(() => {
    showPetWindow();
  }).catch((err) => {
    console.error('[desktop-live2d] second-instance bootstrap failed', err);
  });
});
