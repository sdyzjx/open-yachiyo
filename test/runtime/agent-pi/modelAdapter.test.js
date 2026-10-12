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

test('TC-LLM-035 Responses payload enforces plan constraints and namespaces local tools', async () => {
  const chatgpt = {
    ...descriptor,
    ref: 'chatgpt/gpt-test', provider: 'chatgpt', id: 'gpt-test', api: 'openai-responses',
    base_url: 'https://api.openai.com/v1', api_key: 'oauth-token', chatgpt_plan: true,
    extra_body: { temperature: 0.8, previous_response_id: 'forbidden', metadata: { x: 1 } }
  };
  const model = toPiModel(chatgpt);
  assert.equal(model.api, 'openai-responses');
  const payload = await requestOptions(chatgpt, { onPayload: async (value) => ({
    ...value, temperature: 2, previous_response_id: 'reintroduced'
  }) }).onPayload({
    model: 'gpt-test', store: true, stream: false, max_output_tokens: 50,
    input: [{ type: 'message', role: 'system', content: [] }],
    tools: [{ type: 'function', name: 'read_file', description: 'read', parameters: { type: 'object' } }]
  }, model);
  assert.equal(payload.store, false);
  assert.equal(payload.stream, true);
  assert.equal(payload.max_output_tokens, undefined);
  assert.equal(payload.previous_response_id, undefined);
  assert.equal(payload.metadata, undefined);
  assert.equal(payload.input[0].role, 'developer');
  assert.equal(payload.tools[0].type, 'namespace');
  assert.equal(payload.tools[0].name, 'yachiyo');
  assert.equal(payload.tools[0].tools[0].name, 'read_file');
  assert.equal(isRetryableModelError(new Error('subscription_sharing_usage_limit_exceeded')), false);
});

test('TC-LLM-035 Responses retries one 401 with a rotated token and does not retry usage limits', async () => {
  const requests = [];
  let refreshes = 0;
  const chatgpt = {
    ...descriptor,
    api: 'openai-responses', chatgpt_plan: true, max_retries: 9, temperature: 1,
    refresh_access_token: async () => { refreshes += 1; return 'rotated-token'; }
  };
  const options = requestOptions(chatgpt, { fetch: async (request) => {
    requests.push(request);
    return new Response('', { status: requests.length === 1 ? 401 : 429 });
  } });
  assert.equal(options.maxRetries, 0);
  assert.equal('temperature' in options, false);
  const response = await options.fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: 'Bearer old-token', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-test', input: [] })
  });
  assert.equal(response.status, 429);
  assert.equal(requests.length, 2);
  assert.equal(refreshes, 1);
  assert.equal(requests[1].headers.get('authorization'), 'Bearer rotated-token');
});
