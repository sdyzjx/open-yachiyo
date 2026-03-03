require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const express = require('express');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { WebSocketServer } = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DebugEventStream } = require('./debugEventStream');

const { ToolExecutor } = require('../runtime/executor/toolExecutor');
const { ToolLoopRunner } = require('../runtime/loop/toolLoopRunner');
const { RuntimeEventBus } = require('../runtime/bus/eventBus');
const { ToolCallDispatcher } = require('../runtime/orchestrator/toolCallDispatcher');
const { RpcInputQueue } = require('../runtime/queue/rpcInputQueue');
const { RuntimeRpcWorker } = require('../runtime/rpc/runtimeRpcWorker');
const { RpcErrorCode, createRpcError } = require('../runtime/rpc/jsonRpc');
const { ProviderConfigStore } = require('../runtime/config/providerConfigStore');
const { LlmProviderManager } = require('../runtime/config/llmProviderManager');
const { ToolConfigManager } = require('../runtime/config/toolConfigManager');
const { FileSessionStore } = require('../runtime/session/fileSessionStore');
const { buildRecentContextMessages } = require('../runtime/session/contextBuilder');
const { getDefaultLongTermMemoryStore } = require('../runtime/session/longTermMemoryStore');
const { loadMemorySop } = require('../runtime/session/memorySopLoader');
const { getDefaultSessionWorkspaceManager } = require('../runtime/session/workspaceManager');
const {
  isSessionPermissionLevel,
  normalizeSessionPermissionLevel,
  normalizeWorkspaceSettings
} = require('../runtime/session/sessionPermissions');
const { canReadLongTermMemory } = require('../runtime/security/sessionPermissionPolicy');
const { SkillRuntimeManager } = require('../runtime/skills/skillRuntimeManager');
const { getRuntimePaths } = require('../runtime/skills/runtimePaths');
const { PersonaContextBuilder } = require('../runtime/persona/personaContextBuilder');
const { PersonaProfileStore } = require('../runtime/persona/personaProfileStore');
const { PersonaConfigStore } = require('../runtime/persona/personaConfigStore');
const { SkillConfigStore } = require('../runtime/skills/skillConfigStore');
const { ToolConfigStore } = require('../runtime/tooling/toolConfigStore');
const { loadVoicePolicy } = require('../runtime/tooling/voice/policy');
const { __internal: voiceInternal } = require('../runtime/tooling/adapters/voice');
const { publishChainEvent } = require('../runtime/bus/chainDebug');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(__dirname, '..', '..', 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

const bus = new RuntimeEventBus();
let debugMode = String(process.env.DEBUG_MODE || '').trim().toLowerCase() === 'true';
bus.isDebugMode = () => debugMode;

const debugEventStream = new DebugEventStream({
  bus,
  authToken: process.env.DEBUG_STREAM_BEARER_TOKEN || '',
  allowedTopics: process.env.DEBUG_STREAM_ALLOWED_TOPICS || '*',
  heartbeatMs: Number(process.env.DEBUG_STREAM_HEARTBEAT_MS) || 15000,
  bufferSize: Number(process.env.DEBUG_STREAM_BUFFER_SIZE) || 2000,
  globalMaxConnections: Number(process.env.DEBUG_STREAM_MAX_CONNECTIONS) || 200,
  perUserMaxConnections: Number(process.env.DEBUG_STREAM_PER_USER_MAX_CONNECTIONS) || 3
});
const queue = new RpcInputQueue({ maxSize: 2000, bus });
const toolConfigManager = new ToolConfigManager();
const toolRuntime = toolConfigManager.buildRegistry();
const executor = new ToolExecutor(toolRuntime.registry, { policy: toolRuntime.policy, exec: toolRuntime.exec });
const providerStore = new ProviderConfigStore();
const llmManager = new LlmProviderManager({ store: providerStore });
const sessionStore = new FileSessionStore();
const longTermMemoryStore = getDefaultLongTermMemoryStore();
const workspaceManager = getDefaultSessionWorkspaceManager();
const skillRuntimeManager = new SkillRuntimeManager({ workspaceDir: process.cwd() });
const personaProfileStore = new PersonaProfileStore();
const personaConfigStore = new PersonaConfigStore();
const skillConfigStore = new SkillConfigStore();
const toolConfigStore = toolConfigManager.store;
const voicePolicyPath = process.env.VOICE_POLICY_PATH || require('node:path').resolve(process.cwd(), 'config/voice-policy.yaml');
const desktopLive2dConfigPath = process.env.DESKTOP_LIVE2D_CONFIG_PATH || require('node:path').resolve(process.cwd(), 'config/desktop-live2d.json');
const personaContextBuilder = new PersonaContextBuilder({
  workspaceDir: process.cwd(),
  profileStore: personaProfileStore,
  memoryStore: longTermMemoryStore
});

const contextMaxMessages = Math.max(0, Number(process.env.CONTEXT_MAX_MESSAGES) || 12);
const contextMaxChars = Math.max(0, Number(process.env.CONTEXT_MAX_CHARS) || 12000);
const memoryBootstrapMaxEntries = Math.max(0, Number(process.env.MEMORY_BOOTSTRAP_MAX_ENTRIES) || 10);
const memoryBootstrapMaxChars = Math.max(0, Number(process.env.MEMORY_BOOTSTRAP_MAX_CHARS) || 2400);
const memorySopMaxChars = Math.max(0, Number(process.env.MEMORY_SOP_MAX_CHARS) || 8000);
const maxInputImageBytes = Math.max(1024, Number(process.env.MAX_INPUT_IMAGE_BYTES) || 8 * 1024 * 1024);
const maxInputImages = Math.max(0, Number(process.env.MAX_INPUT_IMAGES) || 4);
const maxInputImageDataUrlChars = Math.max(
  128,
  Number(process.env.MAX_INPUT_IMAGE_DATA_URL_CHARS) || Math.ceil(maxInputImageBytes * 1.5)
);
const sessionImageStoreDir = path.resolve(
  process.env.SESSION_IMAGE_STORE_DIR || path.join(getRuntimePaths().dataDir, 'session-images')
);

function extensionFromMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/avif') return 'avif';
  return 'img';
}

