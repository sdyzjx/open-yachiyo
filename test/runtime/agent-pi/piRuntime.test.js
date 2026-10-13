const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./fixture');
const { createPiRuntime } = require('../../../apps/runtime/agent-pi/piRuntime');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { ToolExecutor } = require('../../../apps/runtime/executor/toolExecutor');

async function responsesFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-responses-'));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (requests.length === 1) {
      const item = {
        type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'add', namespace: 'yachiyo',
        arguments: '{"a":20,"b":22}', status: 'completed'
      };
      send({ type: 'response.created', response: { id: 'resp_1' } });
      send({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } });
      send({ type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments });
      send({ type: 'response.function_call_arguments.done', output_index: 0, arguments: item.arguments });
      send({ type: 'response.output_item.done', output_index: 0, item });
      send({ type: 'response.completed', response: {
        id: 'resp_1', status: 'completed', output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
      } });
    } else {
      const item = {
        type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'answer 42', annotations: [] }]
      };
      send({ type: 'response.created', response: { id: 'resp_2' } });
      send({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      send({ type: 'response.output_text.delta', output_index: 0, delta: 'answer 42' });
      send({ type: 'response.output_item.done', output_index: 0, item });
      send({ type: 'response.completed', response: {
        id: 'resp_2', status: 'completed', output: [item],
        usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 }
      } });
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const descriptor = {
    ref: 'chatgpt/gpt-test', provider: 'chatgpt', id: 'gpt-test', api: 'openai-responses',
    api_key: 'oauth-test-token', base_url: `http://127.0.0.1:${server.address().port}/v1`,
    input: ['text'], timeout_ms: 2000, max_retries: 0, chatgpt_plan: true
  };
  const catalog = {
    models: [descriptor], active: descriptor,
    resolve: (ref) => ref === descriptor.ref ? descriptor : null,
    fallbackChain: () => [descriptor]
  };
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor({
    add: {
      input_schema: {
        type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b']
      },
      run: ({ a, b }) => String(a + b)
    }
  });
  const skillConfig = {
    home: { envKey: 'RESPONSES_FIXTURE_HOME', defaultPath: root },
    load: { workspace: false, global: false, extraDirs: [] }, limits: {}, entries: {}
  };
  const runtime = await createPiRuntime({
    bus, executor, modelCatalog: catalog, sessionDir: path.join(root, 'sessions'), cwd: root,
    skillConfigStore: { load: () => skillConfig }, compaction: { enabled: false }
  });
  return { runtime, requests };
}

test('TC-PI-015 real pi loop executes tools and maps legacy events', async (t) => {
  const f = await fixture(t, (body) => body.messages.at(-1).role === 'tool' ? { text: 'answer 42' } : { tool: 'add', args: { a: 20, b: 22 } });
  const events = [];
  const result = await f.runtime.run({ sessionId: 's', input: 'compute', onEvent: (event) => events.push(event) });
  assert.equal(result.state, 'DONE', result.output);
  assert.equal(result.output, 'answer 42');
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].messages.at(-1).content, '42');
  for (const name of ['plan', 'llm.stream.start', 'tool_call.stable', 'tool.call', 'tool_call.requested', 'tool_call.started', 'tool.result', 'tool_call.completed', 'llm.stream.delta', 'llm.stream.end', 'llm.final', 'done']) {
    assert.ok(events.some((event) => event.event === name), name);
  }
  events.forEach((event, i) => {
    assert.equal(event.seq, i + 1);
    assert.equal(event.trace_id, result.traceId);
    assert.equal(event.session_id, 's');
    assert.equal(event.source, 'runtime');
    assert.equal(event.task_id, null);
    assert.equal(event.latency_budget_ms, 1200);
  });
  assert.deepEqual(events.find((e) => e.event === 'llm.stream.delta').payload, { delta: 'answer 42' });
  const names = f.requests[0].tools.map((tool) => tool.function.name);
  for (const name of ['read', 'bash', 'edit', 'write']) assert.ok(!names.includes(name));
});

