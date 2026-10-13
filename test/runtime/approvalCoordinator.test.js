const test = require('node:test');
const assert = require('node:assert/strict');
const { ApprovalCoordinator } = require('../../apps/runtime/approval/approvalCoordinator');
const { createShellApprovalRequest, consumeShellApproval,
  __resetShellApprovalStoreForTests } = require('../../apps/runtime/tooling/shellApprovalStore');

test.beforeEach(() => __resetShellApprovalStoreForTests());

test('TC-PI-035 auto approval grants once and retries outside the model loop', async () => {
  const request = createShellApprovalRequest({ sessionId: 's-auto', command: 'echo a && echo b' });
  let retries = 0;
  const coordinator = new ApprovalCoordinator();
  const result = await coordinator.coordinate({
    result: { ok: false, code: 'APPROVAL_REQUIRED', details: request },
    context: { session_id: 's-auto', approval_mode: 'auto_approve' },
    toolName: 'shell.exec',
    execute: async () => {
      retries += 1;
      return { ok: consumeShellApproval({ sessionId: 's-auto', command: request.command }).approved, result: 'done' };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(retries, 1);
});

test('TC-PI-035 manual approval waits for matching session decision and supports denial', async () => {
  const coordinator = new ApprovalCoordinator({ timeoutMs: 1000 });
  const request = createShellApprovalRequest({ sessionId: 's-manual', command: 'echo a && echo b' });
  const pending = coordinator.coordinate({
    result: { ok: false, code: 'APPROVAL_REQUIRED', details: request },
    context: { session_id: 's-manual', approval_mode: 'manual' },
    toolName: 'shell.exec', execute: async () => ({ ok: true, result: 'approved' })
  });
  const listed = coordinator.list({ sessionId: 's-manual' });
  assert.equal(listed.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(listed[0], 'promise'), false);
  assert.equal(coordinator.decide({ approvalId: request.approval_id, sessionId: 'wrong', approved: true }), false);
  assert.equal(coordinator.decide({ approvalId: request.approval_id, sessionId: 's-manual', approved: false }), true);
  const denied = await pending;
  assert.equal(denied.code, 'PERMISSION_DENIED');
  assert.equal(coordinator.list().length, 0);
});
