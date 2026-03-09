const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const { waitForGateway } = require('./waitForGateway');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const GATEWAY_ENTRY = path.join(PROJECT_ROOT, 'apps', 'gateway', 'server.js');
const GATEWAY_PORT = Number(process.env.PORT) || 3000;
const GATEWAY_URL = process.env.DESKTOP_GATEWAY_URL || `http://127.0.0.1:${GATEWAY_PORT}`;
const START_EMBEDDED_GATEWAY = process.env.DESKTOP_EXTERNAL_GATEWAY !== '1';
const GATEWAY_CWD = app.isPackaged ? path.dirname(process.execPath) : PROJECT_ROOT;

let gatewayProcess = null;
let forceQuit = false;

function startGatewayProcess() {
  gatewayProcess = spawn(process.execPath, [GATEWAY_ENTRY], {
    cwd: GATEWAY_CWD,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: process.env.HOST || '127.0.0.1',
      PORT: String(GATEWAY_PORT)
    },
    stdio: 'inherit'
  });

  gatewayProcess.on('exit', (code, signal) => {
    gatewayProcess = null;
    if (forceQuit) return;
    console.error(`Gateway process exited unexpectedly (code=${code}, signal=${signal})`);
    app.quit();
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

app.whenReady().then(async () => {
  if (START_EMBEDDED_GATEWAY) {
    startGatewayProcess();
  }

  await waitForGateway(GATEWAY_URL, { timeoutMs: 30000 });
  const entryUrl = await resolveInitialEntryUrl();
  createMainWindow(entryUrl);
}).catch((err) => {
  console.error('Desktop bootstrap failed:', err);
  app.quit();
});
