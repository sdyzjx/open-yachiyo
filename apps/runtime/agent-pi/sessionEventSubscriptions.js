const { randomUUID } = require('node:crypto');

const SAFE_TOPIC = /^(plugin|device|avatar|audio|voice|task|ui|client|sys)\.[\w.*-]+$/;
const MAX_SUBSCRIPTIONS = 32;
const DEFAULT_QUEUE_SIZE = 128;
const MAX_QUEUE_SIZE = 512;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const MAX_EVENT_BYTES = 64 * 1024;

function validTopicPattern(pattern) {
  return typeof pattern === 'string'
    && pattern.length <= 256
    && SAFE_TOPIC.test(pattern)
    && pattern.split('.').every((part) => /^(?:\*\*?|[\w-]+)$/.test(part));
}

function matchesTopic(pattern, topic) {
  const expected = pattern.split('.');
  const actual = String(topic || '').split('.');
  const visit = (left, right) => {
    if (left === expected.length) return right === actual.length;
    if (expected[left] === '**') return visit(left + 1, right) || (right < actual.length && visit(left, right + 1));
    return right < actual.length
      && (expected[left] === '*' || expected[left] === actual[right])
      && visit(left + 1, right + 1);
  };
  return visit(0, 0);
}

function clipInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

class SessionEventSubscriptions {
  constructor({ bus, sessionId, now = () => Date.now(), onSteer } = {}) {
    if (!bus?.subscribeAll) throw new Error('RuntimeEventBus with subscribeAll is required');
    this.bus = bus;
    this.sessionId = sessionId;
    this.now = now;
    this.onSteer = onSteer;
    this.subscriptions = new Map();
    this.events = [];
    this.channels = new Map();
    this.cursor = 0;
    this.droppedEvents = 0;
    this.off = bus.subscribeAll(({ topic, payload }) => this.accept(topic, payload));
  }

  subscribe({ pattern, delivery = 'pull', priority = 'normal', ttl_ms: ttlMs,
    max_queue: maxQueue, include_self: includeSelf = false } = {}) {
    this.purgeExpired();
    if (!validTopicPattern(pattern)) throw new Error('topic pattern is not allowed');
    if (!['pull', 'steer'].includes(delivery)) throw new Error('delivery must be pull or steer');
    if (delivery === 'steer' && priority !== 'high') throw new Error('steer delivery requires priority=high');
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new Error('subscription limit reached');
    const now = this.now();
    const entry = {
      subscription_id: `sub_${randomUUID()}`,
      pattern,
      delivery,
      priority: delivery === 'steer' ? 'high' : priority,
      include_self: includeSelf === true,
      max_queue: clipInteger(maxQueue, DEFAULT_QUEUE_SIZE, 1, MAX_QUEUE_SIZE),
      created_at_ms: now,
      expires_at_ms: now + clipInteger(ttlMs, DEFAULT_TTL_MS, 1000, MAX_TTL_MS)
    };
    this.subscriptions.set(entry.subscription_id, entry);
    return { ...entry };
  }

  unsubscribe(subscriptionId) {
    const removed = this.subscriptions.delete(String(subscriptionId || ''));
    if (removed) this.events = this.events.filter((event) => !event.subscription_ids.includes(subscriptionId));
    return removed;
  }

  accept(topic, payload) {
    if (!validTopicPattern(topic)) return;
    if (payload?.session_id && payload.session_id !== this.sessionId && !payload.__from_device) return;
    let encoded;
    try { encoded = JSON.stringify(payload ?? null); } catch { this.droppedEvents += 1; return; }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_EVENT_BYTES) { this.droppedEvents += 1; return; }
    const now = this.now();
    this.channels.set(topic, {
      topic,
      event_count: (this.channels.get(topic)?.event_count || 0) + 1,
      last_seen_at_ms: now
    });
    this.purgeExpired();
    const matched = [...this.subscriptions.values()].filter((entry) =>
      matchesTopic(entry.pattern, topic)
      && (entry.include_self || payload?.session_id !== this.sessionId));
    if (!matched.length) return;
    const event = {
      cursor: ++this.cursor,
      topic,
      data: payload,
      received_at_ms: now,
      subscription_ids: matched.map((entry) => entry.subscription_id)
    };
    const pull = matched.filter((entry) => entry.delivery === 'pull');
    if (pull.length) {
      this.events.push(event);
      const limit = Math.min(...[...this.subscriptions.values()]
        .filter((entry) => entry.delivery === 'pull')
        .map((entry) => entry.max_queue));
      if (this.events.length > limit) this.events.splice(0, this.events.length - limit);
    }
    if (matched.some((entry) => entry.delivery === 'steer')) {
      Promise.resolve(this.onSteer?.(event)).catch((error) => {
        this.bus.publish('runtime.bus.steer.failed', {
          session_id: this.sessionId,
          topic,
          error: String(error?.message || error)
        });
      });
    }
  }

  pull({ after_cursor: afterCursor = 0, limit = 50, acknowledge = true } = {}) {
    this.purgeExpired();
    const cursor = Math.max(0, Number(afterCursor) || 0);
    const pageSize = clipInteger(limit, 50, 1, 100);
    const items = this.events.filter((event) => event.cursor > cursor).slice(0, pageSize);
    if (acknowledge !== false && items.length) {
      const last = items[items.length - 1].cursor;
      this.events = this.events.filter((event) => event.cursor > last);
    }
    return { items, next_cursor: items.at(-1)?.cursor || cursor, pending: this.events.length,
      dropped_events: this.droppedEvents };
  }

  listChannels() {
    this.purgeExpired();
    return {
      subscriptions: [...this.subscriptions.values()].map((entry) => ({ ...entry })),
      channels: [...this.channels.values()].sort((left, right) => right.last_seen_at_ms - left.last_seen_at_ms),
      dropped_events: this.droppedEvents
    };
  }

  purgeExpired() {
    const now = this.now();
    const expired = new Set([...this.subscriptions.values()]
      .filter((entry) => entry.expires_at_ms <= now)
      .map((entry) => entry.subscription_id));
    for (const id of expired) this.subscriptions.delete(id);
    if (expired.size) {
      this.events = this.events.map((event) => ({
        ...event,
        subscription_ids: event.subscription_ids.filter((id) => !expired.has(id))
      })).filter((event) => event.subscription_ids.length);
    }
  }

  dispose() {
    this.off?.();
    this.subscriptions.clear();
    this.events = [];
    this.channels.clear();
  }
}

module.exports = {
  SessionEventSubscriptions,
  validTopicPattern,
  matchesTopic,
  MAX_SUBSCRIPTIONS,
  MAX_QUEUE_SIZE,
  MAX_TTL_MS,
  MAX_EVENT_BYTES
};
