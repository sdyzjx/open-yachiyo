const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { ToolExecutor } = require('../../../apps/runtime/executor/toolExecutor');
const { createPiRuntime } = require('../../../apps/runtime/agent-pi/piRuntime');

async function fixture(t, respond, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-runtime-'));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const reply = await respond(body, requests.length);
    if (reply.status) {
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: reply.error || 'offline failure' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const write = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }], ...(finish_reason && reply.usage ? { usage: reply.usage } : {}) })}\n\n`);
    write({ role: 'assistant' });
    const toolCalls = reply.tools || (reply.tool ? [{ name: reply.tool, args: reply.args || {} }] : []);
    if (toolCalls.length) write({ tool_calls: toolCalls.map((tool, index) => ({
      index, id: `call_${requests.length}_${index}`, type: 'function',
      function: { name: tool.name, arguments: JSON.stringify(tool.args || {}) }
    })) });
    if (reply.text) write({ content: reply.text });
    write({}, toolCalls.length ? 'tool_calls' : 'stop');
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const descriptor = { ref: 'mock/model', provider: 'mock', id: 'model', api: 'openai-completions', api_key: 'offline-test',
    base_url: `http://127.0.0.1:${server.address().port}`, input: ['text', 'image'], timeout_ms: 2000, max_retries: 0 };
  const fallback = { ...descriptor, ref: 'mock/fallback', id: 'fallback' };
  const catalog = { models: [descriptor, fallback], active: descriptor, resolve: (ref) => [descriptor, fallback].find((model) => model.ref === ref), fallbackChain: () => [descriptor, fallback] };
  const bus = new RuntimeEventBus();
  const busEvents = [];
  bus.subscribe('*', (payload, meta) => busEvents.push({ payload, meta }));
  const config = { home: { envKey: 'WS1_UNUSED_FIXTURE_HOME', defaultPath: root }, load: { workspace: false, global: false, extraDirs: [] }, limits: {}, entries: {} };
  const deps = { bus, executor: new ToolExecutor({ add: { input_schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }, run: ({ a, b }) => String(a + b) } }),
    modelCatalog: catalog, sessionDir: path.join(root, 'sessions'), cwd: root, compaction: { enabled: false },
    skillConfigStore: { load: () => config }, ...overrides };
  return { runtime: await createPiRuntime(deps), deps, requests, root, busEvents };
}
module.exports = { fixture };
