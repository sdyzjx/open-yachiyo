const path = require('node:path');
const { createHash } = require('node:crypto');
const { getRuntimePaths } = require('../skills/runtimePaths');
const { loadPi } = require('./loadPi');

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function historyMessage(message, model) {
  if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) return null;
  if (message.role === 'user') return { role: 'user', content: message.content, timestamp: Date.now() };
  return { role: 'assistant', content: [{ type: 'text', text: message.content }], timestamp: Date.now(),
    api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', usage: structuredClone(EMPTY_USAGE) };
}

function compactionSettings(config = {}) {
  const result = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, ...config };
  for (const key of ['reserveTokens', 'keepRecentTokens']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) throw new Error(`Invalid compaction ${key}`);
  }
  return result;
}

class SessionBridge {
  constructor({ rootDir, sessionStore, mirrorHistory = true, compaction } = {}) {
    this.rootDir = rootDir || process.env.PI_SESSION_STORE_DIR || (sessionStore?.rootDir
      ? path.join(path.dirname(sessionStore.rootDir), 'pi-sessions')
      : path.join(getRuntimePaths().dataDir, 'pi-sessions'));
    this.sessionStore = sessionStore;
    this.mirrorHistory = mirrorHistory;
    this.compaction = compactionSettings(compaction);
    this.locks = new Map();
  }

  fileFor(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is required');
    return path.join(this.rootDir, `${createHash('sha256').update(sessionId).digest('hex')}.jsonl`);
  }

  async withSession(sessionId, fn) {
    const previous = this.locks.get(sessionId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(fn);
    this.locks.set(sessionId, pending);
    try { return await pending; } finally {
      if (this.locks.get(sessionId) === pending) this.locks.delete(sessionId);
    }
  }

  async open({ sessionId, cwd = process.cwd(), seedMessages = [], model }) {
    const { sdk } = await loadPi();
    const manager = sdk.SessionManager.open(this.fileFor(sessionId), this.rootDir, cwd);
    const entries = manager.getEntries();
    const identity = entries.find((entry) => entry.type === 'custom' && entry.customType === 'yachiyo.session');
    if (identity && identity.data.sessionId !== sessionId) throw new Error('Session identity mismatch');
    if (!identity) manager.appendCustomEntry('yachiyo.session', { sessionId });
    if (!entries.some((entry) => entry.type === 'message' && ['user', 'assistant'].includes(entry.message.role))) {
      const history = seedMessages.length ? seedMessages : (await this.sessionStore?.getSession(sessionId))?.messages || [];
      for (const message of history) {
        const converted = historyMessage(message, model);
        if (converted) manager.appendMessage(converted);
      }
    }
    const systemSeeds = seedMessages.filter((message) => message.role === 'system');
    if (systemSeeds.length) manager.appendCustomEntry('yachiyo.prompt-seeds', systemSeeds);
    const savedSeeds = [...manager.getEntries()].reverse().find((entry) => entry.type === 'custom' && entry.customType === 'yachiyo.prompt-seeds');
    return { manager, systemSeeds: systemSeeds.length ? systemSeeds : savedSeeds?.data || [],
      settingsManager: sdk.SettingsManager.inMemory({ compaction: this.compaction, retry: { enabled: false }, images: { autoResize: false } }) };
  }

  async start(sessionId, input, metadata = {}) {
    if (!this.mirrorHistory || !this.sessionStore) return;
    await this.sessionStore.createSessionIfNotExists({ sessionId });
    await this.sessionStore.appendMessage(sessionId, { role: 'user', content: input, metadata });
  }

  async finish(sessionId, result, events = []) {
    if (!this.mirrorHistory || !this.sessionStore) return;
    for (const event of events) await this.sessionStore.appendEvent(sessionId, event);
    await this.sessionStore.appendMessage(sessionId, { role: 'assistant', content: result.output, trace_id: result.traceId, metadata: { state: result.state } });
    await this.sessionStore.appendRun(sessionId, { trace_id: result.traceId, output: result.output, state: result.state, metrics: result.metrics });
  }
}

module.exports = { SessionBridge, historyMessage, compactionSettings };
