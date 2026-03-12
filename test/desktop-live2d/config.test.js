const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveDesktopLive2dConfig,
  upsertDesktopLive2dLayoutOverrides,
  upsertDesktopLive2dDragZoneOverrides,
  parseJsonWithComments,
  syncDesktopLive2dMissingDefaults
} = require('../../apps/desktop-live2d/main/config');

test('resolveDesktopLive2dConfig applies defaults and model relative path', () => {
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));
  const config = resolveDesktopLive2dConfig({ env: { YACHIYO_HOME: yachiyoHome } });

  assert.equal(config.rpcPort, 17373);
  assert.equal(config.modelJsonName, '八千代辉夜姬.model3.json');
  assert.ok(config.modelRelativePath.includes('assets/live2d/yachiyo-kaguya/八千代辉夜姬.model3.json'));
  assert.ok(config.windowStatePath.endsWith(path.join('desktop-live2d', 'window-state.json')));
  assert.equal(config.gatewayExternal, false);
  assert.equal(config.desktopCaptureTtlMs, 5 * 60 * 1000);
  assert.equal(config.desktopCaptureCleanupIntervalMs, 60 * 1000);
  assert.equal(config.uiConfig.chat.panel.enabled, true);
  assert.equal(config.uiConfig.chat.panel.defaultVisible, false);
  assert.equal(config.uiConfig.window.maxWidth, 900);
  assert.equal(config.uiConfig.window.maxHeight, 1400);
  assert.equal(config.uiConfig.layout.lockScaleOnResize, true);
  assert.equal(config.uiConfig.layout.lockPositionOnResize, true);
  assert.equal(config.uiConfig.window.compactWhenChatHidden, false);
  assert.equal(config.uiConfig.window.compactWidth, 320);
  assert.equal(config.uiConfig.window.compactHeight, 600);
  assert.equal(config.uiConfig.actionQueue.maxQueueSize, 120);
  assert.equal(config.uiConfig.actionQueue.overflowPolicy, 'drop_oldest');
  assert.equal(config.uiConfig.actionQueue.idleFallbackEnabled, true);
  assert.equal(config.uiConfig.actionQueue.idleAction.type, 'motion');
  assert.equal(config.uiConfig.actionQueue.idleAction.name, 'Idle');
  assert.equal(config.uiConfig.actionQueue.idleAction.args.group, 'Idle');
  assert.equal(config.uiConfig.debug.mouthTuner.visible, false);
  assert.equal(config.uiConfig.debug.mouthTuner.enabled, false);
  assert.equal(config.uiConfig.debug.waveformCapture.enabled, false);
  assert.equal(config.uiConfig.debug.waveformCapture.captureEveryFrame, true);
  assert.equal(config.uiConfig.debug.waveformCapture.includeApplied, true);
  assert.equal(config.uiConfig.voice.path, 'electron_native');
  assert.equal(config.uiConfig.voice.transport, 'realtime');
  assert.equal(config.uiConfig.voice.outputDelayMs, 9);
  assert.equal(config.uiConfig.voice.fallbackOnRealtimeError, true);
  assert.equal(config.uiConfig.voice.realtime.prebufferMs, 160);
  assert.equal(config.uiConfig.voice.realtime.idleTimeoutMs, 8000);
  assert.equal(config.uiConfig.interaction.dragZone.centerXRatio, 0.5);
  assert.equal(config.uiConfig.interaction.dragZone.centerYRatio, 0.5);
  assert.equal(config.uiConfig.interaction.dragZone.widthRatio, 0.333);
  assert.equal(config.uiConfig.interaction.dragZone.heightRatio, 0.333);
});

