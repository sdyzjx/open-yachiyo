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

test('a newer voice request interrupts the active turn for the same session', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const seen = [];
  const runner = {
    async run({ input, signal }) {
      seen.push(input);
      if (input !== 'first voice') return { output: 'second reply', traceId: 'second-trace', state: 'DONE' };
      firstStarted();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { output: 'late first reply', traceId: 'first-trace', state: 'DONE' };
    }
  };
  const worker = new RuntimeRpcWorker({ queue, runner, bus, voiceRunTimeoutMs: 1000 });
  worker.start();
  const firstEvents = [];
  const secondEvents = [];
  const audio = { audio_ref: '/tmp/voice.wav', format: 'wav', transcribed_text: 'voice' };

  await queue.submit({ jsonrpc: '2.0', id: 'voice-first', method: 'runtime.run', params: {
    session_id: 'same-phone', input: 'first voice', input_audio: audio
  } }, { send: () => {}, sendEvent: (event) => firstEvents.push(event) });
  await started;
  await queue.submit({ jsonrpc: '2.0', id: 'voice-second', method: 'runtime.run', params: {
    session_id: 'same-phone', input: 'second voice', input_audio: audio
  } }, { send: () => {}, sendEvent: (event) => secondEvents.push(event) });

  await new Promise((resolve) => setTimeout(resolve, 80));
  const interrupted = firstEvents.find((event) => event.method === 'runtime.final');
  const completed = secondEvents.find((event) => event.method === 'runtime.final');
  assert.equal(interrupted.params.state, 'ABORTED');
  assert.equal(interrupted.params.output, '已停止上一条任务，正在处理新的语音。');
  assert.equal(interrupted.params.metrics.abort_code, 'SUPERSEDED_BY_VOICE');
  assert.equal(completed.params.output, 'second reply');
  assert.deepEqual(seen, ['first voice', 'second voice']);
  worker.stop();
});

test('TC-PI-034 native queueing dispatches concurrent envelopes as steer/followUp without aborting', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  const seen = [];
  const runner = {
    supportsNativeQueueing: true,
    async run({ input, deliveryMode, signal }) {
      seen.push({ input, deliveryMode, signal });
      await new Promise((resolve) => setTimeout(resolve, input === 'first' ? 70 : 5));
      return { output: `ok:${input}`, traceId: `trace:${input}`, state: 'DONE' };
    }
  };
  const worker = new RuntimeRpcWorker({ queue, runner, bus, voiceRunTimeoutMs: 1000 });
  worker.start();
  const responses = [];
  const audio = { audio_ref: '/tmp/voice.wav', format: 'wav', transcribed_text: 'second' };
  await queue.submit({ jsonrpc: '2.0', id: 'native-first', method: 'runtime.run', params: {
    session_id: 'native-session', input: 'first'
  } }, { send: (value) => responses.push(value) });
  await queue.submit({ jsonrpc: '2.0', id: 'native-second', method: 'runtime.run', params: {
    session_id: 'native-session', input: 'second', input_audio: audio
  } }, { send: (value) => responses.push(value) });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(seen.map(({ input, deliveryMode }) => ({ input, deliveryMode })), [
    { input: 'first', deliveryMode: 'followUp' },
    { input: 'second', deliveryMode: 'steer' }
  ]);
  assert.equal(seen.every(({ signal }) => !signal.aborted), true);
  assert.deepEqual(responses.map((item) => item.id).sort(), ['native-first', 'native-second']);
  assert.equal(worker.activeRuns.size, 0);
  worker.stop();
});

test('TC-PI-034 clients can explicitly mark a text correction as steering', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  let deliveryMode;
  const runner = { supportsNativeQueueing: true, async run(args) {
    deliveryMode = args.deliveryMode;
    return { output: 'corrected', traceId: 'text-steer', state: 'DONE' };
  } };
  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();
  const sends = [];
  await queue.submit({ jsonrpc: '2.0', id: 'text-steer', method: 'runtime.run', params: {
    session_id: 'text-steer-session', input: '不是这个意思', delivery_mode: 'steer'
  } }, { send: (value) => sends.push(value) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(deliveryMode, 'steer');
  assert.equal(sends[0].result.output, 'corrected');
  worker.stop();
});

test('a voice turn has a bounded execution time and releases the worker', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  const runner = {
    async run({ signal }) {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { output: 'late', traceId: 'timeout-trace', state: 'DONE' };
    }
  };
  const worker = new RuntimeRpcWorker({ queue, runner, bus, voiceRunTimeoutMs: 20 });
  worker.start();
  const events = [];
  await queue.submit({ jsonrpc: '2.0', id: 'voice-timeout', method: 'runtime.run', params: {
    session_id: 'timeout-phone', input: 'slow voice',
    input_audio: { audio_ref: '/tmp/voice.wav', format: 'wav', transcribed_text: 'slow voice' }
  } }, { send: () => {}, sendEvent: (event) => events.push(event) });

  await new Promise((resolve) => setTimeout(resolve, 60));
  const final = events.find((event) => event.method === 'runtime.final');
  assert.equal(final.params.state, 'ABORTED');
  assert.equal(final.params.metrics.abort_code, 'RUN_TIMEOUT');
  assert.match(final.params.output, /语音任务执行超时/);
  assert.equal(worker.activeRun, null);
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

test('RuntimeRpcWorker preserves pre-transcribed audio metadata with non-empty input and skips ASR', async () => {
  const queue = new RpcInputQueue();
  const bus = new RuntimeEventBus();
  let seen = null;
  let transcribeCalls = 0;
  const runner = {
    async run({ input, runtimeContext }) {
      seen = { input, runtimeContext };
      return { output: 'ok', traceId: 't-audio-prefilled', state: 'DONE' };
    }
  };
  const worker = new RuntimeRpcWorker({ queue, runner, bus });
  worker.start();

  await queue.submit({
    jsonrpc: '2.0', id: 'audio-prefilled', method: 'runtime.run', params: {
      session_id: 'audio-prefilled',
      input: 'already transcribed',
      input_audio: {
        audio_ref: 'file:///tmp/prefilled.wav', format: 'wav', lang: 'auto',
        transcribed_text: 'already transcribed', confidence: 0.87,
        segments: [{ start: 0, end: 1, text: 'already transcribed' }]
      }
    }
  }, {
    send: () => {},
    buildRunContext: async () => ({ permission_level: 'low' }),
    transcribeAudio: async () => { transcribeCalls += 1; return { text: 'wrong' }; }
  });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(transcribeCalls, 0);
  assert.equal(seen.input, 'already transcribed');
  assert.equal(seen.runtimeContext.input_audio.transcribed_text, 'already transcribed');
  assert.equal(seen.runtimeContext.input_audio.confidence, 0.87);
  assert.deepEqual(seen.runtimeContext.input_audio.segments, [{ start: 0, end: 1, text: 'already transcribed' }]);
  worker.stop();
});
