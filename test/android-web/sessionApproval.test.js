const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const approval = require('../../apps/android/app/src/main/assets/web/js/sessionApproval');

test('session approval normalizes modes and pending requests', () => {
  assert.equal(approval.normalizeMode('AUTO_APPROVE'), 'auto_approve');
  assert.equal(approval.normalizeMode('unknown'), 'manual');
  assert.equal(approval.MODES.full_access.shortLabel, '完全');

  let pending = approval.upsertPending([], {
    approval_id: 'apr-1',
    session_id: 'device-phone',
    command: 'pwd',
    created_at_ms: 20
  });
  pending = approval.upsertPending(pending, {
    approval_id: 'apr-2',
    command: 'whoami',
    created_at_ms: 10
  });
  pending = approval.upsertPending(pending, {
    approval_id: 'apr-1',
    command: 'pwd -P',
    created_at_ms: 20
  });
  assert.deepEqual(pending.map((item) => item.approval_id), ['apr-2', 'apr-1']);
  assert.equal(pending[1].command, 'pwd -P');
  assert.deepEqual(approval.removePending(pending, 'apr-2').map((item) => item.approval_id), ['apr-1']);
  assert.equal(approval.isExpired({ expires_at_ms: 99 }, 100), true);
  assert.equal(approval.isExpired({ expires_at_ms: 0 }, 100), false);
  assert.equal(approval.normalizeRequest({ command: 'missing id' }), null);
});

test('Android main screen wires scoped session policy and approval events', () => {
  const root = path.resolve(__dirname, '../../apps/android/app/src/main/assets/web');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');

  assert.match(html, /id="approval-control-button"/);
  assert.match(html, /data-approval-mode="manual"/);
  assert.match(html, /js\/sessionApproval\.js/);
  for (const method of ['session.settings.get', 'session.settings.update', 'approval.pending.list', 'approval.decision']) {
    assert.match(app, new RegExp(method.replaceAll('.', '\\.')));
  }
  assert.match(app, /B\.subscribe\('approval\.requested'/);
  assert.match(app, /B\.subscribe\('approval\.resolved'/);
  assert.match(css, /body\[data-mode="lockscreen"\] \.approval-control-button/);
  assert.match(css, /backdrop-filter: blur\(30px\)/);
});