function sanitizeToken(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
}

function buildSessionImagePublicUrl(sessionId, fileName) {
  return `/api/session-images/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`;
}

function decodeImageDataUrl(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  const base64Payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1).replace(/\s+/g, '') : '';
  return Buffer.from(base64Payload, 'base64');
}

function parseBooleanEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return Boolean(fallback);
}

function parseToolAsyncMode(rawValue, fallback = 'serial') {
  const raw = String(rawValue || fallback).trim().toLowerCase();
  if (raw === 'serial' || raw === 'parallel') return raw;
  return String(fallback);
}

function parsePositiveIntEnv(name, fallback = 1) {
  const value = Number.parseInt(process.env[name], 10);
  if (!Number.isFinite(value) || value < 1) {
    return Math.max(1, Number.parseInt(fallback, 10) || 1);
  }
  return value;
}

async function persistSessionInputImages(sessionId, inputImages = []) {
  if (!Array.isArray(inputImages) || inputImages.length === 0) return [];

  const encodedSessionId = encodeURIComponent(String(sessionId));
  const sessionDir = path.join(sessionImageStoreDir, encodedSessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  const persisted = [];
  for (const image of inputImages) {
    const ext = extensionFromMimeType(image.mime_type);
    const clientId = sanitizeToken(image.client_id) || sanitizeToken(image.name) || uuidv4().replaceAll('-', '');
    const fileName = `${clientId}.${ext}`;
    const filePath = path.join(sessionDir, fileName);
    const binary = decodeImageDataUrl(image.data_url);
    await fs.writeFile(filePath, binary);

    persisted.push({
      client_id: clientId,
      name: image.name,
      mime_type: image.mime_type,
      size_bytes: image.size_bytes || binary.length,
      file_name: fileName,
      url: buildSessionImagePublicUrl(sessionId, fileName)
    });
  }

  return persisted;
}

const runner = new ToolLoopRunner({
  bus,
  getReasoner: () => llmManager.getReasoner(),
  listTools: () => executor.listTools(),
  resolvePersonaContext: ({ sessionId, input }) => personaContextBuilder.build({ sessionId, input }),
  resolveSkillsContext: ({ sessionId, input }) => skillRuntimeManager.buildTurnContext({ sessionId, input }),
  maxStep: 8,
  toolResultTimeoutMs: 10000,
  runtimeStreamingEnabled: parseBooleanEnv('RUNTIME_STREAMING_ENABLED', true),
  toolAsyncMode: parseToolAsyncMode(process.env.RUNTIME_TOOL_ASYNC_MODE, 'serial'),
  toolEarlyDispatch: parseBooleanEnv('RUNTIME_TOOL_EARLY_DISPATCH', false),
  maxParallelTools: parsePositiveIntEnv('RUNTIME_MAX_PARALLEL_TOOLS', 3)
});

const dispatcher = new ToolCallDispatcher({
  bus,
  executor,
  dedupTtlMs: Math.max(1000, Number(process.env.RUNTIME_TOOL_CALL_DEDUP_TTL_MS) || 5 * 60 * 1000)
});
dispatcher.start();

const worker = new RuntimeRpcWorker({ queue, runner, bus });
worker.start();

app.get('/api/session-images/:sessionId/:fileName', async (req, res) => {
  const safeSessionId = encodeURIComponent(String(req.params.sessionId || ''));
  const safeFileName = String(req.params.fileName || '');
  if (!safeFileName || safeFileName.includes('/') || safeFileName.includes('\\')) {
    res.status(400).json({ ok: false, error: 'invalid file name' });
    return;
  }

  const sessionDir = path.resolve(path.join(sessionImageStoreDir, safeSessionId));
  const absolutePath = path.resolve(path.join(sessionDir, safeFileName));
  if (!absolutePath.startsWith(`${sessionDir}${path.sep}`)) {
    res.status(400).json({ ok: false, error: 'invalid image path' });
    return;
  }

  try {
    await fs.access(absolutePath);
    res.sendFile(absolutePath);
  } catch {
    res.status(404).json({ ok: false, error: 'image not found' });
  }
});

app.get('/api/git/branch', (_, res) => {
  execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path.resolve(__dirname, '../..') }, (err, stdout) => {
    if (err) {
      res.json({ ok: false, branch: null });
      return;
    }
    res.json({ ok: true, branch: stdout.trim() });
  });
});

