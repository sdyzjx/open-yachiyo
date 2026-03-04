const test = require('node:test');
const assert = require('node:assert/strict');

const { RuntimeEventBus } = require('../../apps/runtime/bus/eventBus');
const { RpcInputQueue } = require('../../apps/runtime/queue/rpcInputQueue');
const { RuntimeRpcWorker } = require('../../apps/runtime/rpc/runtimeRpcWorker');

test('RuntimeRpcWorker processes runtime.run and emits rpc result', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();

  let seedMessagesSeen = null;
  let runtimeContextSeen = null;
  const runner = {
    async run({ sessionId, input, seedMessages, runtimeContext, onEvent }) {
      seedMessagesSeen = seedMessages;
      runtimeContextSeen = runtimeContext;
      onEvent({ event: 'plan', payload: { input } });
      onEvent({ event: 'llm.final', payload: { decision: { type: 'final', preview: 'ok:hello' } }, trace_id: 't-1', step_index: 1 });
      return {
        output: `ok:${input}`,
        traceId: 't-1',
        state: 'DONE',
        sessionId,
        metrics: {
          final_ms: 12,
          first_token_ms: 7
        }
      };
    }
  };

  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  const sends = [];
  const sendEvents = [];
  let startHookCalled = false;
  let finalHookCalled = false;
  const runtimeEventSeen = [];
  let buildPromptCalled = false;
  let buildRunContextCalled = false;

  const accepted = await queue.submit({
    jsonrpc: '2.0',
    id: 'rpc-1',
    method: 'runtime.run',
    params: { input: 'hello', session_id: 'abc' }
  }, {
    send: (payload) => sends.push(payload),
    sendEvent: (payload) => sendEvents.push(payload),
    buildPromptMessages: async ({ session_id: sessionId, input, input_images: inputImages }) => {
      buildPromptCalled = sessionId === 'abc' && input === 'hello';
      assert.equal(Array.isArray(inputImages), true);
      assert.equal(inputImages.length, 0);
      return [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' }
      ];
    },
    buildRunContext: async ({ session_id: sessionId, input }) => {
      buildRunContextCalled = sessionId === 'abc' && input === 'hello';
      return { permission_level: 'high', workspace_root: '/tmp/ws-abc' };
    },
    onRunStart: async ({ session_id: sessionId, input }) => {
      startHookCalled = sessionId === 'abc' && input === 'hello';
    },
    onRuntimeEvent: async (event) => {
      runtimeEventSeen.push(event.event);
    },
    onRunFinal: async ({ session_id: sessionId, output }) => {
      finalHookCalled = sessionId === 'abc' && output === 'ok:hello';
    }
  });

  assert.equal(accepted.accepted, true);

  await new Promise((resolve) => setTimeout(resolve, 60));

  const response = sends.find((item) => item.id === 'rpc-1');
  assert.ok(response);
  assert.equal(response.result.output, 'ok:hello');
  assert.deepEqual(response.result.metrics, { final_ms: 12, first_token_ms: 7 });

  const hasStart = sendEvents.some((evt) => evt.method === 'runtime.start');
  const hasFinal = sendEvents.some((evt) => evt.method === 'runtime.final');
  const finalEvent = sendEvents.find((evt) => evt.method === 'runtime.final');
  const deltaEvent = sendEvents.find((evt) => evt.method === 'message.delta');
  assert.equal(hasStart, true);
  assert.equal(hasFinal, true);
  assert.deepEqual(finalEvent.params.metrics, { final_ms: 12, first_token_ms: 7 });
  assert.ok(deltaEvent);
  assert.equal(deltaEvent.params.delta, 'ok:hello');
  assert.equal(startHookCalled, true);
  assert.equal(finalHookCalled, true);
  assert.equal(buildPromptCalled, true);
  assert.equal(buildRunContextCalled, true);
  assert.deepEqual(seedMessagesSeen, [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' }
  ]);
  assert.deepEqual(runtimeContextSeen, { permission_level: 'high', workspace_root: '/tmp/ws-abc' });
  assert.ok(runtimeEventSeen.includes('plan'));

  worker.stop();
});