test('resolveDesktopLive2dConfig respects env overrides', () => {
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));
  const config = resolveDesktopLive2dConfig({
    env: {
      YACHIYO_HOME: yachiyoHome,
      PORT: '3100',
      DESKTOP_GATEWAY_URL: 'http://127.0.0.1:3200',
      DESKTOP_LIVE2D_RPC_PORT: '18080',
      DESKTOP_LIVE2D_RPC_TOKEN: 'fixed',
      DESKTOP_EXTERNAL_GATEWAY: '1',
      DESKTOP_LIVE2D_CAPTURE_TTL_MS: '90000',
      DESKTOP_LIVE2D_CAPTURE_CLEANUP_INTERVAL_MS: '15000'
    },
    projectRoot: '/tmp/project'
  });

  assert.equal(config.gatewayPort, 3100);
  assert.equal(config.gatewayUrl, 'http://127.0.0.1:3200');
  assert.equal(config.rpcPort, 18080);
  assert.equal(config.rpcToken, 'fixed');
  assert.equal(config.gatewayExternal, true);
  assert.equal(config.desktopCaptureTtlMs, 90000);
  assert.equal(config.desktopCaptureCleanupIntervalMs, 15000);
  assert.equal(config.modelDir, path.join('/tmp/project', 'assets', 'live2d', 'yachiyo-kaguya'));
});

test('resolveDesktopLive2dConfig clamps drag zone to stay inside window ratios', () => {
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));
  fs.mkdirSync(path.join(yachiyoHome, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(yachiyoHome, 'config', 'desktop-live2d.json'),
    JSON.stringify({
      interaction: {
        dragZone: {
          centerXRatio: 0.95,
          centerYRatio: 0.05,
          widthRatio: 0.8,
          heightRatio: 0.6
        }
      }
    }),
    'utf8'
  );

  const config = resolveDesktopLive2dConfig({ env: { YACHIYO_HOME: yachiyoHome } });

  assert.deepEqual(config.uiConfig.interaction.dragZone, {
    centerXRatio: 0.6,
    centerYRatio: 0.3,
    widthRatio: 0.8,
    heightRatio: 0.6
  });
});

test('resolveDesktopLive2dConfig loads overrides from YACHIYO_HOME/config/desktop-live2d.json', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-config-'));
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));
  fs.mkdirSync(path.join(yachiyoHome, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(yachiyoHome, 'config', 'desktop-live2d.json'),
    JSON.stringify({
      window: {
        width: 520,
        maxWidth: 880,
        compactWidth: 280,
        placement: {
          anchor: 'top-left',
          marginTop: 30
        }
      },
      render: {
        resolutionScale: 1.2
      },
      layout: {
        scaleMultiplier: 0.95,
        lockScaleOnResize: false,
        lockPositionOnResize: false
      },
      chat: {
        panel: {
          defaultVisible: false,
          maxMessages: 88
        }
      },
      debug: {
        mouthTuner: {
          visible: true,
          enabled: false
        },
        waveformCapture: {
          enabled: true,
          captureEveryFrame: true,
          includeApplied: false
        }
      },
      actionQueue: {
        maxQueueSize: 32,
        overflowPolicy: 'drop_newest',
        idleFallbackEnabled: false,
        idleAction: {
          type: 'expression',
          name: 'smile'
        }
      },
      voice: {
        path: 'runtime_legacy',
        transport: 'realtime',
        output_delay_ms: 80,
        fallback_on_realtime_error: false,
        realtime: {
          prebuffer_ms: 240,
          idle_timeout_ms: 12000
        }
      }
    }),
    'utf8'
  );

  const config = resolveDesktopLive2dConfig({
    env: { YACHIYO_HOME: yachiyoHome },
    projectRoot
  });
  assert.equal(config.uiConfig.window.width, 520);
  assert.equal(config.uiConfig.window.maxWidth, 880);
  assert.equal(config.uiConfig.window.compactWidth, 280);
  assert.equal(config.uiConfig.window.placement.anchor, 'top-left');
  assert.equal(config.uiConfig.window.placement.marginTop, 30);
  assert.equal(config.uiConfig.render.resolutionScale, 1.2);
  assert.equal(config.uiConfig.layout.scaleMultiplier, 0.95);
  assert.equal(config.uiConfig.layout.lockScaleOnResize, false);
  assert.equal(config.uiConfig.layout.lockPositionOnResize, false);
  assert.equal(config.uiConfig.chat.panel.defaultVisible, false);
  assert.equal(config.uiConfig.chat.panel.maxMessages, 88);
  assert.equal(config.uiConfig.debug.mouthTuner.visible, true);
  assert.equal(config.uiConfig.debug.mouthTuner.enabled, false);
  assert.equal(config.uiConfig.debug.waveformCapture.enabled, true);
  assert.equal(config.uiConfig.debug.waveformCapture.captureEveryFrame, true);
  assert.equal(config.uiConfig.debug.waveformCapture.includeApplied, false);
  assert.equal(config.uiConfig.actionQueue.maxQueueSize, 32);
  assert.equal(config.uiConfig.actionQueue.overflowPolicy, 'drop_newest');
  assert.equal(config.uiConfig.actionQueue.idleFallbackEnabled, false);
  assert.equal(config.uiConfig.actionQueue.idleAction.type, 'expression');
  assert.equal(config.uiConfig.actionQueue.idleAction.name, 'smile');
  assert.equal(config.uiConfig.voice.path, 'runtime_legacy');
  assert.equal(config.uiConfig.voice.transport, 'realtime');
  assert.equal(config.uiConfig.voice.outputDelayMs, 80);
  assert.equal(config.uiConfig.voice.fallbackOnRealtimeError, false);
  assert.equal(config.uiConfig.voice.realtime.prebufferMs, 240);
  assert.equal(config.uiConfig.voice.realtime.idleTimeoutMs, 12000);
});

