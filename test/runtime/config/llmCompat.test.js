const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OpenAIReasoner } = require('../../../apps/runtime/llm/openaiReasoner');
const { ProviderConfigStore } = require('../../../apps/runtime/config/providerConfigStore');
const { LlmProviderManager } = require('../../../apps/runtime/config/llmProviderManager');
const { getFreePort } = require('../../helpers/net');

async function startMock(handler) {
  const port = await getFreePort();
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      handler(req, res, parsed);
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, port, requests, base: `http://127.0.0.1:${port}` };
}

const okJson = (content) => (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
};

function managerFor(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-compat-'));
  const configPath = path.join(dir, 'providers.yaml');
  fs.writeFileSync(configPath, yaml, 'utf8');
  return new LlmProviderManager({ store: new ProviderConfigStore({ configPath }) });
}

test('headers, extra_body, max_tokens_field and developer role compat shape the request', async () => {
  const m = await startMock(okJson('hi'));
  try {
    const reasoner = new OpenAIReasoner({
      apiKey: 'k', baseUrl: m.base, model: 'x',
      headers: { 'X-Org': 'acme' },
      extraBody: { top_k: 5, thinking: { type: 'enabled' } },
      compat: { max_tokens_field: 'max_completion_tokens', supports_developer_role: false },
      maxTokens: 777
    });
    await reasoner.decide({ messages: [{ role: 'developer', content: 'd' }, { role: 'user', content: 'u' }], tools: [] });
    const r = m.requests[0];
    assert.equal(r.headers['x-org'], 'acme');
    assert.equal(r.headers.authorization, 'Bearer k');
    assert.equal(r.body.max_completion_tokens, 777);
    assert.equal(r.body.max_tokens, undefined);
    assert.equal(r.body.top_k, 5);
    assert.deepEqual(r.body.thinking, { type: 'enabled' });
    assert.equal(r.body.messages[0].role, 'system');
    assert.equal(r.body.temperature, 0.2);
  } finally { m.server.close(); }
});

test('no api key required for local providers; reasoning models omit default temperature', async () => {
  const m = await startMock(okJson('hi'));
  try {
    const reasoner = new OpenAIReasoner({ apiKey: '', requireApiKey: false, baseUrl: m.base, model: 'x', reasoning: true });
    await reasoner.decide({ messages: [{ role: 'user', content: 'u' }], tools: [] });
    assert.equal(m.requests[0].headers.authorization, undefined);
    assert.equal('temperature' in m.requests[0].body, false);
  } finally { m.server.close(); }
});

test('deepseek-reasoner stream: reasoning_content is collected, not emitted, and stripped from history', async () => {
  const m = await startMock((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    send({ reasoning_content: 'think ' });
    send({ reasoning_content: 'more' });
    send({ content: 'Answer' });
    send({ content: '!' });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const reasoner = new OpenAIReasoner({
      apiKey: 'k', baseUrl: m.base, model: 'deepseek-reasoner', reasoning: true,
      compat: { reasoning_content_field: 'reasoning_content', strip_reasoning_in_history: true }
    });
    const deltas = [];
    const reasoning = [];
    const decision = await reasoner.decideStream({
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'old', reasoning_content: 'old thoughts' },
        { role: 'user', content: 'q2' }
      ],
      tools: [],
      onDelta: (d) => deltas.push(d),
      onReasoningDelta: (d) => reasoning.push(d)
    });
    assert.equal(decision.output, 'Answer!');
    assert.deepEqual(deltas, ['Answer', '!']);
    assert.equal(reasoning.join(''), 'think more');
    assert.equal(decision.reasoning_content, 'think more');
    assert.equal('reasoning_content' in decision.assistantMessage, false);
    assert.equal('reasoning_content' in m.requests[0].body.messages[1], false);
  } finally { m.server.close(); }
});

test('strip_reasoning_in_history=false keeps reasoning on the assistant message', async () => {
  const m = await startMock((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok', reasoning_content: 'r' } }] }));
  });
  try {
    const reasoner = new OpenAIReasoner({
      apiKey: 'k', baseUrl: m.base, model: 'x', compat: { strip_reasoning_in_history: false }
    });
    const decision = await reasoner.decide({
      messages: [{ role: 'assistant', content: 'a', reasoning_content: 'keep' }, { role: 'user', content: 'u' }],
      tools: []
    });
    assert.equal(decision.output, 'ok');
    assert.equal(decision.assistantMessage.reasoning_content, 'r');
    assert.equal(m.requests[0].body.messages[0].reasoning_content, 'keep');
  } finally { m.server.close(); }
});

