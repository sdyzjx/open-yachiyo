const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SessionBridge, historyMessage, compactionSettings } = require('../../../apps/runtime/agent-pi/sessionBridge');
const { FileSessionStore } = require('../../../apps/runtime/session/fileSessionStore');
const model = { api: 'openai-completions', provider: 'local', id: 'test' };

test('TC-PI-012 stable pi sessions restore history and do not duplicate seeds', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-sessions-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const bridge = new SessionBridge({ rootDir });
  const sessionId = '../unsafe/你好';
  const { manager } = await bridge.open({ sessionId, model, seedMessages: [{ role: 'user', content: 'first' }, { role: 'system', content: 'policy' }] });
  manager.appendMessage(historyMessage({ role: 'assistant', content: 'answer' }, model));
  const restored = await new SessionBridge({ rootDir }).open({ sessionId, model, seedMessages: [{ role: 'user', content: 'first' }] });
  assert.deepEqual(restored.manager.buildSessionContext().messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(restored.systemSeeds[0].content, 'policy');
  assert.equal(path.dirname(bridge.fileFor(sessionId)), rootDir);
  assert.equal(restored.settingsManager.getCompactionSettings().enabled, true);
  assert.throws(() => compactionSettings({ reserveTokens: -1 }), /Invalid/);
});

test('TC-PI-013 session serialization and optional UI history mirror', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-mirror-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = new FileSessionStore({ rootDir });
  const bridge = new SessionBridge({ rootDir, sessionStore: store });
  const order = [];
  await Promise.all([bridge.withSession('s', async () => { await Promise.resolve(); order.push(1); }), bridge.withSession('s', () => order.push(2))]);
  assert.deepEqual(order, [1, 2]);
  assert.equal(bridge.locks.size, 0);
  await bridge.start('s', 'hello');
  await bridge.finish('s', { output: 'world', traceId: 't', state: 'DONE' }, [{ event: 'done' }]);
  assert.equal((await store.getSession('s')).messages.length, 2);
  const external = new SessionBridge({ sessionStore: store, mirrorHistory: false });
  await external.start('s', 'duplicate');
  assert.equal((await store.getSession('s')).messages.length, 2);
});