test('resolveDesktopLive2dConfig accepts comments in desktop-live2d.json', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-config-'));
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));
  fs.mkdirSync(path.join(yachiyoHome, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(yachiyoHome, 'config', 'desktop-live2d.json'),
    `{
      // Keep the avatar slightly larger than code defaults.
      "window": {
        "width": 410,
        "height": 640
      },
      /* Chat panel starts hidden for desktop mode. */
      "chat": {
        "panel": {
          "defaultVisible": false
        }
      }
    }`,
    'utf8'
  );

  const config = resolveDesktopLive2dConfig({
    env: { YACHIYO_HOME: yachiyoHome },
    projectRoot
  });

  assert.equal(config.uiConfig.window.width, 410);
  assert.equal(config.uiConfig.window.height, 640);
  assert.equal(config.uiConfig.chat.panel.defaultVisible, false);
});

test('resolveDesktopLive2dConfig writes generated rpc token back to process.env', () => {
  const previousToken = process.env.DESKTOP_LIVE2D_RPC_TOKEN;
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));

  try {
    delete process.env.DESKTOP_LIVE2D_RPC_TOKEN;
    process.env.YACHIYO_HOME = yachiyoHome;

    const config = resolveDesktopLive2dConfig();
    assert.equal(typeof config.rpcToken, 'string');
    assert.ok(config.rpcToken.length > 0);
    assert.equal(process.env.DESKTOP_LIVE2D_RPC_TOKEN, config.rpcToken);
  } finally {
    if (previousToken) process.env.DESKTOP_LIVE2D_RPC_TOKEN = previousToken;
    else delete process.env.DESKTOP_LIVE2D_RPC_TOKEN;
    delete process.env.YACHIYO_HOME;
  }
});

test('upsertDesktopLive2dLayoutOverrides writes layout overrides as commented jsonc', () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-layout-')), 'desktop-live2d.json');
  fs.writeFileSync(configPath, '{\n  // Keep custom window size.\n  "window": {\n    "width": 380\n  }\n}\n', 'utf8');

  const nextRaw = upsertDesktopLive2dLayoutOverrides(configPath, {
    offsetX: 12,
    offsetY: -18,
    scaleMultiplier: 1.13
  });

  const savedText = fs.readFileSync(configPath, 'utf8');
  const saved = parseJsonWithComments(savedText);

  assert.equal(nextRaw.window.width, 380);
  assert.equal(nextRaw.layout.offsetX, 12);
  assert.equal(nextRaw.layout.offsetY, -18);
  assert.equal(nextRaw.layout.scaleMultiplier, 1.13);
  assert.match(savedText, /Layout tuner overrides/);
  assert.equal(saved.window.width, 380);
  assert.equal(saved.layout.offsetX, 12);
  assert.equal(saved.layout.offsetY, -18);
  assert.equal(saved.layout.scaleMultiplier, 1.13);
});

