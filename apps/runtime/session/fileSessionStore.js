const fs = require('node:fs/promises');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { buildSessionLongTermMemory } = require('./longTermMemory');
const { getRuntimePaths } = require('../skills/runtimePaths');
const {
  buildDefaultSessionSettings,
  normalizeSessionSettings,
  mergeSessionSettings
} = require('./sessionPermissions');

const INDEX_FILE = 'index.json';

function nowIso() {
  return new Date().toISOString();
}

function toFileSafeSessionId(sessionId) {
  return encodeURIComponent(String(sessionId));
}

function defaultSession(sessionId, title = 'New chat') {
  const createdAt = nowIso();
  return {
    session_id: sessionId,
    title,
    created_at: createdAt,
    updated_at: createdAt,
    messages: [],
    events: [],
    runs: [],
    settings: buildDefaultSessionSettings(),
    memory: {
      version: 1,
      updated_at: createdAt,
      archived_message_count: 0,
      recent_window_messages: 12,
      summary: '',
      entries: []
    }
  };
}

function buildSummary(session) {
  const lastRun = session.runs[session.runs.length - 1] || null;
  return {
    session_id: session.session_id,
    title: session.title || 'New chat',
    created_at: session.created_at,
    updated_at: session.updated_at,
    message_count: session.messages.length,
    event_count: session.events.length,
    run_count: session.runs.length,
    permission_level: session.settings?.permission_level || null,
    approval_mode: session.settings?.approval_mode || null,
    last_state: lastRun?.state || null,
    last_output_preview: lastRun?.output ? String(lastRun.output).slice(0, 120) : null
  };
}

class FileSessionStore {
  constructor({ rootDir } = {}) {
    this.rootDir = rootDir || process.env.SESSION_STORE_DIR || path.join(getRuntimePaths().dataDir, 'session-store');
    this.sessionsDir = path.join(this.rootDir, 'sessions');
    this.indexPath = path.join(this.rootDir, INDEX_FILE);

    this._sessionLocks = new Map();
    this._globalLock = Promise.resolve();
    this._readyPromise = this.ensureReady();
  }

  async ensureReady() {
    await fs.mkdir(this.sessionsDir, { recursive: true });

    try {
      await fs.access(this.indexPath);
    } catch {
      await this.writeJsonAtomic(this.indexPath, { version: 1, sessions: {} });
    }
  }

  async ready() {
    await this._readyPromise;
  }

  sessionPath(sessionId) {
    return path.join(this.sessionsDir, `${toFileSafeSessionId(sessionId)}.json`);
  }