app.get('/health', async (_, res) => {
  const sessionStats = await sessionStore.getStats();
  const memoryStats = await longTermMemoryStore.getStats();
  const voiceStats = typeof voiceInternal?.snapshotMetrics === 'function'
    ? voiceInternal.snapshotMetrics()
    : null;

  res.json({
    ok: true,
    uptime_seconds: Math.floor(process.uptime()),
    queue_size: queue.size(),
    runtime: {
      streaming_enabled: runner.runtimeStreamingEnabled,
      tool_async_mode: runner.toolAsyncMode,
      tool_early_dispatch: runner.toolEarlyDispatch,
      max_parallel_tools: runner.maxParallelTools,
      tool_call_dedup_ttl_ms: dispatcher.dedupTtlMs
    },
    llm: llmManager.getConfigSummary(),
    tools: toolConfigManager.getSummary(),
    session_store: sessionStats,
    memory_store: memoryStats,
    voice: voiceStats,
    debug_stream: {
      enabled: true,
      debug_mode: debugMode,
      ...debugEventStream.stats()
    },
    workspace_store: {
      root_dir: workspaceManager.rootDir
    }
  });
});

app.get('/api/debug/mode', (_, res) => {
  res.json({ ok: true, data: { debug: debugMode } });
});

app.put('/api/debug/mode', (req, res) => {
  const raw = req.body?.debug;
  if (typeof raw !== 'boolean') {
    res.status(400).json({ ok: false, error: 'body.debug must be boolean' });
    return;
  }
  debugMode = raw;
  res.json({ ok: true, data: { debug: debugMode } });
});

app.get('/api/debug/events', (req, res) => {
  debugEventStream.handleStream(req, res);
});

app.get('/debug/stream', (req, res) => {
  debugEventStream.handleStream(req, res);
});

app.post('/api/debug/emit', (req, res) => {
  debugEventStream.handleEmit(req, res);
});

app.post('/debug/emit', (req, res) => {
  debugEventStream.handleEmit(req, res);
});

app.get('/api/sessions', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const result = await sessionStore.listSessions({ limit, offset });
  res.json({ ok: true, data: result });
});

app.get('/api/version', (req, res) => {
  try {
    const { execSync } = require('node:child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim();
    res.json({ ok: true, data: { branch } });
  } catch (e) {
    res.json({ ok: true, data: { branch: 'unknown' } });
  }
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  const session = await sessionStore.getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ ok: false, error: 'session not found' });
    return;
  }
  res.json({ ok: true, data: session });
});

app.get('/api/sessions/:sessionId/events', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const events = await sessionStore.getSessionEvents(req.params.sessionId, { limit, offset });
  res.json({ ok: true, data: events });
});

app.get('/api/sessions/:sessionId/memory', async (req, res) => {
  const session = await sessionStore.getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ ok: false, error: 'session not found' });
    return;
  }
  res.json({ ok: true, data: session.memory || null });
});

app.get('/api/sessions/:sessionId/settings', async (req, res) => {
  const settings = await sessionStore.getSessionSettings(req.params.sessionId);
  if (!settings) {
    res.status(404).json({ ok: false, error: 'session not found' });
    return;
  }
  res.json({ ok: true, data: settings });
});

app.put('/api/sessions/:sessionId/settings', async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    res.status(400).json({ ok: false, error: 'body.settings must be an object' });
    return;
  }

  if (
    Object.prototype.hasOwnProperty.call(settings, 'permission_level')
    && !isSessionPermissionLevel(settings.permission_level)
  ) {
    res.status(400).json({ ok: false, error: 'settings.permission_level must be low|medium|high' });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'workspace')) {
    if (!settings.workspace || typeof settings.workspace !== 'object' || Array.isArray(settings.workspace)) {
      res.status(400).json({ ok: false, error: 'settings.workspace must be an object' });
      return;
    }
  }

  const updated = await sessionStore.updateSessionSettings(req.params.sessionId, settings);
  res.json({ ok: true, data: updated });
});

app.get('/api/memory', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const result = await longTermMemoryStore.listEntries({ limit, offset });
  res.json({ ok: true, data: result });
});

app.get('/api/memory/search', async (req, res) => {
  const query = String(req.query.q || '');
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 50));
  if (!query.trim()) {
    res.status(400).json({ ok: false, error: 'query q is required' });
    return;
  }
  const result = await longTermMemoryStore.searchEntries({ query, limit });
  res.json({ ok: true, data: result });
});

