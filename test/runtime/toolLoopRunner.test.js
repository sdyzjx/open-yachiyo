const test = require('node:test');
const assert = require('node:assert/strict');

const { RuntimeEventBus } = require('../../apps/runtime/bus/eventBus');
const { ToolExecutor } = require('../../apps/runtime/executor/toolExecutor');
const localTools = require('../../apps/runtime/executor/localTools');
const { ToolCallDispatcher } = require('../../apps/runtime/orchestrator/toolCallDispatcher');
const { ToolLoopRunner } = require('../../apps/runtime/loop/toolLoopRunner');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    tool_early_dispatch: true,
    max_parallel_tools: 3
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

test('ToolLoopRunner dispatches stable tool call early when toolEarlyDispatch is enabled', async () => {
  const bus = new RuntimeEventBus();
  let toolStartedAt = 0;
  const executor = new ToolExecutor({
    slow_tool: {
      type: 'local',
      description: 'slow tool',
      side_effect_level: 'write',
      requires_lock: true,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        toolStartedAt = Date.now();
        await delay(80);
        return 'slow-result';
      }
    }
  });
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let streamStep = 0;
  let stepOneReturnedAt = 0;
  const reasoner = {
    async decideStream({ onToolCallStable }) {
      streamStep += 1;
      if (streamStep === 1) {
        onToolCallStable?.({
          index: 0,
          call_id: 'early-call-1',
          name: 'slow_tool',
          args: {}
        });
        await delay(60);
        stepOneReturnedAt = Date.now();
        return {
          type: 'tool',
          tool: { call_id: 'early-call-1', name: 'slow_tool', args: {} }
        };
      }
      return {
        type: 'final',
        output: 'early-dispatch-ok'
      };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 3000,
    runtimeStreamingEnabled: true,
    toolEarlyDispatch: true
  });

  const result = await runner.run({
    sessionId: 's-early-dispatch',
    input: 'dispatch early',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'early-dispatch-ok');
  assert.equal(toolStartedAt > 0, true);
  assert.equal(stepOneReturnedAt > 0, true);
  assert.equal(toolStartedAt < stepOneReturnedAt, true);
  assert.equal(events.some((evt) => evt.event === 'tool.call.early_dispatched'), true);
  const toolCallEvents = events.filter((evt) => evt.event === 'tool.call' && evt.payload.call_id === 'early-call-1');
  assert.equal(toolCallEvents.length, 1);

  dispatcher.stop();
});

test('ToolLoopRunner skips early dispatch until stable args satisfy schema', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor({
    'live2d.gesture': {
      type: 'local',
      description: 'gesture tool',
      side_effect_level: 'write',
      requires_lock: true,
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          duration_sec: { type: 'number' },
          queue_policy: { type: 'string' }
        },
        required: ['type'],
        additionalProperties: false
      },
      run: async () => 'gesture-result'
    }
  });
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let streamStep = 0;
  const reasoner = {
    async decideStream({ onToolCallStable }) {
      streamStep += 1;
      if (streamStep === 1) {
        onToolCallStable?.({
          index: 0,
          call_id: 'gesture-call-1',
          name: 'live2d.gesture',
          args: {}
        });
        await delay(10);
        onToolCallStable?.({
          index: 0,
          call_id: 'gesture-call-1',
          name: 'live2d.gesture',
          args: {
            type: 'greet',
            duration_sec: 6,
            queue_policy: 'replace'
          }
        });
        await delay(20);
        return {
          type: 'tool',
          tool: {
            call_id: 'gesture-call-1',
            name: 'live2d.gesture',
            args: {
              type: 'greet',
              duration_sec: 6,
              queue_policy: 'replace'
            }
          }
        };
      }
      return {
        type: 'final',
        output: 'gesture-early-dispatch-ok'
      };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000,
    runtimeStreamingEnabled: true,
    toolEarlyDispatch: true
  });

  const result = await runner.run({
    sessionId: 's-gesture-early-skip',
    input: 'gesture with delayed args',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'gesture-early-dispatch-ok');
  assert.equal(events.some((evt) => evt.event === 'tool.call.early_skipped' && evt.payload.reason === 'args_not_ready'), true);
  assert.equal(events.some((evt) => evt.event === 'tool.call.early_dispatched' && evt.payload.call_id === 'gesture-call-1'), true);
  const toolErrors = events.filter((evt) => evt.event === 'tool.error');
  assert.equal(toolErrors.length, 0);

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

test('ToolLoopRunner runs side_effect_level=none tools in parallel when enabled', async () => {
  const bus = new RuntimeEventBus();
  const starts = {};
  const ends = {};
  const executor = new ToolExecutor({
    slow_a: {
      type: 'local',
      description: 'slow A',
      side_effect_level: 'none',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        starts.a = Date.now();
        await delay(90);
        ends.a = Date.now();
        return 'A';
      }
    },
    slow_b: {
      type: 'local',
      description: 'slow B',
      side_effect_level: 'none',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        starts.b = Date.now();
        await delay(90);
        ends.b = Date.now();
        return 'B';
      }
    }
  });
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
            { call_id: 'call-pa', name: 'slow_a', args: {} },
            { call_id: 'call-pb', name: 'slow_b', args: {} }
          ]
        };
      }
      return { type: 'final', output: 'done-parallel' };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000,
    toolAsyncMode: 'parallel',
    maxParallelTools: 2
  });

  const result = await runner.run({
    sessionId: 's-parallel',
    input: 'parallel',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done-parallel');
  assert.equal(Math.abs(starts.a - starts.b) < 50, true);
  const modeEvent = events.find((evt) => evt.event === 'tool.dispatch.mode');
  assert.equal(modeEvent.payload.mode, 'parallel');
  assert.equal(modeEvent.payload.chunk_width, 2);

  dispatcher.stop();
});