  async readJson(filePath, fallback = null) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  async writeJsonAtomic(filePath, data) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  }

  async withSessionLock(sessionId, fn) {
    const key = String(sessionId);
    const prev = this._sessionLocks.get(key) || Promise.resolve();

    const next = prev.then(fn, fn);
    this._sessionLocks.set(key, next);

    try {
      return await next;
    } finally {
      if (this._sessionLocks.get(key) === next) {
        this._sessionLocks.delete(key);
      }
    }
  }

  async withGlobalLock(fn) {
    const prev = this._globalLock;
    const next = prev.then(fn, fn);
    this._globalLock = next;
    return next;
  }

  async readIndex() {
    await this.ready();
    const index = await this.readJson(this.indexPath, { version: 1, sessions: {} });
    if (!index.sessions || typeof index.sessions !== 'object') {
      return { version: 1, sessions: {} };
    }
    return index;
  }

  async upsertIndexSummary(summary) {
    await this.withGlobalLock(async () => {
      const index = await this.readIndex();
      index.sessions[summary.session_id] = summary;
      await this.writeJsonAtomic(this.indexPath, index);
    });
  }

  async loadSessionOrCreate(sessionId, title = 'New chat') {
    const file = this.sessionPath(sessionId);
    const existing = await this.readJson(file, null);
    if (existing) return this.normalizeSession(existing);

    const created = defaultSession(sessionId, title);
    await this.writeJsonAtomic(file, created);
    return created;
  }

  normalizeSession(session) {
    if (!session || typeof session !== 'object') return session;
    if (!Array.isArray(session.messages)) session.messages = [];
    if (!Array.isArray(session.events)) session.events = [];
    if (!Array.isArray(session.runs)) session.runs = [];
    session.settings = normalizeSessionSettings(session.settings);
    if (!session.memory || typeof session.memory !== 'object') {
      session.memory = {
        version: 1,
        updated_at: nowIso(),
        archived_message_count: 0,
        recent_window_messages: 12,
        summary: '',
        entries: []
      };
    } else {
      if (!Array.isArray(session.memory.entries)) session.memory.entries = [];
      if (typeof session.memory.summary !== 'string') session.memory.summary = '';
      if (!session.memory.updated_at) session.memory.updated_at = nowIso();
      if (typeof session.memory.archived_message_count !== 'number') {
        session.memory.archived_message_count = 0;
      }
      if (typeof session.memory.recent_window_messages !== 'number') {
        session.memory.recent_window_messages = 12;
      }
    }
    return session;
  }

  async saveSession(session) {
    session.updated_at = session.updated_at || nowIso();
    const file = this.sessionPath(session.session_id);
    await this.writeJsonAtomic(file, session);
    await this.upsertIndexSummary(buildSummary(session));
  }

  async createSessionIfNotExists({ sessionId, title = 'New chat' }) {
    await this.ready();
    return this.withSessionLock(sessionId, async () => {
      const session = await this.loadSessionOrCreate(sessionId, title);
      if (!session.title) session.title = title;
      await this.saveSession(session);
      return session;
    });
  }

  async appendMessage(sessionId, message) {
    await this.ready();
    return this.withSessionLock(sessionId, async () => {
      const session = await this.loadSessionOrCreate(sessionId);
      const createdAt = message.created_at || nowIso();

      const entry = {
        id: message.id || uuidv4(),
        role: message.role || 'assistant',
        content: String(message.content || ''),
        created_at: createdAt,
        trace_id: message.trace_id || null,
        request_id: message.request_id || null,
        metadata: message.metadata || {}
      };

      session.messages.push(entry);
      session.updated_at = createdAt;

      if ((session.title === 'New chat' || !session.title) && entry.role === 'user') {
        session.title = entry.content.trim().slice(0, 40) || 'New chat';
      }

      await this.saveSession(session);
      return entry;
    });
  }

  async appendEvent(sessionId, event) {
    await this.ready();
    return this.withSessionLock(sessionId, async () => {
      const session = await this.loadSessionOrCreate(sessionId);
      const createdAt = nowIso();

      const entry = {
        id: uuidv4(),
        created_at: createdAt,
        event
      };

      session.events.push(entry);
      session.updated_at = createdAt;
      await this.saveSession(session);
      return entry;
    });
  }

  async appendRun(sessionId, run) {
    await this.ready();
    return this.withSessionLock(sessionId, async () => {
      const session = await this.loadSessionOrCreate(sessionId);
      const createdAt = run.created_at || nowIso();

      const entry = {
        id: run.id || uuidv4(),
        created_at: createdAt,
        request_id: run.request_id || null,
        trace_id: run.trace_id || null,
        input: String(run.input || ''),
        output: String(run.output || ''),
        state: run.state || null,
        mode: run.mode || null,
        permission_level: run.permission_level || null,
        workspace_root: run.workspace_root || null,
        metadata: run.metadata || {}
      };

      session.runs.push(entry);
      session.updated_at = createdAt;
      await this.saveSession(session);
      return entry;
    });
  }

  async refreshMemory(sessionId, options = {}) {
    await this.ready();
    return this.withSessionLock(sessionId, async () => {
      const session = await this.loadSessionOrCreate(sessionId);
      session.memory = buildSessionLongTermMemory(session, options);
      await this.saveSession(session);
      return session.memory;
    });
  }

  async getSessionSettings(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    return normalizeSessionSettings(session.settings);
  }

  async updateSessionSettings(sessionId, patch = {}) {
    await this.ready();
    return this.withSessionLock(sessionId, async () => {
      const session = await this.loadSessionOrCreate(sessionId);
      session.settings = mergeSessionSettings(session.settings, patch);
      session.updated_at = nowIso();
      await this.saveSession(session);
      return session.settings;
    });
  }

  async listSessions({ limit = 50, offset = 0 } = {}) {
    const index = await this.readIndex();
    const items = Object.values(index.sessions)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

    return {
      total: items.length,
      items: items.slice(offset, offset + limit)
    };
  }

  async getSession(sessionId) {
    await this.ready();
    const session = await this.readJson(this.sessionPath(sessionId), null);
    if (!session) return null;
    return this.normalizeSession(session);
  }

  async getSessionEvents(sessionId, { limit = 200, offset = 0 } = {}) {
    const session = await this.getSession(sessionId);
    if (!session) return { total: 0, items: [] };

    const events = [...session.events].reverse();
    return {
      total: events.length,
      items: events.slice(offset, offset + limit)
    };
  }

  async getStats() {
    const { total } = await this.listSessions({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
    return {
      root_dir: this.rootDir,
      session_count: total
    };
  }
}

module.exports = { FileSessionStore };
