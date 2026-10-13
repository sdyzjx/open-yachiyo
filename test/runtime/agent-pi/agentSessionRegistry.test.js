const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentSessionRegistry } = require('../../../apps/runtime/agent-pi/agentSessionRegistry');

test('TC-PI-030 registry creates one long-lived entry per session', async () => {
  const created = [];
  const registry = new AgentSessionRegistry({ createEntry: async (sessionId) => {
    const entry = { sessionId, disposed: false, dispose() { this.disposed = true; } };
    created.push(entry);
    return entry;
  } });
  const [first, same] = await Promise.all([registry.get('s1'), registry.get('s1')]);
  const other = await registry.get('s2');
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.equal(created.length, 2);
  await registry.disposeAll();
  assert.equal(created.every((entry) => entry.disposed), true);
});

test('TC-PI-031 registry evicts only idle expired sessions and respects capacity', async () => {
  let now = 0;
  const disposed = [];
  const registry = new AgentSessionRegistry({ idleTtlMs: 1000, maxSessions: 2, now: () => now,
    createEntry: async (sessionId) => ({ sessionId, busy: false, isBusy() { return this.busy; }, dispose() { disposed.push(sessionId); } }) });
  const first = await registry.get('first');
  now = 500;
  await registry.get('second');
  first.busy = true;
  now = 2000;
  await registry.get('third');
  assert.deepEqual(disposed, ['second']);
  assert.equal(registry.peek('first'), first);
  first.busy = false;
  await registry.sweep();
  assert.deepEqual(disposed, ['second', 'first']);
  await registry.disposeAll();
});