test('ToolLoopRunner runs voice.tts_aliyun_vc and live2d.expression.set in parallel when metadata allows', async () => {
  const bus = new RuntimeEventBus();
  const starts = {};
  const executor = new ToolExecutor({
    'voice.tts_aliyun_vc': {
      type: 'local',
      description: 'voice tts',
      side_effect_level: 'none',
      requires_lock: false,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        starts.voice = Date.now();
        await delay(80);
        return 'voice-ok';
      }
    },
    'live2d.expression.set': {
      type: 'local',
      description: 'expression set',
      side_effect_level: 'none',
      requires_lock: false,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        starts.expression = Date.now();
        await delay(80);
        return 'expression-ok';
      }
    }
  });
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
            { call_id: 'call-voice', name: 'voice.tts_aliyun_vc', args: {} },
            { call_id: 'call-expression', name: 'live2d.expression.set', args: {} }
          ]
        };
      }
      return { type: 'final', output: 'done-voice-expression-parallel' };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000,
    toolAsyncMode: 'parallel',
    maxParallelTools: 2
  });

  const result = await runner.run({
    sessionId: 's-voice-expression-parallel',
    input: 'voice and expression',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done-voice-expression-parallel');
  assert.equal(Math.abs(starts.voice - starts.expression) < 50, true);
  const modeEvent = events.find((evt) => evt.event === 'tool.dispatch.mode');
  assert.equal(modeEvent.payload.mode, 'parallel');
  assert.equal(modeEvent.payload.chunk_width, 2);

  dispatcher.stop();
});

