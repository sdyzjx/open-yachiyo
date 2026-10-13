class AgentSessionRegistry {
  constructor({ createEntry, idleTtlMs = 30 * 60 * 1000, maxSessions = 32, now = () => Date.now() } = {}) {
    if (typeof createEntry !== 'function') throw new Error('createEntry is required');
    this.createEntry = createEntry;
    this.idleTtlMs = Math.max(1000, Number(idleTtlMs) || 30 * 60 * 1000);
    this.maxSessions = Math.max(1, Number(maxSessions) || 32);
    this.now = now;
    this.entries = new Map();
  }

  async get(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is required');
    let record = this.entries.get(sessionId);
    if (!record) {
      record = { promise: null, entry: null, touchedAt: this.now() };
      record.promise = Promise.resolve(this.createEntry(sessionId, options)).then((entry) => {
        record.entry = entry;
        record.touchedAt = this.now();
        return entry;
      }).catch((error) => {
        if (this.entries.get(sessionId) === record) this.entries.delete(sessionId);
        throw error;
      });
      this.entries.set(sessionId, record);
    }
    record.touchedAt = this.now();
    const entry = await record.promise;
    record.touchedAt = this.now();
    await this.sweep(sessionId);
    return entry;
  }

  peek(sessionId) {
    return this.entries.get(sessionId)?.entry || null;
  }

  async sweep(excludeSessionId = null) {
    const now = this.now();
    const candidates = [...this.entries.entries()]
      .filter(([sessionId, record]) => sessionId !== excludeSessionId && record.entry && !record.entry.isBusy?.())
      .sort((left, right) => left[1].touchedAt - right[1].touchedAt);
    for (const [sessionId, record] of candidates) {
      const expired = now - record.touchedAt >= this.idleTtlMs;
      const overLimit = this.entries.size > this.maxSessions;
      if (!expired && !overLimit) continue;
      await this.dispose(sessionId);
    }
  }

  async dispose(sessionId) {
    const record = this.entries.get(sessionId);
    if (!record) return false;
    this.entries.delete(sessionId);
    let entry;
    try { entry = await record.promise; } catch { return true; }
    await entry?.dispose?.();
    return true;
  }

  async disposeAll() {
    const ids = [...this.entries.keys()];
    await Promise.allSettled(ids.map((sessionId) => this.dispose(sessionId)));
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { AgentSessionRegistry };
