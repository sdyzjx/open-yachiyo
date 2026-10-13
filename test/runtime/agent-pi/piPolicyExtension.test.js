const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPiPolicyExtension, dangerousCommandReason, bashPolicyReason } = require('../../../apps/runtime/agent-pi/piPolicyExtension');

function policyHandler({ cwd = '/workspace', current = {}, decision = { approved: true } } = {}) {
  let handler;
  const approvals = [];
  createPiPolicyExtension({
    cwd,
    context: () => current,
    approvalCoordinator: {
      async requestFrontendDecision(request) {
        approvals.push(request);
        return decision;
      }
    }
  })({ on(event, callback) { if (event === 'tool_call') handler = callback; } });
  return {
    approvals,
    call: (toolName, input = {}) => handler({ toolName, input, toolCallId: 'call' }, {
      cwd, signal: new AbortController().signal
    })
  };
}

test('TC-PI-044 Pi policy extension owns workspace boundaries for native tools', async () => {
  const medium = policyHandler({ current: {
    session_id: 's', permission_level: 'medium', approval_mode: 'auto_approve', workspace_root: '/workspace'
  } });
  assert.match((await medium.call('read', { path: '../outside.txt' })).reason, /read path escapes workspace/);
  assert.match((await medium.call('write', { path: '../outside.txt' })).reason, /write path escapes workspace/);
  assert.equal(await medium.call('read', { path: 'inside.txt' }), undefined);

  const high = policyHandler({ current: {
    session_id: 's', permission_level: 'high', approval_mode: 'auto_approve', workspace_root: '/workspace'
  } });
  assert.equal(await high.call('read', { path: '/tmp/outside.txt' }), undefined);
  assert.match((await high.call('edit', { path: '/tmp/outside.txt' })).reason, /write path escapes workspace/);

  const full = policyHandler({ current: {
    session_id: 's', permission_level: 'high', approval_mode: 'full_access', workspace_root: '/workspace'
  } });
  assert.equal(await full.call('write', { path: '/tmp/outside.txt' }), undefined);
});

test('TC-PI-044 Pi policy extension blocks dangerous commands before approval', async () => {
  for (const command of ['sudo whoami', 'rm -rf /', 'shutdown -h now', 'chmod 777 /tmp/x']) {
    assert.ok(dangerousCommandReason(command), command);
  }
  const policy = policyHandler({ current: {
    session_id: 's', permission_level: 'high', approval_mode: 'manual', workspace_root: '/workspace'
  } });
  const result = await policy.call('bash', { command: 'sudo whoami' });
  assert.equal(result.block, true);
  assert.match(result.reason, /blocked by Pi command policy/);
  assert.equal(policy.approvals.length, 0);
});

test('TC-PI-044 Pi policy extension requests command approval and honors denial', async () => {
  const denied = policyHandler({
    current: { session_id: 's', permission_level: 'high', approval_mode: 'manual', workspace_root: '/workspace' },
    decision: { approved: false, reason: 'denied' }
  });
  assert.match((await denied.call('bash', { command: 'echo hello' })).reason, /approval denied/);
  assert.equal(denied.approvals.length, 1);
  assert.equal(denied.approvals[0].toolName, 'bash');

  const allowed = policyHandler({
    current: { session_id: 's', permission_level: 'high', approval_mode: 'manual', workspace_root: '/workspace' }
  });
  assert.equal(await allowed.call('bash', { command: 'echo hello' }), undefined);
  assert.equal(allowed.approvals.length, 1);

  const always = policyHandler({
    current: { session_id: 's', permission_level: 'high', approval_mode: 'manual', workspace_root: '/workspace' },
    decision: { approved: true, scope: 'always' }
  });
  assert.equal(await always.call('bash', { command: 'echo remembered' }), undefined);
  assert.equal(await always.call('bash', { command: 'echo remembered' }), undefined);
  assert.equal(always.approvals.length, 1);

  const automatic = policyHandler({ current: {
    session_id: 's', permission_level: 'high', approval_mode: 'auto_approve', workspace_root: '/workspace'
  } });
  assert.equal(await automatic.call('bash', { command: 'echo automatic' }), undefined);
  assert.equal(automatic.approvals.length, 0);
});

test('TC-PI-044 Pi bash policy retains permission profiles and workspace writes', () => {
  const medium = { permission_level: 'medium', approval_mode: 'auto_approve', workspace_root: '/workspace' };
  assert.match(bashPolicyReason('python3 task.py', medium, '/workspace'), /not allowed/);
  assert.match(bashPolicyReason('echo hi && echo bye', medium, '/workspace'), /operators require high/);
  assert.match(bashPolicyReason('touch ../outside', medium, '/workspace'), /write path escapes workspace/);
  assert.equal(bashPolicyReason('touch inside', medium, '/workspace'), null);
  assert.equal(path.isAbsolute('/workspace'), true);
});
