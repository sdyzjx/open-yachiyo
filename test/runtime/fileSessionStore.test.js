const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileSessionStore } = require('../../apps/runtime/session/fileSessionStore');

function createStore() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-session-store-'));
  return new FileSessionStore({ rootDir });
}

test('FileSessionStore persists session messages/events/runs', async () => {
  const store = createStore();

  await store.createSessionIfNotExists({ sessionId: 's1', title: 'New chat' });
  await store.appendMessage('s1', { role: 'user', content: 'hello' });
  await store.appendEvent('s1', { event: 'plan', payload: { input: 'hello' } });
  await store.appendRun('s1', { input: 'hello', output: 'hi', state: 'DONE' });
  await store.refreshMemory('s1', { recentWindowMessages: 0 });

  const session = await store.getSession('s1');
  assert.ok(session);
  assert.equal(session.messages.length, 1);
  assert.equal(session.events.length, 1);
  assert.equal(session.runs.length, 1);
  assert.equal(session.title, 'hello');
  assert.ok(session.memory);
  assert.equal(session.settings.permission_level, 'high');
  assert.equal(session.settings.approval_mode, 'manual');
  assert.equal(session.settings.workspace.mode, 'session');
  assert.equal(session.settings.workspace.root_dir, null);
  assert.equal(session.memory.archived_message_count, 1);
  assert.match(session.memory.summary, /hello/);

  const summary = await store.listSessions();
  assert.equal(summary.total, 1);
  assert.equal(summary.items[0].session_id, 's1');
  assert.equal(summary.items[0].run_count, 1);
  assert.equal(summary.items[0].approval_mode, 'manual');

  const events = await store.getSessionEvents('s1', { limit: 10, offset: 0 });
  assert.equal(events.total, 1);
  assert.equal(events.items[0].event.event, 'plan');
});

test('FileSessionStore isolates writes by session lock', async () => {
  const store = createStore();

  await Promise.all(Array.from({ length: 20 }).map((_, i) => store.appendMessage('s2', {
    role: 'user',
    content: `msg-${i}`
  })));

  const session = await store.getSession('s2');
  assert.equal(session.messages.length, 20);
});

test('FileSessionStore updates per-session settings', async () => {
  const store = createStore();

  await store.createSessionIfNotExists({ sessionId: 's3', title: 'New chat' });
  const initialSettings = await store.getSessionSettings('s3');
  assert.equal(initialSettings.permission_level, 'high');
  assert.equal(initialSettings.approval_mode, 'manual');

  await store.updateSessionSettings('s3', { permission_level: 'high', approval_mode: 'auto_approve' });
  await store.updateSessionSettings('s3', {
    workspace: { root_dir: '/tmp/test-workspace-s3' }
  });
  const updatedSettings = await store.getSessionSettings('s3');
  assert.equal(updatedSettings.permission_level, 'high');
  assert.equal(updatedSettings.approval_mode, 'auto_approve');
  assert.equal(updatedSettings.workspace.mode, 'session');
  assert.equal(updatedSettings.workspace.root_dir, '/tmp/test-workspace-s3');

  const session = await store.getSession('s3');
  assert.equal(session.settings.permission_level, 'high');
});