test('ToolLoopRunner keeps serial execution for write tools even in parallel mode', async () => {
  const bus = new RuntimeEventBus();
  const starts = {};
  const ends = {};
  const executor = new ToolExecutor({
    write_a: {
      type: 'local',
      description: 'write A',
      side_effect_level: 'write',
      requires_lock: true,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        starts.a = Date.now();
        await delay(70);
        ends.a = Date.now();
        return 'WA';
      }
    },
    write_b: {
      type: 'local',
      description: 'write B',
      side_effect_level: 'write',
      requires_lock: true,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        starts.b = Date.now();
        await delay(70);
        ends.b = Date.now();
        return 'WB';
      }
    }
  });
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
            { call_id: 'call-sa', name: 'write_a', args: {} },
            { call_id: 'call-sb', name: 'write_b', args: {} }
          ]
        };
      }
      return { type: 'final', output: 'done-serial-fallback' };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 4,
    toolResultTimeoutMs: 2000,
    toolAsyncMode: 'parallel',
    maxParallelTools: 2
  });

  const result = await runner.run({
    sessionId: 's-serial-fallback',
    input: 'serial fallback',
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'done-serial-fallback');
  assert.equal(starts.b >= ends.a, true);
  const modeEvent = events.find((evt) => evt.event === 'tool.dispatch.mode');
  assert.equal(modeEvent.payload.mode, 'serial');
  assert.equal(modeEvent.payload.chunk_width, 1);

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

test('ToolLoopRunner injects voice auto-reply system prompt when runtimeContext flag is enabled', async () => {
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
        return { type: 'final', output: 'ok-voice-auto-reply' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({
    sessionId: 's-voice-auto-reply-on',
    input: 'hello',
    runtimeContext: { voice_auto_reply_enabled: true }
  });
  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-voice-auto-reply');
  assert.equal(
    seenMessages.some(
      (m) => m.role === 'system'
        && /voice\.tts_aliyun_vc/.test(String(m.content || ''))
        && /no more than 5 sentences/.test(String(m.content || ''))
    ),
    true
  );

  dispatcher.stop();
});

test('ToolLoopRunner emits llm.prompt.assembled with fully assembled messages', async () => {
  const bus = new RuntimeEventBus();
  const executor = new ToolExecutor(localTools);
  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  const seenEvents = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => ({
      async decide() {
        return { type: 'final', output: 'ok-prompt-log' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({
    sessionId: 's-prompt-log',
    input: 'hello',
    inputImages: [{ data_url: 'data:image/png;base64,AAAA' }],
    seedMessages: [{ role: 'assistant', content: 'prior assistant' }],
    onEvent: (evt) => seenEvents.push(evt)
  });

  assert.equal(result.state, 'DONE');
  const promptEvent = seenEvents.find((evt) => evt.event === 'llm.prompt.assembled');
  assert.ok(promptEvent);
  assert.equal(promptEvent.payload.message_count > 0, true);
  assert.equal(Array.isArray(promptEvent.payload.messages), true);
  assert.equal(
    promptEvent.payload.messages.some((msg) => String(msg.role) === 'assistant' && String(msg.content) === 'prior assistant'),
    true
  );
  const userMsg = promptEvent.payload.messages.find((msg) => msg.role === 'user');
  assert.ok(userMsg);
  assert.equal(Array.isArray(userMsg.content), true);
  assert.equal(
    userMsg.content.some((part) => part && part.type === 'image_url' && part.image_url === '[omitted]'),
    true
  );

  dispatcher.stop();
});

test('ToolLoopRunner does not inject voice auto-reply system prompt when runtimeContext flag is disabled', async () => {
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
        return { type: 'final', output: 'ok-voice-auto-reply-off' };
      }
    }),
    listTools: () => executor.listTools(),
    maxStep: 1,
    toolResultTimeoutMs: 500
  });

  const result = await runner.run({
    sessionId: 's-voice-auto-reply-off',
    input: 'hello',
    runtimeContext: { voice_auto_reply_enabled: false }
  });
  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'ok-voice-auto-reply-off');
  assert.equal(
    seenMessages.some((m) => /voice\.tts_aliyun_vc/.test(String(m.content || ''))),
    false
  );

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

test('ToolLoopRunner continues when shell.exec returns APPROVAL_REQUIRED', async () => {
  const bus = new RuntimeEventBus();
  let shellExecAttempts = 0;
  let seenApprovalId = '';

  const executor = {
    listTools() {
      return [
        {
          name: 'shell.exec',
          input_schema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
            additionalProperties: false
          },
          side_effect_level: 'write',
          requires_lock: true
        },
        {
          name: 'shell.approve',
          input_schema: {
            type: 'object',
            properties: {
              approval_id: { type: 'string' },
              scope: { type: 'string', enum: ['once', 'always'] }
            },
            required: ['approval_id'],
            additionalProperties: false
          },
          side_effect_level: 'write',
          requires_lock: true
        }
      ];
    },
    async execute(toolCall) {
      if (toolCall.name === 'shell.exec') {
        shellExecAttempts += 1;
        if (shellExecAttempts === 1) {
          seenApprovalId = 'apr-loop-1';
          return {
            ok: false,
            code: 'APPROVAL_REQUIRED',
            error: 'shell command requires approval before execution',
            details: { approval_id: seenApprovalId }
          };
        }
        return { ok: true, result: 'retry-success' };
      }
      if (toolCall.name === 'shell.approve') {
        assert.equal(toolCall.args.approval_id, seenApprovalId);
        return { ok: true, result: '{"status":"approved"}' };
      }
      return { ok: false, code: 'TOOL_NOT_FOUND', error: 'unexpected tool' };
    }
  };

  const dispatcher = new ToolCallDispatcher({ bus, executor });
  dispatcher.start();

  let step = 0;
  const reasoner = {
    async decide({ messages }) {
      step += 1;
      if (step === 1) {
        return {
          type: 'tool',
          tool: { call_id: 'shell-call-1', name: 'shell.exec', args: { command: 'echo hi || true' } }
        };
      }
      if (step === 2) {
        const approvalToolMessage = messages.find(
          (msg) => msg.role === 'tool' && msg.tool_call_id === 'shell-call-1'
        );
        assert.ok(approvalToolMessage);
        assert.match(String(approvalToolMessage.content || ''), /APPROVAL_REQUIRED/);
        return {
          type: 'tool',
          tool: { call_id: 'shell-approve-1', name: 'shell.approve', args: { approval_id: seenApprovalId, scope: 'once' } }
        };
      }
      if (step === 3) {
        return {
          type: 'tool',
          tool: { call_id: 'shell-call-2', name: 'shell.exec', args: { command: 'echo hi || true' } }
        };
      }
      return { type: 'final', output: 'approval-flow-done' };
    }
  };

  const events = [];
  const runner = new ToolLoopRunner({
    bus,
    getReasoner: () => reasoner,
    listTools: () => executor.listTools(),
    maxStep: 6,
    toolResultTimeoutMs: 2000
  });

  const result = await runner.run({
    sessionId: 's-shell-approval-loop',
    input: 'run shell command',
    onEvent: (evt) => events.push(evt)
  });

  assert.equal(result.state, 'DONE');
  assert.equal(result.output, 'approval-flow-done');
  assert.equal(shellExecAttempts, 2);
  assert.equal(events.some((evt) => evt.event === 'tool.error'), false);
  assert.equal(
    events.some(
      (evt) => evt.event === 'tool.result'
        && evt.payload.code === 'APPROVAL_REQUIRED'
        && evt.payload.approval_required === true
    ),
    true
  );

  dispatcher.stop();
});
