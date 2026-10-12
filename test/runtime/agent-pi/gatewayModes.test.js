const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createGatewayRunner, attachModelContext } = require('../../../apps/runtime/agent-pi/gatewayAssembly');
const { RuntimeRpcWorker } = require('../../../apps/runtime/rpc/runtimeRpcWorker');

for (const core of ['pi', 'legacy']) {
  test(`TC-PI-021 existing gateway e2e suite passes with AGENT_CORE=${core}`, { timeout: 90000 }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `pi-gateway-${core}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const childEnv = { ...process.env, AGENT_CORE: core, YACHIYO_HOME: root };
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test', 'test/integration/gateway.e2e.test.js'], {
      cwd: path.resolve(__dirname, '../../..'), env: childEnv, stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 0, output);
    assert.match(output, /tests 5/);
  });
}

test('TC-PI-022 core rollback and native worker model_ref forwarding preserve existing context', async () => {
  const legacy = {};
  assert.equal(createGatewayRunner({ core: 'legacy', legacyFactory: () => legacy }), legacy);
  assert.throws(() => createGatewayRunner({ core: 'typo' }), /Invalid AGENT_CORE/);
  let received;
  const worker = new RuntimeRpcWorker({ queue: {}, bus: { publish: () => {} }, runner: { run: async (args) => {
    received = args;
    return { output: 'ok', traceId: 'trace', state: 'DONE', metrics: {} };
  } } });
  assert.equal(attachModelContext(worker), worker);
  await worker.processEnvelope({
    request: { id: 'request', method: 'runtime.run', params: { session_id: 'session', input: 'hello', model_ref: ' mock/other ' } },
    context: { buildRunContext: async () => ({ permission_level: 'low' }) }
  });
  assert.equal(received.modelRef, 'mock/other');
  assert.deepEqual(received.runtimeContext, { permission_level: 'low', model_ref: 'mock/other' });
});
