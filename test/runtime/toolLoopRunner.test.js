const test = require('node:test');
const assert = require('node:assert/strict');

const { RuntimeEventBus } = require('../../apps/runtime/bus/eventBus');
const { ToolExecutor } = require('../../apps/runtime/executor/toolExecutor');
const localTools = require('../../apps/runtime/executor/localTools');
const { ToolCallDispatcher } = require('../../apps/runtime/orchestrator/toolCallDispatcher');
const { ToolLoopRunner } = require('../../apps/runtime/loop/toolLoopRunner');

test('ToolLoopRunner performs tool call through event bus and completes', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let decideCount = 0;
  const reasoner = {
    async decide() {
      decideCount += 1;
      if (decideCount === 1) {
        return {
          type: 'tool',
          tool: { call_id: 'call-1', name: 'add', args: { a: 20, b: 22 } }
        };
      }

      return {
        type: 'final',
        output: 'done from test reasoner'
      };
    }
  };

  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000
  });

  const events = [];
  const result = await runner.run({
    sessionId: 's1',
    input: 'add numbers',
    onEvent: (event) => events.push(event.event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done from test reasoner');
  assert.ok(events.includes('tool.call'));
  assert.ok(events.includes('tool.result'));
  assert.ok(events.includes('done'));

  dispatcher.stop();
});

test('ToolLoopRunner emits seq/runtime flags and returns metrics', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  const reasoner = {
    async decide() {
      return {
        type: 'final',
        output: 'done-with-metrics'
      };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 2,
    toolResultTimeoutMs: 2000,
    runtimeStreamingEnabled: true,
    toolAsyncMode: 'parallel',
    toolEarlyDispatch: true
  });

  const result = await runner.run({
    sessionId: 's-metrics',
    input: 'ping',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done-with-metrics');
  assert.ok(result.metrics);
  assert.equal(Number.isFinite(result.metrics.final_ms), true);
  const plan = events.find((evt) => evt.event === 'plan');
  assert.ok(plan);
  assert.deepEqual(plan.payload.runtime_flags, {
    streaming_enabled: true,
    tool_async_mode: 'parallel',
    tool_early_dispatch: true
  });
  for (let i = 1; i < events.length; i += 1) {
    assert.equal(events[i].seq, events[i - 1].seq + 1);
  }

  dispatcher.stop();
});

test('ToolLoopRunner marks first_tool_result_ms when tool result arrives', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let decideCount = 0;
  const reasoner = {
    async decide() {
      decideCount += 1;
      if (decideCount === 1) {
        return {
          type: 'tool',
          tool: { call_id: 'call-ms-1', name: 'add', args: { a: 1, b: 2 } }
        };
      }
      return { type: 'final', output: 'ok-tool-ms' };
    }
  };

  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000
  });

  const result = await runner.run({
    sessionId: 's-tool-metrics',
    input: 'add now'
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-tool-ms');
  assert.ok(result.metrics);
  assert.equal(Number.isFinite(result.metrics.first_tool_result_ms), true);

  dispatcher.stop();
});

test('ToolLoopRunner emits llm.stream events when streaming decision is enabled', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  const reasoner = {
    async decideStream({ onDelta }) {
      onDelta?.('你好');
      onDelta?.('，世界');
      return {
        type: 'final',
        output: '你好，世界'
      };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 2,
    toolResultTimeoutMs: 2000,
    runtimeStreamingEnabled: true
  });

  const result = await runner.run({
    sessionId: 's-stream',
    input: 'stream hello',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, '你好，世界');
  assert.ok(events.some((evt) => evt.event === 'llm.stream.start'));
  assert.ok(events.some((evt) => evt.event === 'llm.stream.end'));
  const deltas = events.filter((evt) => evt.event === 'llm.stream.delta').map((evt) => evt.payload.delta);
  assert.deepEqual(deltas, ['你好', '，世界']);
  const finalEvent = events.find((evt) => evt.event === 'llm.final');
  assert.equal(finalEvent.payload.streamed, true);

  dispatcher.stop();
});

test('ToolLoopRunner emits tool_call delta/stable events in streaming mode', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  const reasoner = {
    async decideStream({ onDelta, onToolCallDelta, onToolCallStable }) {
      onDelta?.('处理中');
      onToolCallDelta?.({
        index: 0,
        call_id: 'call-stream-tool-1',
        name: 'add',
        args_raw: '{"a":1'
      });
      onToolCallStable?.({
        index: 0,
        call_id: 'call-stream-tool-1',
        name: 'add',
        args_raw: '{"a":1,"b":2}',
        args: { a: 1, b: 2 }
      });
      return {
        type: 'final',
        output: 'stream-tool-events-ok'
      };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 2,
    toolResultTimeoutMs: 2000,
    runtimeStreamingEnabled: true
  });

  const result = await runner.run({
    sessionId: 's-stream-tool-events',
    input: 'stream tool event',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'stream-tool-events-ok');
  assert.ok(events.some((evt) => evt.event === 'tool_call.delta'));
  assert.ok(events.some((evt) => evt.event === 'tool_call.stable'));
  assert.equal(Number.isFinite(result.metrics.first_tool_stable_ms), true);

  dispatcher.stop();
});

test('ToolLoopRunner counts parse error once when callback and stream_meta both carry same error', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  const parseErrorPayload = {
    index: 0,
    call_id: 'call-parse-1',
    name: 'broken',
    args_raw: '{"x":1',
    parse_reason: 'Unexpected end of JSON input'
  };

  const reasoner = {
    async decideStream({ onToolCallParseError }) {
      onToolCallParseError?.(parseErrorPayload);
      return {
        type: 'final',
        output: 'done-with-parse-error',
        stream_meta: {
          tool_parse_errors: 1,
          parse_errors: [parseErrorPayload]
        }
      };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 2,
    toolResultTimeoutMs: 2000,
    runtimeStreamingEnabled: true
  });

  const result = await runner.run({
    sessionId: 's-stream-parse-error',
    input: 'stream parse error',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done-with-parse-error');
  assert.equal(result.metrics.tool_parse_error, 1);
  const parseErrorEvents = events.filter((evt) => evt.event === 'tool_call.parse_error');
  assert.equal(parseErrorEvents.length, 1);

  dispatcher.stop();
});



test('ToolLoopRunner executes multiple tool calls in one step serially', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let decideCount = 0;
  const reasoner = {
    async decide() {
      decideCount += 1;
      if (decideCount === 1) {
        return {
          type: 'tool',
          tools: [
            { call_id: 'call-a', name: 'add', args: { a: 1, b: 2 } },
            { call_id: 'call-b', name: 'echo', args: { text: 'hello' } }
          ]
        };
      }

      return { type: 'final', output: 'done-multi' };
    }
  };

  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000
  });

  const events = [];
  const result = await runner.run({
    sessionId: 's-multi',
    input: 'do two calls',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done-multi');
  const toolCalls = events.filter((e) => e.event === 'tool.call');
  const toolResults = events.filter((e) => e.event === 'tool.result');
  assert.equal(toolCalls.length, 2);
  assert.equal(toolResults.length, 2);
  assert.equal(toolCalls[0].payload.name, 'add');
  assert.equal(toolCalls[1].payload.name, 'echo');

  dispatcher.stop();
});
test('ToolLoopRunner returns error when tool dispatch fails', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide() {
        return {
          type: 'tool',
          tool: { call_id: 'missing-1', name: 'missing_tool', args: {} }
        };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 2000
  });

  const result = await runner.run({ sessionId: 's2', input: 'x' });
  assert.equal(result.state, 'ERROR');
  assert.match(result.output, /工具执行失败/);

  dispatcher.stop();
});

