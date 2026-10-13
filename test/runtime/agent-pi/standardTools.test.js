const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadPi } = require('../../../apps/runtime/agent-pi/loadPi');
const { createStandardTools } = require('../../../apps/runtime/agent-pi/standardTools');
const { ApprovalCoordinator } = require('../../../apps/runtime/approval/approvalCoordinator');
const { ToolConfigStore } = require('../../../apps/runtime/tooling/toolConfigStore');
const { ToolRegistry } = require('../../../apps/runtime/tooling/toolRegistry');
const { ToolExecutor } = require('../../../apps/runtime/executor/toolExecutor');
const { __resetShellApprovalStoreForTests } = require('../../../apps/runtime/tooling/shellApprovalStore');

function executor() {
  const store = new ToolConfigStore({ configPath: path.resolve(process.cwd(), 'config/tools.yaml') });
  const config = store.load();
  return new ToolExecutor(new ToolRegistry({ config }), { policy: config.policy, exec: config.exec });
}

test('TC-PI-037 standard Pi file and bash tools preserve session policy and approval', async (t) => {
  __resetShellApprovalStoreForTests();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-standard-workspace-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-standard-external-'));
  t.after(() => Promise.all([workspace, external].map((dir) => fs.rm(dir, { recursive: true, force: true }))));
  const { sdk } = await loadPi();
  let runtimeContext = {
    session_id: 'standard-tools',
    permission_level: 'medium',
    approval_mode: 'auto_approve',
    workspace_root: workspace,
    reportToolError() {}
  };
  const tools = Object.fromEntries(createStandardTools({
    sdk,
    cwd: workspace,
    executor: executor(),
    approvalCoordinator: new ApprovalCoordinator(),
    context: () => runtimeContext
  }).map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools), ['read', 'bash', 'edit', 'write']);

  await tools.write.execute('write', { path: 'note.txt', content: 'before' }, undefined, undefined, { cwd: workspace });
  const read = await tools.read.execute('read', { path: 'note.txt' }, undefined, undefined, {
    cwd: workspace, model: { input: ['text'] }
  });
  assert.match(read.content[0].text, /before/);
  await tools.edit.execute('edit', { path: 'note.txt', edits: [{ oldText: 'before', newText: 'after' }] },
    undefined, undefined, { cwd: workspace });
  assert.equal(await fs.readFile(path.join(workspace, 'note.txt'), 'utf8'), 'after');

  const outside = path.join(external, 'outside.txt');
  await fs.writeFile(outside, 'outside', 'utf8');
  await assert.rejects(tools.read.execute('outside-read', { path: outside }, undefined, undefined, {
    cwd: workspace, model: { input: ['text'] }
  }), /escapes workspace/);
  await assert.rejects(tools.write.execute('outside-write', { path: outside, content: 'blocked' },
    undefined, undefined, { cwd: workspace }), /escapes workspace/);

  runtimeContext = { ...runtimeContext, permission_level: 'high' };
  const highRead = await tools.read.execute('high-read', { path: outside }, undefined, undefined, {
    cwd: workspace, model: { input: ['text'] }
  });
  assert.match(highRead.content[0].text, /outside/);
  const bash = await tools.bash.execute('bash', { command: 'echo one && echo two' }, undefined, undefined, { cwd: workspace });
  assert.match(bash.content[0].text, /one[\s\S]*two/);

  runtimeContext = { ...runtimeContext, approval_mode: 'full_access' };
  await tools.write.execute('full-write', { path: outside, content: 'allowed' }, undefined, undefined, { cwd: workspace });
  assert.equal(await fs.readFile(outside, 'utf8'), 'allowed');
});