test('TC-PI-016 real session resume, image input and audio transcription', async (t) => {
  const f = await fixture(t, () => ({ text: 'seen' }), { transcribeAudio: async () => ({ text: 'transcribed' }) });
  assert.equal((await f.runtime.run({ sessionId: 's', input: 'first' })).state, 'DONE');
  const restored = await createPiRuntime(f.deps);
  const result = await restored.run({ sessionId: 's', input: 'second', inputImages: [{ data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgU8Vf4QAAAAASUVORK5CYII=' }] });
  assert.equal(result.state, 'DONE', result.output);
  assert.ok(f.requests.at(-1).messages.some((m) => m.role === 'user' && m.content === 'first'), JSON.stringify(f.requests.at(-1).messages));
  assert.ok(f.requests.at(-1).messages.at(-1).content.some((part) => part.type === 'image_url'));
  assert.equal((await restored.run({
    sessionId: 'audio',
    inputAudio: { audio_ref: 'local.wav', format: 'wav' },
    runtimeContext: { voice_auto_reply_enabled: true, voice_auto_reply_mode: 'policy' }
  })).state, 'DONE');
  assert.equal(f.requests.at(-1).messages.at(-1).content, 'transcribed');
  assert.ok(f.requests.at(-1).messages.some((message) => message.role === 'system'
    && /current user input type is audio/i.test(String(message.content || ''))));
});

test('TC-PI-017 transient fallback and per-run model override use actual provider requests', async (t) => {
  const f = await fixture(t, (body) => body.model === 'model' ? { status: 503 } : { text: 'fallback worked' });
  const result = await f.runtime.run({ sessionId: 's', input: 'hello' });
  assert.equal(result.state, 'DONE', result.output);
  assert.deepEqual(f.requests.map((body) => body.model), ['model', 'fallback']);
  assert.equal(f.requests[1].messages.filter((m) => m.role === 'user').length, 1);
  await f.runtime.run({ sessionId: 'other', input: 'override', modelRef: 'mock/fallback' });
  assert.equal(f.requests.length, 3);
});

test('TC-PI-018 tool denial is visible to pi and does not bypass permissions', async (t) => {
  let executed = false;
  const f = await fixture(t, (body) => body.messages.at(-1).role === 'tool' ? { text: 'denied acknowledged' } : { tool: 'memory_write' }, {
    executor: new ToolExecutor({ memory_write: { run: () => { executed = true; return 'secret'; } } })
  });
  const events = [];
  const result = await f.runtime.run({ sessionId: 'low', input: 'write', permissionLevel: 'low', onEvent: (e) => events.push(e) });
  assert.equal(result.state, 'DONE', result.output);
  assert.equal(executed, false);
  const failed = events.find((e) => e.event === 'tool_call.failed');
  assert.equal(failed.payload.code, 'PERMISSION_DENIED');
  assert.equal(JSON.parse(failed.payload.result).code, 'PERMISSION_DENIED');
  assert.match(f.requests[1].messages.at(-1).content, /not allowed/);
});

test('TC-PI-019 never fall back after tools or on authentication failures', async (t) => {
  const afterTools = await fixture(t, (body) => body.messages.at(-1).role === 'tool' ? { status: 503 } : { tool: 'add', args: { a: 1, b: 1 } });
  const result = await afterTools.runtime.run({ sessionId: 's', input: 'tool then fail' });
  assert.equal(result.state, 'ERROR');
  assert.deepEqual(afterTools.requests.map((body) => body.model), ['model', 'model']);
  const auth = await fixture(t, () => ({ status: 401 }));
  assert.equal((await auth.runtime.run({ sessionId: 's', input: 'auth fail' })).state, 'ERROR');
  assert.equal(auth.requests.length, 1);

  const plan = await fixture(t, () => ({ status: 503, error: 'subscription_sharing_usage_limit_exceeded' }));
  plan.deps.modelCatalog.active.chatgpt_plan = true;
  const planResult = await plan.runtime.run({ sessionId: 'plan', input: 'plan limit' });
  assert.equal(planResult.state, 'ERROR');
  assert.equal(plan.requests.length, 1);
});

test('TC-LLM-035 namespaced Responses tool calls execute locally and replay function_call_output', async (t) => {
  const f = await responsesFixture(t);
  const result = await f.runtime.run({ sessionId: 'responses', input: 'compute' });
  assert.equal(result.state, 'DONE', result.output);
  assert.equal(result.output, 'answer 42');
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].tools[0].type, 'namespace');
  assert.equal(f.requests[0].tools[0].name, 'yachiyo');
  assert.ok(f.requests[0].tools[0].tools.some((tool) => tool.name === 'add'));
  assert.ok(f.requests[1].input.some((item) => item.type === 'function_call'
    && item.call_id === 'call_1' && item.namespace === 'yachiyo' && item.name === 'add'));
  assert.ok(f.requests[1].input.some((item) => item.type === 'function_call_output'
    && item.call_id === 'call_1' && item.output.includes('42')));
});

test('TC-PI-020 endless tools stop at configured step limit', async (t) => {
  const f = await fixture(t, () => ({ tool: 'add', args: { a: 1, b: 1 } }), { maxStep: 2 });
  const result = await f.runtime.run({ sessionId: 's', input: 'loop' });
  assert.equal(result.state, 'ERROR');
  assert.match(result.output, /limit reached/);
  assert.ok(f.requests.length <= 3);
});

test('TC-PI-023 automatic compaction persists a summary and resumes through pi', async (t) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const f = await fixture(t, () => ({ text: 'offline summary or reply', usage: { prompt_tokens: 3800, completion_tokens: 10, total_tokens: 3810 } }), {
    compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 128 }
  });
  f.deps.modelCatalog.models.forEach((model) => { model.context_window = 4096; });
  const events = [];
  assert.equal((await f.runtime.run({ sessionId: 'compact', input: 'first ' + 'context '.repeat(2000), onEvent: (e) => events.push(e) })).state, 'DONE');
  await f.runtime.run({ sessionId: 'compact', input: 'middle ' + 'context '.repeat(1000), onEvent: (e) => events.push(e) });
  const result = await f.runtime.run({ sessionId: 'compact', input: 'continue', onEvent: (e) => events.push(e) });
  assert.equal(result.state, 'DONE', result.output);
  const file = (await fs.readdir(path.join(f.root, 'sessions'))).find((name) => name.endsWith('.jsonl'));
  const entries = (await fs.readFile(path.join(f.root, 'sessions', file), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(entries.some((entry) => entry.type === 'compaction'), JSON.stringify({ events: events.map((e) => [e.event, e.payload.reason]), usage: entries.filter((e) => e.type === 'message').map((e) => e.message.usage), requests: f.requests.length }));
  assert.ok(events.some((event) => event.event === 'pi.compaction_end'));
});

test('TC-PI-025 provider-safe tool names execute and emit their original names without collisions', async (t) => {
  const executed = [];
  const dotted = 'live2d.motion.play';
  const colliding = 'live2d__motion__play';
  const long = `provider.${'tool'.repeat(20)}`;
  const executor = new ToolExecutor({
    [dotted]: { description: 'dotted tool', run: () => { executed.push(dotted); return 'played'; } },
    [colliding]: { description: 'colliding tool', run: () => { executed.push(colliding); return 'wrong'; } },
    [long]: { description: 'long tool', run: () => { executed.push(long); return 'wrong'; } }
  });
  const f = await fixture(t, (body) => {
    if (body.messages.at(-1).role === 'tool') return { text: 'done' };
    return { tool: body.tools.find((tool) => tool.function.description === 'dotted tool').function.name };
  }, { executor });
  const events = [];
  const result = await f.runtime.run({ sessionId: 'safe-tools', input: 'act', onEvent: (event) => events.push(event) });
  assert.equal(result.state, 'DONE', result.output);
  const online = f.requests[0].tools.map((tool) => tool.function.name);
  assert.equal(new Set(online).size, online.length);
  for (const name of online) assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
  const encoded = Object.fromEntries(f.requests[0].tools
    .filter((tool) => ['dotted tool', 'colliding tool', 'long tool'].includes(tool.function.description))
    .map((tool) => [tool.function.description, tool.function.name]));
  assert.equal(new Set(Object.values(encoded)).size, 3);
  assert.equal(encoded['dotted tool'], 'live2d__motion__play');
  assert.deepEqual(executed, [dotted]);
  for (const eventName of ['tool_call.stable', 'tool.call', 'tool_call.requested', 'tool_call.started', 'tool.result', 'tool_call.completed']) {
    assert.equal(events.find((event) => event.event === eventName).payload.name, dotted, eventName);
  }
  assert.deepEqual(events.find((event) => event.event === 'llm.final' && event.payload.decision.type === 'tool').payload.decision.tools[0].name, dotted);
});

test('TC-PI-032 runtime reuses one AgentSession and records effective model refs', async (t) => {
  const f = await fixture(t, (body) => ({ text: `reply:${body.messages.at(-1).content}` }));
  const firstEvents = [];
  const first = await f.runtime.run({ sessionId: 'persistent', input: 'first', modelRef: 'mock/model',
    onEvent: (event) => firstEvents.push(event) });
  const resident = f.runtime.sessionRegistry.peek('persistent');
  const second = await f.runtime.run({ sessionId: 'persistent', input: 'second', modelRef: 'mock/model' });
  assert.equal(f.runtime.sessionRegistry.peek('persistent'), resident);
  assert.equal(first.metrics.requested_model_ref, 'mock/model');
  assert.equal(first.metrics.resolved_model_ref, 'mock/model');
  assert.equal(second.metrics.resolved_model_ref, 'mock/model');
  const plan = firstEvents.find((event) => event.event === 'plan');
  assert.equal(plan.payload.requested_model_ref, 'mock/model');
  assert.equal(plan.payload.resolved_model_ref, 'mock/model');
  assert.equal(plan.payload.runtime_flags.persistent_session, true);
  assert.ok(f.requests[1].messages.some((message) => message.role === 'user' && message.content === 'first'));
  await f.runtime.dispose();
  assert.equal(f.runtime.sessionRegistry.size, 0);
});

test('TC-PI-033 real pi loop executes independent read tools in parallel', async (t) => {
  const starts = {};
  const ends = {};
  const executor = new ToolExecutor({
    inspect_a: { side_effect_level: 'read', run: async () => {
      starts.a = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 90));
      ends.a = Date.now();
      return 'A';
    } },
    inspect_b: { side_effect_level: 'none', run: async () => {
      starts.b = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 90));
      ends.b = Date.now();
      return 'B';
    } }
  });
  const f = await fixture(t, (body) => body.messages.at(-1).role === 'tool'
    ? { text: 'parallel complete' }
    : { tools: [{ name: 'inspect_a' }, { name: 'inspect_b' }] }, { executor });
  const events = [];
  const result = await f.runtime.run({ sessionId: 'parallel-tools', input: 'inspect', onEvent: (event) => events.push(event) });
  assert.equal(result.state, 'DONE', result.output);
  assert.equal(result.output, 'parallel complete');
  assert.equal(Math.abs(starts.a - starts.b) < 50, true, JSON.stringify({ starts, ends }));
  assert.equal(events.filter((event) => event.event === 'tool_call.completed').length, 2);
  const plan = events.find((event) => event.event === 'plan');
  assert.equal(plan.payload.runtime_flags.tool_async_mode, 'parallel');
  assert.equal(plan.payload.runtime_flags.max_parallel_tools, null);
});