test('ToolLoopRunner injects seedMessages into reasoner prompt', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let seenMessages = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        seenMessages = messages;
        return { type: 'final', output: 'ok' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 2,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({
    sessionId: 's3',
    input: 'current question',
    seedMessages: [
      { role: 'system', content: 'memory summary: likes short output' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' }
    ]
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok');
  assert.equal(seenMessages[1].content, 'memory summary: likes short output');
  assert.equal(seenMessages[2].content, 'old question');
  assert.equal(seenMessages[3].content, 'old answer');
  assert.equal(seenMessages[4].content, 'current question');

  dispatcher.stop();
});

test('ToolLoopRunner builds multimodal user message from inputImages', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let seenMessages = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        seenMessages = messages;
        return { type: 'final', output: 'ok-image' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgU8Vf4QAAAAASUVORK5CYII=';
  const result = await runner.run({
    sessionId: 's-image',
    input: 'describe this image',
    inputImages: [{ data_url: sampleDataUrl, name: 'tiny.png', mime_type: 'image/png', size_bytes: 67 }]
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-image');
  const userMessage = seenMessages[seenMessages.length - 1];
  assert.equal(userMessage.role, 'user');
  assert.equal(Array.isArray(userMessage.content), true);
  assert.equal(userMessage.content[0].type, 'text');
  assert.equal(userMessage.content[0].text, 'describe this image');
  assert.equal(userMessage.content[1].type, 'image_url');
  assert.equal(userMessage.content[1].image_url.url, sampleDataUrl);

  dispatcher.stop();
});

test('ToolLoopRunner passes runtimeContext workspace and permission to tool execution', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor({
    inspect_context: {
      type: 'local',
      description: 'Inspect runtime context',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async (_, context) => JSON.stringify({
        workspace_root: context.workspaceRoot,
        permission_level: context.permission_level
      })
    }
  });
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let decideCount = 0;
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        decideCount += 1;
        if (decideCount === 1) {
          return {
            type: 'tool',
            tool: { call_id: 'ctx-1', name: 'inspect_context', args: {} }
          };
        }

        return {
          type: 'final',
          output: String(messages[messages.length - 1]?.content || '')
        };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 3,
    toolResultTimeoutMs: 1000
  });

  const result = await runner.run({
    sessionId: 'ctx-session',
    input: 'inspect',
    runtimeContext: {
      workspace_root: '/tmp/fake-workspace-root',
      permission_level: 'high'
    }
  });

  assert.equal(result.state, 'DONE');
  assert.match(result.output, /"workspace_root":"\/tmp\/fake-workspace-root"/);
  assert.match(result.output, /"permission_level":"high"/);

  dispatcher.stop();
});

test('ToolLoopRunner injects skills system prompt when resolver is provided', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let seenMessages = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        seenMessages = messages;
        return { type: 'final', output: 'ok-skills' };
      }
    }),
    listTools: () => executor.listTools(),
    resolveSkillsContext: async () => ({
      prompt: '<available_skills>\\n  <skill><name>shell</name></skill>\\n</available_skills>',
      selected: ['shell'],
      clippedBy: null
    }),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({ sessionId: 's4', input: 'do x' });
  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-skills');
  assert.match(seenMessages[1].content, /available_skills/);

  dispatcher.stop();
});

