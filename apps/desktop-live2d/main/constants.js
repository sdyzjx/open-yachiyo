const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODEL_ASSET_RELATIVE_DIR = path.join('assets', 'live2d', 'yachiyo-kaguya');
const MODEL_JSON_NAME = '八千代辉夜姬.model3.json';
const DEFAULT_IMPORT_SOURCE_DIR = path.resolve(PROJECT_ROOT, '..', '【雪熊企划】八千代辉夜姬');
const RUNTIME_SUMMARY_RELATIVE_PATH = path.join('data', 'desktop-live2d', 'runtime-summary.json');
const DESKTOP_CAPTURE_RELATIVE_DIR = path.join('data', 'desktop-live2d', 'captures');
const BACKUP_ROOT_RELATIVE_PATH = path.join('data', 'backups', 'live2d');
const DEFAULT_RPC_PORT = 17373;
const DEFAULT_RENDERER_TIMEOUT_MS = 3000;

const RPC_METHODS_V1 = Object.freeze([
  'state.get',
  'debug.mouthOverride.set',
  'param.set',
  'model.param.set',
  'model.param.batchSet',
  'model.motion.play',
  'model.expression.set',
  'chat.show',
  'chat.bubble.show',
  'chat.panel.show',
  'chat.panel.hide',
  'chat.panel.append',
  'chat.panel.clear',
  'desktop.perception.capabilities',
  'desktop.perception.permissions',
  'desktop.perception.displays.list',
  'desktop.perception.windows.list',
  'desktop.capture.desktop',
  'desktop.capture.screen',
  'desktop.capture.region',
  'desktop.capture.window',
  'desktop.capture.get',
  'desktop.capture.delete',
  'tool.list',
  'tool.invoke'
]);

module.exports = {
  PROJECT_ROOT,
  MODEL_ASSET_RELATIVE_DIR,
  MODEL_JSON_NAME,
  DEFAULT_IMPORT_SOURCE_DIR,
  RUNTIME_SUMMARY_RELATIVE_PATH,
  DESKTOP_CAPTURE_RELATIVE_DIR,
  BACKUP_ROOT_RELATIVE_PATH,
  DEFAULT_RPC_PORT,
  DEFAULT_RENDERER_TIMEOUT_MS,
  RPC_METHODS_V1
};
