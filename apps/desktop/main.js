const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const { waitForGateway } = require('./waitForGateway');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'apps', 'gateway', 'server.js');
const GATEWAY_PORT = Number(process.env.PORT) || 3000;
const GATEWAY_URL = process.env.DESKTOP_GATEWAY_URL || `http://127.0.0.1:${GATEWAY_PORT}`;
const START_EMBEDDED_GATEWAY = process.env.DESKTOP_EXTERNAL_GATEWAY !== '1';
const GATEWAY_CWD = app.isPackaged ? path.dirname(process.execPath) : PROJECT_ROOT;
const GATEWAY_ENTRY_PACKAGED = path.join(process.resourcesPath, 'app.asar', 'apps', 'gateway', 'server.js');
const GATEWAY_ENTRY_PATH = app.isPackaged ? GATEWAY_ENTRY_PACKAGED : GATEWAY_ENTRY;

let gatewayProcess = null;
let forceQuit = false;

function getBootstrapLogPath() {
  return path.join(app.getPath('userData'), 'desktop-bootstrap.log');
}

function appendBootstrapLog(message) {
  const bootstrapLogPath = getBootstrapLogPath();
  const line = `${new Date().toISOString()} ${String(message || '')}\n`;
  try {
    fs.mkdirSync(path.dirname(bootstrapLogPath), { recursive: true });
    fs.appendFileSync(bootstrapLogPath, line, 'utf8');
  } catch {
    // ignore logging errors
  }
}

function showBootstrapErrorWindow(errorMessage) {
  const bootstrapLogPath = getBootstrapLogPath();
  const win = new BrowserWindow({
    width: 760,
    height: 520,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const escapedMsg = String(errorMessage || 'unknown error')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const escapedLogPath = bootstrapLogPath.replaceAll('\\', '\\\\');
  const html = `
    <html>
      <body style="font-family: Segoe UI, sans-serif; padding: 20px;">
        <h2>Open Yachiyo failed to start</h2>
        <p>Please copy the error and log file path below.</p>
        <pre style="white-space: pre-wrap; border: 1px solid #ddd; padding: 12px;">${escapedMsg}</pre>
        <p>Log file:</p>
        <pre style="border: 1px solid #ddd; padding: 12px;">${escapedLogPath}</pre>
      </body>
    </html>
  `;
  win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
}

function startGatewayProcess() {
  appendBootstrapLog(`spawning gateway: ${GATEWAY_ENTRY_PATH}`);
  gatewayProcess = spawn(process.execPath, [GATEWAY_ENTRY_PATH], {
    cwd: GATEWAY_CWD,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: process.env.HOST || '127.0.0.1',
      PORT: String(GATEWAY_PORT)
    },
    stdio: app.isPackaged ? 'pipe' : 'inherit',
    windowsHide: true
  });

  if (app.isPackaged && gatewayProcess.stdout) {
    gatewayProcess.stdout.on('data', (chunk) => {
      appendBootstrapLog(`[gateway:stdout] ${String(chunk || '').trim()}`);
    });
  }
  if (app.isPackaged && gatewayProcess.stderr) {
    gatewayProcess.stderr.on('data', (chunk) => {
      appendBootstrapLog(`[gateway:stderr] ${String(chunk || '').trim()}`);
    });
  }
  gatewayProcess.on('error', (err) => {
    appendBootstrapLog(`gateway spawn error: ${err?.stack || err?.message || err}`);
  });

  gatewayProcess.on('exit', (code, signal) => {
    gatewayProcess = null;
    appendBootstrapLog(`gateway exited: code=${code} signal=${signal}`);
    if (forceQuit) return;
    showBootstrapErrorWindow(`Gateway process exited unexpectedly (code=${code}, signal=${signal})`);
  });
}

function stopGatewayProcess() {
  if (!gatewayProcess || gatewayProcess.killed) return;
  gatewayProcess.kill('SIGTERM');
  setTimeout(() => {
    if (gatewayProcess && !gatewayProcess.killed) {
      gatewayProcess.kill('SIGKILL');
    }
  }, 2000);
}

function createMainWindow(entryUrl = GATEWAY_URL) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(entryUrl);
}

async function resolveInitialEntryUrl() {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/onboarding/state`);
    if (!response.ok) return GATEWAY_URL;
    const payload = await response.json();
    if (payload?.ok && payload?.data?.done === false) {
      return `${GATEWAY_URL}/onboarding.html`;
    }
  } catch {
    // fallback to default chat page
  }
  return GATEWAY_URL;
}

app.on('before-quit', () => {
  forceQuit = true;
  stopGatewayProcess();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length !== 0) return;
  resolveInitialEntryUrl()
    .then((entryUrl) => createMainWindow(entryUrl))
    .catch(() => createMainWindow());
});

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

app.whenReady().then(async () => {
  appendBootstrapLog('desktop bootstrap start');
  if (START_EMBEDDED_GATEWAY) {
    startGatewayProcess();
  }

  await waitForGateway(GATEWAY_URL, { timeoutMs: 30000 });
  appendBootstrapLog(`gateway ready: ${GATEWAY_URL}`);
  const entryUrl = await resolveInitialEntryUrl();
  appendBootstrapLog(`loading window url: ${entryUrl}`);
  createMainWindow(entryUrl);
}).catch((err) => {
  const detail = err?.stack || err?.message || String(err);
  appendBootstrapLog(`desktop bootstrap failed: ${detail}`);
  showBootstrapErrorWindow(detail);
});