test('RuntimeRpcWorker returns method_not_found on unsupported method', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  const worker = new RuntimeRpcWorker({ queue, runner: { run: async () => ({}) }, bus });
  worker.start();

  const sends = [];
  await queue.submit({ jsonrpc: '2.0', id: 'x1', method: 'runtime.unknown', params: {} }, {
    send: (payload) => sends.push(payload)
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(sends[0].error.code, -32601);

  worker.stop();
});

test('RuntimeRpcWorker handles /voice on slash command without invoking runner', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  let runnerCalled = false;
  const worker = new RuntimeRpcWorker({
    queue,
    runner: {
      async run() {
        runnerCalled = true;
        return { output: 'should-not-run', traceId: 't-should-not-run', state: 'DONE' };
      }
    },
    bus
  });
  worker.start();

  const sends = [];
  const sendEvents = [];
  let startHookCalled = false;
  let finalHookCalled = false;
  let slashCalled = false;

  await queue.submit({
    jsonrpc: '2.0',
    id: 'voice-cmd-1',
    method: 'runtime.run',
    params: { input: '/voice on', session_id: 'voice-cmd-s1' }
  }, {
    send: (payload) => sends.push(payload),
    sendEvent: (payload) => sendEvents.push(payload),
    handleSlashCommand: async ({ session_id: sessionId, input }) => {
      slashCalled = sessionId === 'voice-cmd-s1' && input === '/voice on';
      return {
        handled: true,
        output: 'Voice auto reply enabled. TTS will be required for this session.',
        state: 'DONE'
      };
    },
    buildRunContext: async () => ({ voice_auto_reply_enabled: true, voice_auto_reply_mode: 'force_on' }),
    onRunStart: async () => {
      startHookCalled = true;
    },
    onRunFinal: async ({ output }) => {
      finalHookCalled = output === 'Voice auto reply enabled. TTS will be required for this session.';
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(slashCalled, true);
  assert.equal(runnerCalled, false);
  assert.equal(startHookCalled, true);
  assert.equal(finalHookCalled, true);
  assert.equal(sendEvents.some((evt) => evt.method === 'runtime.start'), true);
  assert.equal(sendEvents.some((evt) => evt.method === 'runtime.final'), true);
  assert.equal(sends[0].result.output, 'Voice auto reply enabled. TTS will be required for this session.');

  worker.stop();
});

test('RuntimeRpcWorker does not emit message.delta for non-final llm decisions', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();

  const runner = {
    async run({ onEvent }) {
      onEvent({ event: 'llm.final', payload: { decision: { type: 'tool', tools: [{ name: 'add' }] } } });
      return { output: 'ok:tool', traceId: 't-tool-1', state: 'DONE' };
    }
  };

  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  const sendEvents = [];
  await queue.submit({
    jsonrpc: '2.0',
    id: 'tool-evt-1',
    method: 'runtime.run',
    params: { input: 'do tool' }
  }, {
    send: () => {},
    sendEvent: (payload) => sendEvents.push(payload)
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  const deltaEvents = sendEvents.filter((evt) => evt.method === 'message.delta');
  assert.equal(deltaEvents.length, 0);

  worker.stop();
});

test('RuntimeRpcWorker forwards llm.stream.delta and skips duplicated streamed llm.final delta', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  const debugRuntimeEvents = [];
  const unsubscribeRuntimeEvent = bus.subscribe('runtime.event', (event) => {
    debugRuntimeEvents.push(String(event?.event || ''));
  });

  const runner = {
    async run({ onEvent }) {
      onEvent({ event: 'llm.stream.delta', payload: { delta: '你' }, trace_id: 't-stream-1', step_index: 1 });
      onEvent({ event: 'llm.stream.delta', payload: { delta: '好' }, trace_id: 't-stream-1', step_index: 1 });
      onEvent({
        event: 'llm.final',
        payload: { streamed: true, decision: { type: 'final', preview: '你好' } },
        trace_id: 't-stream-1',
        step_index: 1
      });
      return { output: '你好', traceId: 't-stream-1', state: 'DONE' };
    }
  };

  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  const sendEvents = [];
  await queue.submit({
    jsonrpc: '2.0',
    id: 'stream-evt-1',
    method: 'runtime.run',
    params: { input: 'stream it' }
  }, {
    send: () => {},
    sendEvent: (payload) => sendEvents.push(payload)
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  const deltaEvents = sendEvents.filter((evt) => evt.method === 'message.delta');
  assert.equal(deltaEvents.length, 2);
  assert.deepEqual(deltaEvents.map((evt) => evt.params.delta), ['你', '好']);
  assert.equal(debugRuntimeEvents.includes('llm.stream.delta'), false);
  assert.equal(debugRuntimeEvents.includes('llm.final'), true);

  unsubscribeRuntimeEvent();
  worker.stop();
});

test('RuntimeRpcWorker forwards tool_call runtime events as tool_call.event', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  const debugRuntimeEvents = [];
  const unsubscribeRuntimeEvent = bus.subscribe('runtime.event', (event) => {
    debugRuntimeEvents.push(String(event?.event || ''));
  });

  const runner = {
    async run({ onEvent }) {
      onEvent({
        event: 'tool_call.delta',
        payload: { call_id: 'call-1', name: 'add', args_raw: '{"a":1' },
        trace_id: 't-tool-call-1',
        step_index: 1,
        seq: 3
      });
      onEvent({
        event: 'tool_call.stable',
        payload: { call_id: 'call-1', name: 'add', args: { a: 1, b: 2 } },
        trace_id: 't-tool-call-1',
        step_index: 1,
        seq: 4
      });
      onEvent({
        event: 'tool_call.parse_error',
        payload: { call_id: 'call-2', parse_reason: 'invalid json' },
        trace_id: 't-tool-call-1',
        step_index: 1,
        seq: 5
      });
      return { output: 'ok:tool-events', traceId: 't-tool-call-1', state: 'DONE' };
    }
  };

  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  const sendEvents = [];
  await queue.submit({
    jsonrpc: '2.0',
    id: 'tool-call-evt-1',
    method: 'runtime.run',
    params: { input: 'emit tool events' }
  }, {
    send: () => {},
    sendEvent: (payload) => sendEvents.push(payload)
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  const toolCallEvents = sendEvents.filter((evt) => evt.method === 'tool_call.event');
  assert.equal(toolCallEvents.length, 3);
  assert.deepEqual(toolCallEvents.map((evt) => evt.params.type), [
    'tool_call.delta',
    'tool_call.stable',
    'tool_call.parse_error'
  ]);
  assert.equal(debugRuntimeEvents.some((eventName) => eventName.startsWith('tool_call.')), false);

  unsubscribeRuntimeEvent();
  worker.stop();
});

test('RuntimeRpcWorker accepts image-only input_images and forwards to runner', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgU8Vf4QAAAAASUVORK5CYII=';

  let seenInput = null;
  let seenInputImages = null;
  const runner = {
    async run({ input, inputImages }) {
      seenInput = input;
      seenInputImages = inputImages;
      return { output: 'ok:image', traceId: 't-img-1', state: 'DONE' };
    }
  };

  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  const sends = [];
  const accepted = await queue.submit({
    jsonrpc: '2.0',
    id: 'img-1',
    method: 'runtime.run',
    params: {
      session_id: 'img-session',
      input: '',
      input_images: [
        {
          name: 'tiny.png',
          mime_type: 'image/png',
          size_bytes: 67,
          data_url: sampleDataUrl
        }
      ]
    }
  }, {
    send: (payload) => sends.push(payload)
  });

  assert.equal(accepted.accepted, true);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(seenInput, '');
  assert.equal(Array.isArray(seenInputImages), true);
  assert.equal(seenInputImages.length, 1);
  assert.equal(seenInputImages[0].name, 'tiny.png');
  assert.equal(sends.some((item) => item.id === 'img-1' && item.result?.output === 'ok:image'), true);

  worker.stop();
});

test('RuntimeRpcWorker transcribes input_audio via hook and forwards transcribed text', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();

  let seenInput = null;
  let seenRuntimeContext = null;
  let startHookInput = null;
  let startHookAudio = null;
  const runner = {
    async run({ input, runtimeContext }) {
      seenInput = input;
      seenRuntimeContext = runtimeContext;
      return { output: `ok:${input}`, traceId: 't-audio-1', state: 'DONE' };
    }
  };

  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  const sends = [];
  const accepted = await queue.submit({
    jsonrpc: '2.0',
    id: 'audio-1',
    method: 'runtime.run',
    params: {
      session_id: 'audio-session',
      input_audio: {
        audio_ref: 'file:///tmp/voice.mp3',
        format: 'mp3',
        lang: 'zh'
      }
    }
  }, {
    send: (payload) => sends.push(payload),
    transcribeAudio: async () => ({ text: '这是转写文本', confidence: 0.92 }),
    buildRunContext: async () => ({ permission_level: 'medium', workspace_root: '/tmp/ws-audio' }),
    onRunStart: async ({ input, runtime_context: runtimeContext }) => {
      startHookInput = input;
      startHookAudio = runtimeContext?.input_audio || null;
    }
  });

  assert.equal(accepted.accepted, true);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(seenInput, '这是转写文本');
  assert.equal(seenRuntimeContext.input_audio.transcribed_text, '这是转写文本');
  assert.equal(startHookInput, '这是转写文本');
  assert.equal(startHookAudio.transcribed_text, '这是转写文本');
  assert.equal(startHookAudio.confidence, 0.92);
  assert.equal(sends.some((item) => item.id === 'audio-1' && item.result?.output === 'ok:这是转写文本'), true);

  worker.stop();
});