test('ToolLoopRunner injects persona system prompt when resolver is provided', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let seenMessages = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        seenMessages = messages;
        return { type: 'final', output: 'ok-persona' };
      }
    }),
    listTools: () => executor.listTools(),
    resolvePersonaContext: async () => ({ prompt: 'Persona Core: test', mode: 'hybrid' }),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({ sessionId: 's5', input: 'hello' });
  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-persona');
  assert.match(seenMessages[1].content, /Persona Core/);

  dispatcher.stop();
});

test('ToolLoopRunner injects persona tool hint on persona-modification keywords', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let seenMessages = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        seenMessages = messages;
        return { type: 'final', output: 'ok-hint' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({ sessionId: 's6', input: '请帮我修改人格称呼，叫我小主人' });
  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-hint');
  assert.equal(seenMessages.some((m) => /persona\.update_profile/.test(String(m.content || ''))), true);

  dispatcher.stop();
});

test('ToolLoopRunner injects live2d action planning guidance into system prompt', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let seenMessages = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide({ messages }) {
        seenMessages = messages;
        return { type: 'final', output: 'ok-live2d-guidance' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({ sessionId: 's7', input: 'hello' });
  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-live2d-guidance');
  assert.match(String(seenMessages[0]?.content || ''), /Live2D action/);
  assert.match(String(seenMessages[0]?.content || ''), /duration_sec/);

  dispatcher.stop();
});
