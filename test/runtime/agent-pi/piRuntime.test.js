const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./fixture');
const { createPiRuntime } = require('../../../apps/runtime/agent-pi/piRuntime');
const { ToolExecutor } = require('../../../apps/runtime/executor/toolExecutor');

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
  assert.equal((await restored.run({ sessionId: 'audio', inputAudio: { audio_ref: 'local.wav', format: 'wav' } })).state, 'DONE');
  assert.equal(f.requests.at(-1).messages.at(-1).content, 'transcribed');
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