app.get('/api/persona/profile', (_, res) => {
  try {
    const profile = personaProfileStore.load();
    res.json({ ok: true, data: profile });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/persona/profile', (req, res) => {
  const profilePatch = req.body?.profile;
  if (!profilePatch || typeof profilePatch !== 'object' || Array.isArray(profilePatch)) {
    res.status(400).json({ ok: false, error: 'body.profile must be an object' });
    return;
  }

  try {
    const updated = personaProfileStore.save(profilePatch);
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/config/providers', (_, res) => {
  res.json({ ok: true, data: llmManager.getConfigSummary() });
});

app.get('/api/config/providers/config', (_, res) => {
  try {
    res.json({ ok: true, data: llmManager.getConfig() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/config/providers/raw', (_, res) => {
  res.json({ ok: true, yaml: llmManager.loadYaml() });
});

app.get('/api/config/tools/config', (_, res) => {
  try {
    res.json({ ok: true, data: toolConfigManager.getConfig() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/config/tools/raw', (_, res) => {
  try {
    res.json({ ok: true, yaml: toolConfigManager.loadYaml() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/config/providers/config', (req, res) => {
  const config = req.body?.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    res.status(400).json({ ok: false, error: 'body.config must be an object' });
    return;
  }

  try {
    llmManager.saveConfig(config);
    res.json({ ok: true, data: llmManager.getConfigSummary() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/config/providers/raw', (req, res) => {
  const yaml = req.body?.yaml;
  if (typeof yaml !== 'string') {
    res.status(400).json({ ok: false, error: 'body.yaml must be a string' });
    return;
  }

  try {
    llmManager.saveYaml(yaml);
    res.json({ ok: true, data: llmManager.getConfigSummary() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// --- Config v2: 专属 config git 仓库 ---
// 使用 runtime configDir（~/yachiyo/config/）作为独立 git 仓库，与项目仓库完全隔离
const CONFIG_GIT_DIR = getRuntimePaths().configDir;
const CONFIG_FILES = ['providers.yaml', 'tools.yaml', 'skills.yaml', 'persona.yaml', 'voice-policy.yaml', 'desktop-live2d.json'];

// 启动时确保 config 目录已 git init，并配置 user 信息
(function ensureConfigGitRepo() {
  const { execSync } = require('node:child_process');
  try {
    execSync('git rev-parse --git-dir', { cwd: CONFIG_GIT_DIR, stdio: 'ignore' });
  } catch {
    // 未初始化，执行 init
    execSync('git init', { cwd: CONFIG_GIT_DIR, stdio: 'ignore' });
    execSync('git config user.email "yachiyo@local"', { cwd: CONFIG_GIT_DIR, stdio: 'ignore' });
    execSync('git config user.name "Yachiyo"', { cwd: CONFIG_GIT_DIR, stdio: 'ignore' });
    // 把现有文件做一次初始 commit
    try {
      execSync('git add -A && git commit -m "init: initial config snapshot"', { cwd: CONFIG_GIT_DIR, stdio: 'ignore' });
    } catch (_) {}
    console.log(`[config-git] initialized repo at ${CONFIG_GIT_DIR}`);
  }
})();

function commitConfigChange(filename) {
  const { execSync } = require('node:child_process');
  try {
    execSync(
      `git add "${filename}" && git commit -m "config: update ${filename} at ${new Date().toISOString()}"`,
      { cwd: CONFIG_GIT_DIR, stdio: 'ignore' }
    );
  } catch (_) { /* 无变更或 git 未配置时静默跳过 */ }
}

function gitExec(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: CONFIG_GIT_DIR }, (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr || err.message)); return; }
      resolve(stdout.trim());
    });
  });
}

// --- Config v2: tools.yaml ---
app.put('/api/config/tools/raw', (req, res) => {
  const yaml = req.body?.yaml;
  if (typeof yaml !== 'string') {
    res.status(400).json({ ok: false, error: 'body.yaml must be a string' });
    return;
  }
  try {
    toolConfigStore.saveRawYaml(yaml);
    commitConfigChange('tools.yaml');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// --- Config v2: persona.yaml ---
app.get('/api/config/persona/raw', (_, res) => {
  try {
    res.json({ ok: true, yaml: personaConfigStore.loadRawYaml() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/config/persona/raw', (req, res) => {
  const yaml = req.body?.yaml;
  if (typeof yaml !== 'string') {
    res.status(400).json({ ok: false, error: 'body.yaml must be a string' });
    return;
  }
  try {
    personaConfigStore.saveRawYaml(yaml);
    commitConfigChange('persona.yaml');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// --- Config v2: skills.yaml ---
app.get('/api/config/skills/raw', (_, res) => {
  try {
    res.json({ ok: true, yaml: skillConfigStore.loadRawYaml() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/config/skills/raw', (req, res) => {
  const yaml = req.body?.yaml;
  if (typeof yaml !== 'string') {
    res.status(400).json({ ok: false, error: 'body.yaml must be a string' });
    return;
  }
  try {
    skillConfigStore.saveRawYaml(yaml);
    commitConfigChange('skills.yaml');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// --- Config v2: voice-policy.yaml ---
const fsSync = require('node:fs');
app.get('/api/config/voice-policy/raw', (_, res) => {
  try {
    const yaml = fsSync.existsSync(voicePolicyPath) ? fsSync.readFileSync(voicePolicyPath, 'utf8') : '';
    res.json({ ok: true, yaml });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/config/voice-policy/raw', (req, res) => {
  const yaml = req.body?.yaml;
  if (typeof yaml !== 'string') {
    res.status(400).json({ ok: false, error: 'body.yaml must be a string' });
    return;
  }
  try {
    const YAML = require('yaml');
    YAML.parse(yaml); // 基础语法校验
    fsSync.writeFileSync(voicePolicyPath, yaml, 'utf8');
    commitConfigChange('voice-policy.yaml');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// --- Config v2: desktop-live2d.json (只读) ---
app.get('/api/config/desktop-live2d/raw', (_, res) => {
  try {
    const raw = fsSync.existsSync(desktopLive2dConfigPath) ? fsSync.readFileSync(desktopLive2dConfigPath, 'utf8') : '{}';
    res.json({ ok: true, json: raw });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// --- Config v2: git log & revert ---
// gitExec 和 CONFIG_FILES 已在上方 "专属 config git 仓库" 块中定义

// GET /api/config/git/log?file=tools.yaml&limit=10
app.get('/api/config/git/log', async (req, res) => {
  const file = req.query.file;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));

  if (file && !CONFIG_FILES.includes(file)) {
    res.status(400).json({ ok: false, error: 'unknown config file' });
    return;
  }

  // cwd 已是 config 目录，直接用文件名，不加 config/ 前缀
  const pathArg = file || '.';

  try {
    const raw = await gitExec([
      'log', `--max-count=${limit}`,
      '--format=%H\x1f%h\x1f%s\x1f%ai',
      '--', pathArg
    ]);

    if (!raw) { res.json({ ok: true, commits: [] }); return; }

    const commits = raw.split('\n').filter(Boolean).map(line => {
      const [hash, short, subject, date] = line.split('\x1f');
      return { hash, short, subject, date };
    });

    const dirty = await gitExec(['status', '--porcelain', '--', pathArg])
      .then(out => out.length > 0)
      .catch(() => false);

    res.json({ ok: true, commits, dirty });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/config/git/show?hash=abc123&file=tools.yaml
app.get('/api/config/git/show', async (req, res) => {
  const { hash, file } = req.query;
  if (!hash || !/^[0-9a-f]{4,64}$/i.test(hash)) {
    res.status(400).json({ ok: false, error: 'invalid hash' });
    return;
  }
  if (!file || !CONFIG_FILES.includes(file)) {
    res.status(400).json({ ok: false, error: 'unknown config file' });
    return;
  }
  try {
    // 专属仓库里文件直接在根目录，用 hash:filename
    const content = await gitExec(['show', `${hash}:${file}`]);
    res.json({ ok: true, content });
  } catch (err) {
    res.status(404).json({ ok: false, error: `file not found in commit ${hash}` });
  }
});

// POST /api/config/git/restore  { hash, file }
app.post('/api/config/git/restore', async (req, res) => {
  const { hash, file } = req.body || {};
  if (!hash || !/^[0-9a-f]{4,64}$/i.test(hash)) {
    res.status(400).json({ ok: false, error: 'invalid hash' });
    return;
  }
  if (!file || !CONFIG_FILES.includes(file)) {
    res.status(400).json({ ok: false, error: 'unknown config file' });
    return;
  }
  try {
    const content = await gitExec(['show', `${hash}:${file}`]);
    const filePath = path.join(CONFIG_GIT_DIR, file);
    fsSync.writeFileSync(filePath, content, 'utf8');
    commitConfigChange(file);
    res.json({ ok: true, message: `restored ${file} to ${hash.slice(0, 7)}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const server = app.listen(port, host, () => {
  const summary = llmManager.getConfigSummary();
  console.log(`Debug web: http://localhost:${port} (listening on ${host})`);
  console.log(`LLM provider: ${summary.active_provider} / ${summary.active_model} / has_api_key=${summary.has_api_key}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

function sendSafe(ws, payload) {
  if (ws.readyState !== 1) return;
  publishChainEvent(bus, 'gateway.ws.outbound', {
    channel: '/ws',
    payload_type: payload?.type || payload?.method || 'rpc',
    rpc_id: payload?.id ?? null,
    session_id: payload?.session_id || payload?.params?.session_id || null
  });
  ws.send(JSON.stringify(payload));
}

function normalizeInputImages(rawInputImages) {
  if (rawInputImages === undefined || rawInputImages === null) {
    return { ok: true, images: [] };
  }

  if (!Array.isArray(rawInputImages)) {
    return { ok: false, error: 'params.input_images must be an array' };
  }

  if (rawInputImages.length > maxInputImages) {
    return { ok: false, error: `params.input_images exceeds limit (${maxInputImages})` };
  }

  const images = [];
  for (const rawImage of rawInputImages) {
    if (!rawImage || typeof rawImage !== 'object' || Array.isArray(rawImage)) {
      return { ok: false, error: 'params.input_images entries must be objects' };
    }

    const dataUrl = typeof rawImage.data_url === 'string' ? rawImage.data_url.trim() : '';
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(dataUrl)) {
      return { ok: false, error: 'params.input_images[].data_url must be a valid image data URL' };
    }

    if (dataUrl.length > maxInputImageDataUrlChars) {
      return { ok: false, error: `params.input_images[].data_url exceeds max chars (${maxInputImageDataUrlChars})` };
    }

    const commaIndex = dataUrl.indexOf(',');
    const base64Payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1).replace(/\s+/g, '') : '';
    const padding = base64Payload.endsWith('==') ? 2 : (base64Payload.endsWith('=') ? 1 : 0);
    const estimatedBytes = Math.max(0, Math.floor((base64Payload.length * 3) / 4) - padding);
    if (estimatedBytes > maxInputImageBytes) {
      return { ok: false, error: `params.input_images[] exceeds max bytes (${maxInputImageBytes})` };
    }

    const declaredBytes = Number(rawImage.size_bytes) || 0;
    if (declaredBytes > maxInputImageBytes) {
      return { ok: false, error: `params.input_images[].size_bytes exceeds max bytes (${maxInputImageBytes})` };
    }

    images.push({
      client_id: typeof rawImage.client_id === 'string' ? sanitizeToken(rawImage.client_id) : '',
      name: typeof rawImage.name === 'string' ? rawImage.name.trim() : '',
      mime_type: typeof rawImage.mime_type === 'string' ? rawImage.mime_type.trim() : '',
      size_bytes: declaredBytes || estimatedBytes,
      data_url: dataUrl
    });
  }

  return { ok: true, images };
}

function normalizeInputAudio(rawInputAudio) {
  if (rawInputAudio === undefined || rawInputAudio === null) {
    return { ok: true, audio: null };
  }

  if (!rawInputAudio || typeof rawInputAudio !== 'object' || Array.isArray(rawInputAudio)) {
    return { ok: false, error: 'params.input_audio must be an object' };
  }

  const audioRef = typeof rawInputAudio.audio_ref === 'string' ? rawInputAudio.audio_ref.trim() : '';
  const format = typeof rawInputAudio.format === 'string' ? rawInputAudio.format.trim().toLowerCase() : '';
  const lang = typeof rawInputAudio.lang === 'string' ? rawInputAudio.lang.trim().toLowerCase() : 'auto';
  const hints = Array.isArray(rawInputAudio.hints)
    ? rawInputAudio.hints.filter((item) => typeof item === 'string').map((s) => s.trim()).filter(Boolean)
    : [];

  if (!audioRef || !format) {
    return { ok: false, error: 'params.input_audio.audio_ref and params.input_audio.format are required' };
  }

  if (!['wav', 'mp3', 'ogg', 'webm', 'm4a'].includes(format)) {
    return { ok: false, error: 'params.input_audio.format must be one of wav|mp3|ogg|webm|m4a' };
  }

  if (!['zh', 'en', 'auto'].includes(lang)) {
    return { ok: false, error: 'params.input_audio.lang must be one of zh|en|auto' };
  }

  return {
    ok: true,
    audio: {
      audio_ref: audioRef,
      format,
      lang,
      hints
    }
  };
}

async function enqueueRpc(ws, rpcPayload, mode) {
  const requestInput = String(rpcPayload.params?.input || '');
  const normalizedImages = normalizeInputImages(rpcPayload.params?.input_images);
  const normalizedAudio = normalizeInputAudio(rpcPayload.params?.input_audio);
  const requestId = rpcPayload.id ?? null;
  const requestedPermissionLevel = rpcPayload.params?.permission_level;
  publishChainEvent(bus, 'gateway.enqueue.start', {
    mode,
    request_id: requestId,
    method: rpcPayload?.method || 'runtime.run',
    session_id: rpcPayload?.params?.session_id || null,
    input_chars: requestInput.length,
    input_images: Array.isArray(rpcPayload?.params?.input_images) ? rpcPayload.params.input_images.length : 0,
    has_input_audio: Boolean(rpcPayload?.params?.input_audio)
  });

  if (!normalizedImages.ok) {
    publishChainEvent(bus, 'gateway.enqueue.rejected', {
      mode,
      request_id: requestId,
      reason: 'invalid_input_images',
      error: normalizedImages.error
    });
    if (mode === 'legacy') {
      sendSafe(ws, { type: 'error', message: normalizedImages.error });
      return;
    }
    sendSafe(ws, createRpcError(requestId, RpcErrorCode.INVALID_PARAMS, normalizedImages.error));
    return;
  }

  if (!normalizedAudio.ok) {
    publishChainEvent(bus, 'gateway.enqueue.rejected', {
      mode,
      request_id: requestId,
      reason: 'invalid_input_audio',
      error: normalizedAudio.error
    });
    if (mode === 'legacy') {
      sendSafe(ws, { type: 'error', message: normalizedAudio.error });
      return;
    }
    sendSafe(ws, createRpcError(requestId, RpcErrorCode.INVALID_PARAMS, normalizedAudio.error));
    return;
  }

  const inputImages = normalizedImages.images;
  const inputAudio = normalizedAudio.audio;
  if (!requestInput.trim() && inputImages.length === 0 && !inputAudio) {
    publishChainEvent(bus, 'gateway.enqueue.rejected', {
      mode,
      request_id: requestId,
      reason: 'empty_input'
    });
    if (mode === 'legacy') {
      sendSafe(ws, { type: 'error', message: 'input text or input_images or input_audio is required' });
      return;
    }
    sendSafe(ws, createRpcError(requestId, RpcErrorCode.INVALID_PARAMS, 'params.input or params.input_images or params.input_audio is required'));
    return;
  }

  if (requestedPermissionLevel !== undefined && !isSessionPermissionLevel(requestedPermissionLevel)) {
    publishChainEvent(bus, 'gateway.enqueue.rejected', {
      mode,
      request_id: requestId,
      reason: 'invalid_permission_level',
      permission_level: requestedPermissionLevel
    });
    if (mode === 'legacy') {
      sendSafe(ws, { type: 'error', message: 'permission_level must be low|medium|high' });
      return;
    }
    sendSafe(ws, createRpcError(requestId, RpcErrorCode.INVALID_PARAMS, 'params.permission_level must be low|medium|high'));
    return;
  }

  const context = {
    buildRunContext: async ({ session_id: sessionId }) => {
      const existingSettings = await sessionStore.getSessionSettings(sessionId);
      const permissionLevel = normalizeSessionPermissionLevel(
        requestedPermissionLevel !== undefined
          ? requestedPermissionLevel
          : existingSettings?.permission_level
      );
      const workspace = await workspaceManager.getWorkspaceInfo(sessionId);
      const normalizedWorkspace = normalizeWorkspaceSettings(workspace);

      await sessionStore.updateSessionSettings(sessionId, {
        permission_level: permissionLevel,
        workspace: normalizedWorkspace
      });

      return {
        permission_level: permissionLevel,
        workspace_root: normalizedWorkspace.root_dir
      };
    },
    transcribeAudio: async ({ session_id: sessionId, input_audio: inputAudio, runtime_context: runtimeContext }) => {
      if (!inputAudio || typeof inputAudio !== 'object') {
        return { text: '', confidence: null };
      }

      const toolResult = await executor.execute({
        name: 'voice.asr_aliyun',
        args: {
          audioRef: inputAudio.audio_ref,
          format: inputAudio.format,
          lang: inputAudio.lang || 'auto',
          hints: Array.isArray(inputAudio.hints) ? inputAudio.hints : []
        }
      }, {
        permission_level: runtimeContext?.permission_level || null,
        workspace_root: runtimeContext?.workspace_root || null,
        workspaceRoot: runtimeContext?.workspace_root || process.cwd(),
        bus,
        meta: {
          session_id: sessionId,
          permission_level: runtimeContext?.permission_level || null,
          workspace_root: runtimeContext?.workspace_root || null,
          input_type: 'audio'
        },
        publishEvent: (topic, eventPayload = {}) => {
          bus.publish(topic, {
            session_id: sessionId,
            tool_name: 'voice.asr_aliyun',
            ...eventPayload
          });
        }
      });

      if (!toolResult.ok) {
        throw new Error(toolResult.error || 'asr failed');
      }

      let parsed = null;
      try {
        parsed = JSON.parse(String(toolResult.result || '{}'));
      } catch {
        parsed = null;
      }

      return {
        text: typeof parsed?.text === 'string' ? parsed.text : '',
        confidence: Number(parsed?.confidence) || null,
        segments: Array.isArray(parsed?.segments) ? parsed.segments : []
      };
    },
    send: (payload) => sendSafe(ws, payload),
    buildPromptMessages: async ({ session_id: sessionId, runtime_context: runtimeContext }) => {
      const session = await sessionStore.getSession(sessionId);
      const isSessionStart = !session || !Array.isArray(session.messages) || session.messages.length === 0;
      const permissionLevel = normalizeSessionPermissionLevel(
        runtimeContext?.permission_level || session?.settings?.permission_level
      );
      const allowMemoryRead = canReadLongTermMemory(permissionLevel);
      const seedMessages = [];

      if (isSessionStart && allowMemoryRead) {
        const sop = await loadMemorySop({ maxChars: memorySopMaxChars });
        if (sop) {
          seedMessages.push({
            role: 'system',
            content: [
              'Long-term memory SOP (Markdown). Follow this policy when calling memory tools.',
              sop
            ].join('\n\n')
          });
        }

        const bootstrapEntries = await longTermMemoryStore.getBootstrapEntries({
          limit: memoryBootstrapMaxEntries,
          maxChars: memoryBootstrapMaxChars
        });
        if (bootstrapEntries.length) {
          const lines = bootstrapEntries.map((entry, index) => {
            const keywords = Array.isArray(entry.keywords) && entry.keywords.length
              ? ` [keywords: ${entry.keywords.join(', ')}]`
              : '';
            return `${index + 1}. ${entry.content}${keywords}`;
          });
          seedMessages.push({
            role: 'system',
            content: [
              'Bootstrap long-term memory context for this new session.',
              ...lines
            ].join('\n')
          });
        }
      }

      const recentMessages = buildRecentContextMessages(session, {
        maxMessages: contextMaxMessages,
        maxChars: contextMaxChars
      });

      return [...seedMessages, ...recentMessages];
    },
    onRunStart: async ({ session_id: sessionId, input, runtime_context: runtimeContext }) => {
      await sessionStore.createSessionIfNotExists({ sessionId, title: 'New chat' });
      let persistedInputImages = [];
      try {
        persistedInputImages = await persistSessionInputImages(sessionId, inputImages);
      } catch {
        persistedInputImages = inputImages.map((image) => ({
          client_id: image.client_id || '',
          name: image.name,
          mime_type: image.mime_type,
          size_bytes: image.size_bytes,
          url: ''
        }));
      }
      await sessionStore.appendMessage(sessionId, {
        role: 'user',
        content: String(input || requestInput || ''),
        request_id: requestId,
        metadata: {
          mode,
          permission_level: runtimeContext?.permission_level || normalizeSessionPermissionLevel(requestedPermissionLevel),
          workspace_root: runtimeContext?.workspace_root || null,
          input_images: persistedInputImages.map((image) => ({
            client_id: image.client_id || '',
            name: image.name,
            mime_type: image.mime_type,
            size_bytes: image.size_bytes,
            url: image.url || ''
          })),
          input_audio: runtimeContext?.input_audio
            ? {
              audio_ref: runtimeContext.input_audio.audio_ref || '',
              format: runtimeContext.input_audio.format || '',
              lang: runtimeContext.input_audio.lang || 'auto',
              transcribed_text: runtimeContext.input_audio.transcribed_text || '',
              confidence: runtimeContext.input_audio.confidence ?? null
            }
            : null
        }
      });
    },
    onRuntimeEvent: async (event) => {
      const sessionId = event.session_id || rpcPayload.params?.session_id;
      if (!sessionId) return;
      await sessionStore.appendEvent(sessionId, event);
    },
    onRunFinal: async ({ session_id: sessionId, trace_id: traceId, output, state, runtime_context: runtimeContext }) => {
      const settings = await sessionStore.getSessionSettings(sessionId);
      const permissionLevel = normalizeSessionPermissionLevel(settings?.permission_level);

      await sessionStore.appendMessage(sessionId, {
        role: 'assistant',
        content: String(output || ''),
        trace_id: traceId,
        request_id: requestId,
        metadata: {
          state,
          mode,
          permission_level: permissionLevel,
          workspace_root: runtimeContext?.workspace_root || settings?.workspace?.root_dir || null
        }
      });
      await sessionStore.appendRun(sessionId, {
        request_id: requestId,
        trace_id: traceId,
        input: requestInput,
        output: String(output || ''),
        state,
        mode,
        permission_level: permissionLevel,
        workspace_root: runtimeContext?.workspace_root || settings?.workspace?.root_dir || null,
        metadata: {
          input_images_count: inputImages.length
        }
      });
    },
    sendEvent: (eventPayload) => {
      if (mode === 'legacy') {
        if (eventPayload.method === 'runtime.start') {
          sendSafe(ws, { type: 'start', ...eventPayload.params });
          return;
        }

        if (eventPayload.method === 'runtime.event') {
          sendSafe(ws, { type: 'event', data: eventPayload.params });
          return;
        }

        if (eventPayload.method === 'runtime.final') {
          sendSafe(ws, { type: 'final', ...eventPayload.params });
          return;
        }

        if (eventPayload.method === 'message.delta') {
          sendSafe(ws, { type: 'delta', ...eventPayload.params });
          return;
        }

        return;
      }

      sendSafe(ws, eventPayload);
    }
  };

  const result = await queue.submit(rpcPayload, context);
  if (result.accepted) {
    publishChainEvent(bus, 'gateway.enqueue.accepted', {
      mode,
      request_id: requestId,
      queue_size: queue.size()
    });
    return;
  }

  publishChainEvent(bus, 'gateway.enqueue.rejected', {
    mode,
    request_id: requestId,
    reason: 'queue_submit_rejected',
    code: result?.response?.error?.code ?? null,
    error: result?.response?.error?.message || null
  });

  if (mode === 'legacy') {
    sendSafe(ws, { type: 'error', message: result.response.error?.message || 'request rejected' });
    return;
  }

  sendSafe(ws, result.response);
}

wss.on('connection', (ws) => {
  publishChainEvent(bus, 'gateway.ws.connected', {
    channel: '/ws'
  });
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      publishChainEvent(bus, 'gateway.ws.parse_error', {
        channel: '/ws'
      });
      sendSafe(ws, createRpcError(null, RpcErrorCode.PARSE_ERROR, 'Invalid JSON'));
      return;
    }

    publishChainEvent(bus, 'gateway.ws.inbound', {
      channel: '/ws',
      raw_type: msg?.type || null,
      method: msg?.method || null,
      jsonrpc: msg?.jsonrpc || null,
      id: msg?.id ?? null
    });

    if (msg && msg.jsonrpc === '2.0') {
      console.log(`[GW RPC] [${msg.id || 'notify'}] ${msg.method}`, JSON.stringify(msg.params).substring(0, 200));
      await enqueueRpc(ws, msg, 'rpc');
      return;
    }

    if (msg && msg.type === 'run') {
      const rpcPayload = {
        jsonrpc: '2.0',
        method: 'runtime.run',
        params: {
          session_id: msg.session_id || `web-${uuidv4()}`,
          input: msg.input || '',
          permission_level: msg.permission_level,
          input_images: msg.input_images
        }
      };

      await enqueueRpc(ws, rpcPayload, 'legacy');
      return;
    }

    publishChainEvent(bus, 'gateway.ws.invalid_request', {
      channel: '/ws'
    });
    sendSafe(ws, createRpcError(null, RpcErrorCode.INVALID_REQUEST, 'Unsupported message format'));
  });

  const onGlobalEvent = (topic, payload) => {
    if (typeof topic === 'string' && (topic.startsWith('ui.') || topic.startsWith('client.') || topic.startsWith('voice.'))) {
      const rpcPayload = {
        jsonrpc: '2.0',
        method: 'runtime.event',
        params: {
          name: topic,
          data: payload
        }
      };
      sendSafe(ws, rpcPayload);
    }
  };

  const unsubscribe = bus.subscribe('*', onGlobalEvent);

  ws.on('close', () => {
    unsubscribe();
    publishChainEvent(bus, 'gateway.ws.closed', {
      channel: '/ws'
    });
  });
});
