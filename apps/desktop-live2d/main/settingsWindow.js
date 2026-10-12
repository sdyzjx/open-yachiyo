'use strict';

const path = require('node:path');

const SETTINGS_WINDOW = Object.freeze({ width: 1100, height: 760, minWidth: 900, minHeight: 620 });
const SETTINGS_PAGE_PATH = '/config-v2.html';
const ERR_ABORTED = -3; // navigation superseded by another load: not a failure

function buildSettingsUrl(gatewayUrl) {
  return new URL(SETTINGS_PAGE_PATH, String(gatewayUrl || '')).toString();
}

function isSameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

/**
 * Standard window hosting the gateway's config WebUI. When the gateway is unreachable (or answers
 * with an HTTP error) it shows the themed error page, whose retry button navigates back to the target.
 */
function createSettingsWindowController({
  BrowserWindow,
  shell = null,
  getGatewayUrl,
  errorPagePath = path.join(__dirname, '..', 'renderer', 'settingsError.html'),
  logger = console
} = {}) {
  if (!BrowserWindow || typeof getGatewayUrl !== 'function') {
    throw new Error('createSettingsWindowController requires BrowserWindow and getGatewayUrl');
  }
  let win = null;
  let showingError = false;

  function showError(reason) {
    if (!win || win.isDestroyed()) return;
    showingError = true;
    const target = buildSettingsUrl(getGatewayUrl());
    void win.loadFile(errorPagePath, { query: { target, reason: String(reason || '') } }).catch((err) => {
      logger.warn?.('[desktop-settings] error page failed to load', err?.message || err);
    });
  }

  function attach(created) {
    const web = created.webContents;
    web.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      if (showingError && String(validatedUrl).startsWith('file:')) return;
      showError(errorDescription || `error ${errorCode}`);
    });
    web.on('did-navigate', (_event, url, httpResponseCode) => {
      if (String(url).startsWith('file:')) return;
      showingError = false;
      if (Number(httpResponseCode) >= 400) showError(`HTTP ${httpResponseCode}`);
    });
    // The settings window may only show the gateway UI or its own error page.
    web.on('will-navigate', (event, url) => {
      const allowed = isSameOrigin(url, buildSettingsUrl(getGatewayUrl())) || String(url).startsWith('file:');
      if (!allowed) event.preventDefault();
    });
    web.setWindowOpenHandler?.(({ url }) => {
      if (/^https?:/i.test(url)) void shell?.openExternal?.(url);
      return { action: 'deny' };
    });
  }

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized?.()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    const url = buildSettingsUrl(getGatewayUrl());
    win = new BrowserWindow({
      ...SETTINGS_WINDOW,
      show: false,
      title: '八千代设置',
      backgroundColor: '#090b20',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    showingError = false;
    attach(win);
    win.once('ready-to-show', () => {
      win?.show();
      win?.focus();
    });
    win.on('closed', () => {
      win = null;
    });
    void win.loadURL(url).catch(() => {
      // did-fail-load already routes this to the error page.
    });
    return win;
  }

  return {
    open,
    close() {
      if (win && !win.isDestroyed()) win.close();
      win = null;
    },
    get window() { return win; },
    isOpen: () => Boolean(win && !win.isDestroyed())
  };
}

module.exports = { SETTINGS_WINDOW, buildSettingsUrl, createSettingsWindowController };
