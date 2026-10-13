const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { fixture } = require('./fixture');
const { createPiRuntime } = require('../../../apps/runtime/agent-pi/piRuntime');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { ToolExecutor } = require('../../../apps/runtime/executor/toolExecutor');
const { pcmToWav } = require('../../../apps/gateway/deviceHub/audioInput');

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
  assert.deepEqual(events.find((e) => e.event === 'llm.stream.delta').payload, { delta: 'answer 42', ui_hidden: true });
  const names = f.requests[0].tools.map((tool) => tool.function.name);
  for (const name of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']) assert.ok(names.includes(name), name);
  assert.ok(names.includes('ui__chat__post'));
});

test('TC-PI-046 a tool-free action promise gets one internal Pi recovery turn', async (t) => {
  const f = await fixture(t, (body, requestNumber) => {
    if (requestNumber === 1) return { text: '主人，我这就帮您查看电脑网卡的当前状态。' };
    if (body.messages.at(-1).role === 'tool') return { text: '网卡状态正常，地址是 192.168.20.212。' };
    return { tool: 'add', args: { a: 20, b: 22 } };
  });
  const events = [];
  const result = await f.runtime.run({
    sessionId: 'recover-action-promise', input: '查看电脑网卡状态',
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.state, 'DONE', result.output);
  assert.equal(result.output, '网卡状态正常，地址是 192.168.20.212。');
  assert.equal(f.requests.length, 3);
  assert.match(f.requests[1].messages.at(-1).content, /runtime policy correction/);
  assert.ok(events.some((event) => event.event === 'agent.action.recovery'));
  assert.equal(events.filter((event) => event.event === 'tool_call.completed').length, 1);
});

test('TC-PI-040 TC-PI-042 Qwen Realtime keeps one provider connection across a Pi tool continuation', async (t) => {
  const waitFor = async (predicate) => {
    for (let index = 0; index < 100; index += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for realtime provider request');
  };
  class FakeWs extends EventEmitter {
    static instances = [];
    constructor() { super(); this.sent = []; FakeWs.instances.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() {}
  }
  const descriptor = {
    ref: 'qwen/realtime', provider: 'qwen', id: 'qwen3.8-omni-flash-realtime',
    api: 'openai-completions', transport: 'realtime', input: ['text', 'audio'], output: ['text', 'audio'],
    api_key: 'secret', headers: {}, base_url: 'https://wsid.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    realtime_output: 'native', realtime_voice: 'yachiyo'
  };
  const catalog = {
    models: [descriptor], active: descriptor,
    resolve: (ref) => ref === descriptor.ref ? descriptor : null,
    fallbackChain: () => [descriptor]
  };
  const f = await fixture(t, () => ({ text: 'unused' }), { modelCatalog: catalog, realtimeWebSocket: FakeWs });
  const audioRef = path.join(f.root, 'voice.wav');
  await fs.writeFile(audioRef, pcmToWav(Buffer.alloc(3200, 2)));
  const running = f.runtime.run({
    sessionId: 'device-phone',
    input: '',
    inputAudio: { audio_ref: audioRef, format: 'wav', stream_id: 'voice-1' },
    runtimeContext: { direct_audio_to_model: true },
    modelRef: descriptor.ref
  });
  await Promise.race([
    waitFor(() => FakeWs.instances[0]),
    running.then((result) => { throw new Error(`Realtime run ended before transport opened: ${JSON.stringify(result)}`); })
  ]);
  const first = FakeWs.instances[0];
  first.emit('message', JSON.stringify({ type: 'session.created' }));
  first.emit('message', JSON.stringify({ type: 'session.updated' }));
  const directAudio = first.sent.find((event) => event.type === 'input_audio_buffer.append');
  assert.ok(directAudio, JSON.stringify(first.sent));
  assert.equal(Buffer.from(directAudio.audio, 'base64').length, 3200);
  assert.equal(first.sent.filter((event) => event.type === 'input_audio_buffer.commit').length, 1);
  assert.equal(first.sent.some((event) => JSON.stringify(event).includes('实时语音输入')), false);
  first.emit('message', JSON.stringify({
    type: 'conversation.item.input_audio_transcription.completed', transcript: '算一下', item_id: 'voice-1'
  }));
  first.emit('message', JSON.stringify({
    type: 'response.function_call_arguments.done', call_id: 'call-1', name: 'add', arguments: '{"a":20,"b":22}'
  }));
  first.emit('message', JSON.stringify({ type: 'response.done' }));
  await waitFor(() => first.sent.some((event) => event.item?.type === 'function_call_output'));
  assert.equal(FakeWs.instances.length, 1);
  assert.ok(first.sent.some((event) => event.item?.type === 'function_call_output' && event.item.output.includes('42')));
  assert.equal(first.sent.filter((event) => event.type === 'input_audio_buffer.append').length, 1);
  assert.equal(first.sent.filter((event) => event.type === 'response.create').length, 2);
  first.emit('message', JSON.stringify({ type: 'response.text.delta', delta: '答案是 42' }));
  first.emit('message', JSON.stringify({ type: 'response.done' }));
  const result = await running;
  assert.equal(result.state, 'DONE', result.output);
  assert.equal(result.output, '答案是 42');
  assert.equal(f.requests.length, 0);
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

test('TC-PI-044 Pi extension blocks a dangerous native bash call before execution', async (t) => {
  const f = await fixture(t, (body) => body.messages.at(-1).role === 'tool'
    ? { text: 'policy acknowledged' }
    : { tool: 'bash', args: { command: 'sudo whoami' } });
  const events = [];
  const result = await f.runtime.run({
    sessionId: 'pi-policy',
    input: 'run dangerous command',
    permissionLevel: 'high',
    approvalMode: 'full_access',
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.state, 'DONE', result.output);
  const failed = events.find((event) => event.event === 'tool_call.failed');
  assert.ok(failed, JSON.stringify(events));
  assert.match(failed.payload.result, /blocked by Pi command policy/);
  assert.match(f.requests[1].messages.at(-1).content, /blocked by Pi command policy/);
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

test('TC-PI-034 one persistent pi session assigns queued follow-up output to each request', async (t) => {
  const f = await fixture(t, async (body, requestNumber) => {
    if (requestNumber === 1) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { text: 'first answer' };
    }
    const latestUser = [...body.messages].reverse().find((message) => message.role === 'user');
    return { text: latestUser?.content === 'second' ? 'second answer' : `unexpected:${latestUser?.content}` };
  });
  const firstEvents = [];
  const secondEvents = [];
  const firstRun = f.runtime.run({ sessionId: 'native-queue', input: 'first', onEvent: (event) => firstEvents.push(event) });
  while (f.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  const secondRun = f.runtime.run({ sessionId: 'native-queue', input: 'second', deliveryMode: 'followUp',
    onEvent: (event) => secondEvents.push(event) });
  const [first, second] = await Promise.all([firstRun, secondRun]);
  assert.equal(first.output, 'first answer');
  assert.equal(second.output, 'second answer');
  assert.notEqual(first.traceId, second.traceId);
  assert.equal(firstEvents.filter((event) => event.event === 'done').length, 1);
  assert.equal(secondEvents.filter((event) => event.event === 'done').length, 1);
  assert.equal(secondEvents.some((event) => event.event === 'llm.stream.delta'
    && event.payload.delta === 'first answer'), false);
  assert.equal(f.runtime.sessionRegistry.peek('native-queue').session.isIdle, true);
});

test('TC-PI-034 native steering supersedes an unfinished tool turn before its next model call', async (t) => {
  let releaseTool;
  let toolStarted;
  const started = new Promise((resolve) => { toolStarted = resolve; });
  const toolGate = new Promise((resolve) => { releaseTool = resolve; });
  const executor = new ToolExecutor({
    hold: { side_effect_level: 'read', run: async () => {
      toolStarted();
      await toolGate;
      return 'held';
    } }
  });
  const f = await fixture(t, (body, requestNumber) => requestNumber === 1
    ? { tool: 'hold' }
    : { text: [...body.messages].reverse().find((message) => message.role === 'user')?.content === 'second voice'
      ? 'steered answer' : 'old answer' }, { executor });
  const firstRun = f.runtime.run({ sessionId: 'native-steer', input: 'first task' });
  await started;
  const entry = f.runtime.sessionRegistry.peek('native-steer');
  Object.defineProperty(entry.session, 'isStreaming', { configurable: true, get: () => false });
  const secondRun = f.runtime.run({ sessionId: 'native-steer', input: 'second voice', deliveryMode: 'steer' });
  releaseTool();
  const [first, second] = await Promise.all([firstRun, secondRun]);
  assert.equal(first.state, 'ABORTED');
  assert.match(first.output, /steering/);
  assert.equal(second.state, 'DONE');
  assert.equal(second.output, 'steered answer');
  assert.equal(f.requests.length, 2);
});

test('TC-PI-036 high-priority bus events enter the resident AgentSession through steering', async (t) => {
  const f = await fixture(t, (body) => {
    const latest = body.messages.at(-1);
    if (latest.role === 'tool') return { text: 'subscribed' };
    if (String(latest.content).includes('Topic: device.phone.alert')) return { text: 'event handled' };
    const subscribe = body.tools.find((tool) => tool.function.description.includes('Subscribe this agent session'));
    return { tool: subscribe.function.name, args: {
      pattern: 'device.phone.**', delivery: 'steer', priority: 'high', ttl_ms: 60000
    } };
  });
  const initial = await f.runtime.run({ sessionId: 'bus-steer', input: 'watch phone alerts' });
  assert.equal(initial.output, 'subscribed');
  const final = f.deps.bus.waitFor('runtime.final', (payload) => payload.session_id === 'bus-steer'
    && payload.output === 'event handled', 2000);
  f.deps.bus.publish('device.phone.alert', { message: 'battery hot', __from_device: 'phone' });
  assert.equal((await final).state, 'DONE');
  assert.ok(f.requests.at(-1).messages.some((message) => message.role === 'user'
    && String(message.content).includes('battery hot')));
});

test('TC-PI-037 Pi assembles AGENTS context and Skills once while Apple Music remains a skill', async (t) => {
  const f = await fixture(t, () => ({ text: 'resources loaded' }), {
    executor: new ToolExecutor({
      'shell.exec': { run: () => 'backend only' },
      'workspace.write_file': { run: () => 'backend only' }
    })
  });
  await fs.writeFile(path.join(f.root, 'AGENTS.md'), '# Test context\nFollow resident session rules.');
  const skillDir = path.join(f.root, 'skills', 'apple-events-music');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: apple-events-music',
    'description: Control Apple Music through a script.',
    '---',
    'Read this file and run scripts/music_control.sh with bash.'
  ].join('\n'));
  f.deps.skillConfigStore.load = () => ({
    home: { envKey: 'PI_UNUSED_RESOURCE_HOME', defaultPath: f.root },
    load: { workspace: true, global: false, extraDirs: [] },
    limits: {}, entries: {}
  });
  const result = await f.runtime.run({ sessionId: 'resources', input: 'play music' });
  assert.equal(result.state, 'DONE');
  const system = f.requests[0].messages.find((message) => message.role === 'system').content;
  assert.match(system, /Follow resident session rules/);
  assert.match(system, /apple-events-music/);
  assert.equal((system.match(/Control Apple Music through a script\./g) || []).length, 1);
  const names = f.requests[0].tools.map((tool) => tool.function.name);
  assert.equal(names.some((name) => /apple.*music/i.test(name)), false);
  for (const name of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']) assert.ok(names.includes(name), name);
  assert.equal(names.includes('shell__exec'), false);
  assert.equal(names.includes('workspace__write_file'), false);
});
