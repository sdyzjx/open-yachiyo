const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveDesktopLive2dConfig,
  upsertDesktopLive2dLayoutOverrides,
  parseJsonWithComments
} = require('../../apps/desktop-live2d/main/config');

test('resolveDesktopLive2dConfig applies defaults and model relative path', () => {
  const yachiyoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-home-'));
  const config = resolveDesktopLive2dConfig({ env: { YACHIYO_HOME: yachiyoHome } });

  assert.equal(config.rpcPort, 17373);
  assert.equal(config.modelJsonName, '八千代辉夜姬.model3.json');
  assert.ok(config.modelRelativePath.includes('assets/live2d/yachiyo-kaguya/八千代辉夜姬.model3.json'));
  assert.ok(config.windowStatePath.endsWith(path.join('desktop-live2d', 'window-state.json')));
  assert.equal(config.gatewayExternal, false);
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
      DESKTOP_EXTERNAL_GATEWAY: '1'
    },
    projectRoot: '/tmp/project'
  });

  assert.equal(config.gatewayPort, 3100);
  assert.equal(config.gatewayUrl, 'http://127.0.0.1:3200');
  assert.equal(config.rpcPort, 18080);
  assert.equal(config.rpcToken, 'fixed');
  assert.equal(config.gatewayExternal, true);
  assert.equal(config.modelDir, path.join('/tmp/project', 'assets', 'live2d', 'yachiyo-kaguya'));
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
  assert.equal(config.uiConfig.actionQueue.maxQueueSize, 32);
  assert.equal(config.uiConfig.actionQueue.overflowPolicy, 'drop_newest');
  assert.equal(config.uiConfig.actionQueue.idleFallbackEnabled, false);
  assert.equal(config.uiConfig.actionQueue.idleAction.type, 'expression');
  assert.equal(config.uiConfig.actionQueue.idleAction.name, 'smile');
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
      },
      "debug": {
        "mouthTuner": {
          "visible": true
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
  assert.equal(config.uiConfig.debug.mouthTuner.visible, true);
  assert.equal(config.uiConfig.debug.mouthTuner.enabled, false);
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