test('upsertDesktopLive2dDragZoneOverrides writes interaction.dragZone overrides as commented jsonc', () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-drag-zone-')), 'desktop-live2d.json');
  fs.writeFileSync(configPath, '{\n  // Keep custom window size.\n  "window": {\n    "width": 380\n  }\n}\n', 'utf8');

  const nextRaw = upsertDesktopLive2dDragZoneOverrides(configPath, {
    centerXRatio: 0.46,
    centerYRatio: 0.52,
    widthRatio: 0.4,
    heightRatio: 0.28
  });

  const savedText = fs.readFileSync(configPath, 'utf8');
  const saved = parseJsonWithComments(savedText);

  assert.equal(nextRaw.window.width, 380);
  assert.equal(nextRaw.interaction.dragZone.centerXRatio, 0.46);
  assert.equal(nextRaw.interaction.dragZone.centerYRatio, 0.52);
  assert.equal(nextRaw.interaction.dragZone.widthRatio, 0.4);
  assert.equal(nextRaw.interaction.dragZone.heightRatio, 0.28);
  assert.match(savedText, /Interaction overrides/);
  assert.equal(saved.window.width, 380);
  assert.equal(saved.interaction.dragZone.centerXRatio, 0.46);
  assert.equal(saved.interaction.dragZone.centerYRatio, 0.52);
  assert.equal(saved.interaction.dragZone.widthRatio, 0.4);
  assert.equal(saved.interaction.dragZone.heightRatio, 0.28);
});

test('upsertDesktopLive2dDragZoneOverrides clamps out-of-bounds drag zone inputs before saving', () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-drag-zone-clamp-')), 'desktop-live2d.json');

  const nextRaw = upsertDesktopLive2dDragZoneOverrides(configPath, {
    centerXRatio: 0.92,
    centerYRatio: 0.08,
    widthRatio: 0.7,
    heightRatio: 0.5
  });

  assert.deepEqual(nextRaw.interaction.dragZone, {
    centerXRatio: 0.65,
    centerYRatio: 0.25,
    widthRatio: 0.7,
    heightRatio: 0.5
  });
});

test('syncDesktopLive2dMissingDefaults fills missing schema fields without overwriting user overrides', () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-sync-defaults-')), 'desktop-live2d.json');
  fs.writeFileSync(configPath, `{
  "window": {
    "width": 512
  },
  "interaction": {
    "dragZone": {
      "widthRatio": 0.42
    }
  },
  "voice": {
    "transport": "realtime"
  }
}
`, 'utf8');

  const { nextRaw, addedPaths } = syncDesktopLive2dMissingDefaults(configPath);
  const saved = parseJsonWithComments(fs.readFileSync(configPath, 'utf8'));

  assert.equal(nextRaw.window.width, 512);
  assert.equal(nextRaw.interaction.dragZone.widthRatio, 0.42);
  assert.equal(nextRaw.voice.transport, 'realtime');
  assert.equal(saved.window.width, 512);
  assert.equal(saved.interaction.dragZone.widthRatio, 0.42);
  assert.equal(saved.voice.transport, 'realtime');
  assert.equal(saved.window.height, 500);
  assert.equal(saved.interaction.dragZone.centerXRatio, 0.5);
  assert.equal(saved.debug.mouthTuner.visible, false);
  assert.equal(saved.debug.waveformCapture.enabled, false);
  assert.equal(saved.debug.waveformCapture.captureEveryFrame, true);
  assert.equal(saved.debug.waveformCapture.includeApplied, true);
  assert.equal(saved.voice.path, 'electron_native');
  assert.ok(addedPaths.includes('window.height'));
  assert.ok(addedPaths.includes('debug'));
  assert.ok(!addedPaths.includes('window.width'));
  assert.ok(!addedPaths.includes('voice.transport'));
});
