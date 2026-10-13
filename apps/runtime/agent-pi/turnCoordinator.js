const { contentText } = require('./eventBridge');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function hasToolCalls(message) {
  return Array.isArray(message?.content) && message.content.some((part) => part.type === 'toolCall');
}

class TurnCoordinator {
  constructor({ onActivate } = {}) {
    this.onActivate = onActivate;
    this.active = null;
    this.lastSettled = null;
    this.pending = [];
    this.trackers = new Set();
  }

  register(options = {}) {
    const completion = deferred();
    const tracker = {
      ...options,
      completion,
      promise: completion.promise,
      failures: 0,
      limited: false,
      settled: false,
      disposition: options.startsImmediately ? 'started' : 'queued'
    };
    this.trackers.add(tracker);
    if (options.startsImmediately && !this.active) this.activate(tracker);
    else this.pending.push(tracker);
    return tracker;
  }

  activate(tracker) {
    if (!tracker || tracker.settled) return;
    this.pending = this.pending.filter((item) => item !== tracker);
    this.active = tracker;
    this.lastSettled = null;
    this.onActivate?.(tracker);
  }

  current() {
    return this.active;
  }

  accept(event) {
    if (event?.type === 'turn_start' && !this.active) this.activate(this.pending[0]);
    if (event?.type === 'message_start' && event.message?.role === 'user') {
      const next = this.pending[0];
      const incoming = contentText(event.message.content);
      if (this.active && next && incoming === next.input) {
        this.resolve(this.active, {
          output: '已接收新的输入，上一轮已由 steering 接续。',
          state: 'SUPERSEDED',
          error: null
        });
        this.activate(next);
        next.events.accept({ type: 'turn_start' });
      } else if (!this.active) {
        this.activate(next);
      }
    }
    const tracker = this.active || (String(event?.type || '').startsWith('compaction_') ? this.lastSettled : null);
    if (!tracker) return;
    tracker.events.accept(event);
    if (event.type !== 'message_end' || event.message?.role !== 'assistant' || hasToolCalls(event.message)) return;
    const failed = ['error', 'aborted'].includes(event.message.stopReason);
    this.resolve(tracker, {
      output: failed ? String(event.message.errorMessage || 'Agent did not complete') : contentText(event.message.content),
      state: failed ? 'ERROR' : 'DONE',
      error: failed ? new Error(event.message.errorMessage || 'Agent did not complete') : null
    });
  }

  fail(tracker, error, state = 'ERROR') {
    if (!tracker || tracker.settled) return;
    this.resolve(tracker, { output: String(error?.message || error), state, error });
  }

  resolve(tracker, result) {
    if (!tracker || tracker.settled) return;
    tracker.settled = true;
    this.lastSettled = tracker;
    this.trackers.delete(tracker);
    this.pending = this.pending.filter((item) => item !== tracker);
    if (this.active === tracker) this.active = null;
    tracker.completion.resolve(result);
  }

  failAll(error, state = 'ERROR') {
    for (const tracker of [...this.trackers]) this.fail(tracker, error, state);
  }

  get size() {
    return this.trackers.size;
  }
}

module.exports = { TurnCoordinator, hasToolCalls };
