const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadPi } = require('../../../apps/runtime/agent-pi/loadPi');
const { createStandardTools } = require('../../../apps/runtime/agent-pi/standardTools');

test('TC-PI-037 standard tools use Pi native file, search and streaming bash implementations', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-standard-workspace-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-standard-external-'));
  t.after(() => Promise.all([workspace, external].map((dir) => fs.rm(dir, { recursive: true, force: true }))));
  const { sdk } = await loadPi();
  const runtimeContext = { reportToolError() {} };
  const tools = Object.fromEntries(createStandardTools({
    sdk,
    cwd: workspace,
    context: () => runtimeContext
  }).map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools), ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);

  await tools.write.execute('write', { path: 'note.txt', content: 'before' }, undefined, undefined, { cwd: workspace });
  await fs.mkdir(path.join(workspace, 'nested'));
  await fs.writeFile(path.join(workspace, 'nested', 'match.txt'), 'search needle', 'utf8');
  const read = await tools.read.execute('read', { path: 'note.txt' }, undefined, undefined, {
    cwd: workspace, model: { input: ['text'] }
  });
  assert.match(read.content[0].text, /before/);
  const listed = await tools.ls.execute('ls', { path: '.' }, undefined, undefined, { cwd: workspace });
  assert.match(listed.content[0].text, /note\.txt/);
  const found = await tools.find.execute('find', { pattern: '**\/match.txt' }, undefined, undefined, { cwd: workspace });
  assert.match(found.content[0].text, /nested\/match\.txt/);
  const searched = await tools.grep.execute('grep', { pattern: 'needle', path: '.' }, undefined, undefined, { cwd: workspace });
  assert.match(searched.content[0].text, /nested\/match\.txt.*needle/);
  await tools.edit.execute('edit', { path: 'note.txt', edits: [{ oldText: 'before', newText: 'after' }] },
    undefined, undefined, { cwd: workspace });
  assert.equal(await fs.readFile(path.join(workspace, 'note.txt'), 'utf8'), 'after');

  const outside = path.join(external, 'outside.txt');
  await fs.writeFile(outside, 'outside', 'utf8');
  const outsideRead = await tools.read.execute('outside-read', { path: outside }, undefined, undefined, {
    cwd: workspace, model: { input: ['text'] }
  });
  assert.match(outsideRead.content[0].text, /outside/);
  const updates = [];
  const toolContext = {
    cwd: workspace,
    sessionManager: { getSessionId: () => 'native-tools', getSessionFile: () => null },
    model: { provider: 'test', id: 'test-model' },
    thinkingLevel: 'off'
  };
  const bash = await tools.bash.execute('bash', { command: 'echo one && echo two' }, undefined,
    (update) => updates.push(update), toolContext);
  assert.match(bash.content[0].text, /one[\s\S]*two/);
  assert.ok(updates.length > 0);
  assert.equal(bash.structuredContent.exit_code, 0);
});
