const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPi } = require('../../../apps/runtime/agent-pi/loadPi');
const { toPiModel, selectModels, requestOptions, createModelRuntime, isRetryableModelError } = require('../../../apps/runtime/agent-pi/modelAdapter');

const descriptor = {
  ref: 'deepseek/deepseek-reasoner', provider: 'deepseek', id: 'deepseek-reasoner',
  api: 'openai-completions', base_url: 'http://127.0.0.1:1/v1', api_key: '!literal-test-key',
  reasoning: true, context_window: 128000, max_tokens: 8192, headers: { 'x-test': 'local' },
  compat: { supports_developer_role: false, max_tokens_field: 'max_tokens', strip_reasoning_in_history: true, reasoning_content_field: 'reasoning_content' },
  extra_body: { top_p: 0.8 }, timeout_ms: 1234, max_retries: 0
};

test('TC-PI-002 maps reasoning, compat, headers and request body without mutating history', async () => {
  const model = toPiModel(descriptor);
  assert.equal(model.reasoning, true);
  assert.equal(model.compat.supportsDeveloperRole, false);
  assert.equal(model.compat.maxTokensField, 'max_tokens');
  assert.deepEqual(model.headers, descriptor.headers);
  const options = requestOptions(descriptor);
  const original = { messages: [{ role: 'assistant', content: 'ok', reasoning_content: 'hidden' }] };
  const payload = await options.onPayload(original, model);
  assert.equal(payload.top_p, 0.8);
  assert.equal(payload.messages[0].reasoning_content, undefined);
  assert.equal(original.messages[0].reasoning_content, 'hidden');
  assert.equal(options.timeoutMs, 1234);
  assert.equal(options.maxRetries, 0);
});

test('TC-PI-003 loads ESM once and registers isolated catalog with literal credentials', async () => {
  assert.equal(loadPi(), loadPi());
  const runtime = await createModelRuntime({ models: [descriptor] });
  assert.equal(runtime.getModel('deepseek', descriptor.id).reasoning, true);
  const auth = await runtime.getAuth('deepseek');
  assert.equal(auth.auth.apiKey, '!literal-test-key');
});

test('TC-PI-004 model override and fallback selection reject invalid models and auth errors', () => {
  const secondary = { ...descriptor, ref: 'other/model' };
  const catalog = { resolve: (ref) => ref === secondary.ref ? secondary : null, fallbackChain: () => [descriptor, secondary, descriptor] };
  assert.deepEqual(selectModels(catalog, secondary.ref), [secondary, descriptor]);
  assert.throws(() => selectModels(catalog, 'unknown'), /Unknown model_ref/);
  assert.equal(isRetryableModelError({ status: 401 }), false);
  assert.equal(isRetryableModelError({ status: 429 }), true);
  assert.equal(isRetryableModelError(new Error('fetch failed')), true);
});

test('TC-PI-024 custom reasoning fields normalize split UTF-8 SSE and history replay', async () => {
  const raw = new TextEncoder().encode('data: {"choices":[{"delta":{"private_reason":"思考"}}]}\n\ndata: [DONE]\n\n');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of raw) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const options = requestOptions({ ...descriptor, compat: { reasoning_content_field: 'private_reason' } }, { fetch: async () => response });
  const normalized = await (await options.fetch('http://127.0.0.1')).text();
  assert.match(normalized, /"reasoning_content":"思考"/);
  assert.doesNotMatch(normalized, /private_reason/);
  assert.match(normalized, /\[DONE\]/);
  const payload = await options.onPayload({ messages: [{ role: 'assistant', reasoning_content: 'thinking', content: 'text' }] });
  assert.equal(payload.messages[0].private_reason, 'thinking');
  assert.equal(payload.messages[0].reasoning_content, undefined);
});