test('fallback chain: first model 503 -> second model succeeds and llm.fallback info is reported', async () => {
  const a = await startMock((req, res) => { res.writeHead(503).end('down'); });
  const b = await startMock(okJson('from-b'));
  try {
    const manager = managerFor(`
version: 2
active_model: pa/ma
fallback_models: [pb/mb]
providers:
  pa: { type: openai_compatible, base_url: ${a.base}, api_key: ka, max_retries: 0, model: ma }
  pb: { type: openai_compatible, base_url: ${b.base}, api_key: kb, max_retries: 0, model: mb }
`);
    const events = [];
    const reasoner = manager.getReasoner({ onFallback: (e) => events.push(e) });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'u' }], tools: [] });
    assert.equal(decision.output, 'from-b');
    assert.equal(a.requests.length, 1);
    assert.equal(b.requests[0].body.model, 'mb');
    assert.equal(events.length, 1);
    assert.equal(events[0].from, 'pa/ma');
    assert.equal(events[0].to, 'pb/mb');
    assert.equal(events[0].status, 503);
  } finally { a.server.close(); b.server.close(); }
});

test('fallback does not trigger for non-retriable errors (401)', async () => {
  const a = await startMock((req, res) => { res.writeHead(401).end('bad key'); });
  const b = await startMock(okJson('from-b'));
  try {
    const manager = managerFor(`
active_model: pa/ma
fallback_models: [pb/mb]
providers:
  pa: { type: openai_compatible, base_url: ${a.base}, api_key: ka, max_retries: 0, model: ma }
  pb: { type: openai_compatible, base_url: ${b.base}, api_key: kb, max_retries: 0, model: mb }
`);
    const reasoner = manager.getReasoner();
    await assert.rejects(reasoner.decide({ messages: [], tools: [] }), /401/);
    assert.equal(b.requests.length, 0);
  } finally { a.server.close(); b.server.close(); }
});

test('model_ref override picks that model; unknown ref throws; v2 provider options reach the request', async () => {
  const a = await startMock(okJson('a'));
  const b = await startMock(okJson('b'));
  try {
    const manager = managerFor(`
active_model: pa/ma
providers:
  pa: { type: openai_compatible, base_url: ${a.base}, api_key: ka, models: [{ id: ma }] }
  pb:
    type: openai_compatible
    base_url: ${b.base}
    api_key: kb
    headers: { X-Test: '1' }
    extra_body: { custom: true }
    models: [{ id: mb, max_tokens: 99 }]
    compat: { max_tokens_field: max_completion_tokens }
`);
    const out = await manager.getReasoner({ modelRef: 'pb/mb' }).decide({ messages: [{ role: 'user', content: 'u' }], tools: [] });
    assert.equal(out.output, 'b');
    assert.equal(b.requests[0].headers['x-test'], '1');
    assert.equal(b.requests[0].body.custom, true);
    assert.equal(b.requests[0].body.max_completion_tokens, 99);
    assert.equal(a.requests.length, 0);
    assert.throws(() => manager.getReasoner({ modelRef: 'pb/zzz' }), /Unknown model_ref/);
  } finally { a.server.close(); b.server.close(); }
});

test('ToolLoopRunner forwards modelRef to getReasoner and publishes llm.fallback on the bus', async () => {
  const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
  const { ToolLoopRunner } = require('../../../apps/runtime/loop/toolLoopRunner');
  const bus = new RuntimeEventBus();
  const seen = [];
  bus.subscribe('llm.fallback', (e) => seen.push(e));
  let received = null;
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: (opts) => {
      received = opts;
      opts.onFallback({ from: 'a/x', to: 'b/y', error: 'boom', status: 503 });
      return { async decide() { return { type: 'final', output: 'ok' }; } };
    },
    listTools: () => []
  });
  const result = await runner.run({ sessionId: 's1', input: 'hi', modelRef: 'a/x', onEvent: () => {} });
  assert.equal(result.output, 'ok');
  assert.equal(received.modelRef, 'a/x');
  assert.equal(received.sessionId, 's1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].data?.to ?? seen[0].to, 'b/y');
});

test('RuntimeRpcWorker: params.model_ref wins over session settings model_ref; both reach runner as model_ref', async () => {
  const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
  const { RpcInputQueue } = require('../../../apps/runtime/queue/rpcInputQueue');
  const { RuntimeRpcWorker } = require('../../../apps/runtime/rpc/runtimeRpcWorker');
  const seen = [];
  const runner = {
    async run({ sessionId, modelRef, runtimeContext }) {
      seen.push({ modelRef, ctx: runtimeContext.model_ref });
      return { output: 'ok', traceId: 't', state: 'DONE', sessionId, metrics: {} };
    }
  };
  const queue = new RpcInputQueue();
  const worker = new RuntimeRpcWorker({ queue, runner, bus: new RuntimeEventBus() });
  worker.start();
  try {
    const submit = (id, params) => queue.submit(
      { jsonrpc: '2.0', id, method: 'runtime.run', params: { input: 'hi', session_id: 's', ...params } },
      {
        send: () => {}, sendEvent: () => {},
        buildPromptMessages: async () => [],
        buildRunContext: async () => ({ model_ref: 'session/model' })
      }
    );
    await submit('a', { model_ref: 'param/model' });
    await submit('b', {});
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(seen, [
      { modelRef: 'param/model', ctx: 'param/model' },
      { modelRef: 'session/model', ctx: 'session/model' }
    ]);
  } finally { worker.stop?.(); }
});
